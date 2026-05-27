# V2 Auth Migration — Keycloak/UIFusion → Logto/Hub

> **Audience**: Industream platform team (Cyril + colleague / David)
> **Status**: analysis complete, decisions locked, pending sign-off before implementation
> **Scope**: `industream-hub`, `industream-stack`, `industream-cli`
> **Companion docs**: `INTEGRATION-PLAN.md` (Swarm/Compose runtime split), `RUNTIME-STRATEGY.md`
> **Date**: 2026-05-27

## TL;DR

- **Breaking change, gated as v2.** We replace the v1 identity layer (Keycloak IdP +
  UIFusion shell) with the Hub shell (`industream-menu` + `hub-backend`) and Logto.
- **The Hub backend always issues its own JWT** (`iss=industream-hub-backend`,
  `aud=industream-hub`). Only the identity *source* differs by edition:
  - **CE (community)** — `IH_AUTH_METHOD=BASIC`: a single env-defined admin, offline,
    no external IdP. Confirmed in `hub-backend/src/config/env.ts` (`IH_USERNAME`/`IH_PASSWORD`).
  - **EE (enterprise)** — `IH_AUTH_METHOD=OAUTH`: Logto OIDC upstream, role propagation.
- **Downstream apps are edition-agnostic**: they validate the Hub JWT via JWKS, so
  Grafana/DataCatalog/workers are configured **once** regardless of edition.
- **Ingress: Traefik everywhere** (Swarm *and* Compose). Decided to avoid wiring the
  Hub same-site/JWKS/origin requirements twice in two label dialects.
- **One hard code prerequisite in `industream-hub`** (see §1) must land first: the Hub
  JWT signing key is currently generated in-memory at process start → not stable across
  restarts or replicas.

---

## 1. Blocking prerequisites in `industream-hub` (must land first)

### 1.1 Persist / inject the JWT signing key  — **BLOCKER**
`packages/industream-hub-backend/src/modules/auth/auth.service.ts:41`:
```ts
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
```
The keypair is generated **in memory at module load**, `kid = sha256(n.e)[:16]`. Consequences:
- **Restart** → new `kid` → every live JWT is invalidated, JWKS serves a new key
  (this is the "no keys found / 60-min stale" symptom seen in local testing).
- **Multi-replica** → each replica signs with a different key → a JWT minted by replica A
  fails verification against replica B's JWKS.

**Fix (pick one, ranked):**
1. **Inject via secret** `IH_JWT_SIGNING_KEY` (RSA private key PEM). All replicas share it;
   `kid` derived deterministically. Required for HA. *(preferred)*
2. **Persist in LMDB** (load-or-generate in `HUB_DATA_PATH`). Survives restart but each
   replica still has its own → only safe single-replica.

Until this lands, the stack must pin **`hub-backend` to `deploy.replicas: 1`** with a
named volume, and Grafana's `GF_AUTH_JWT_CACHE_TTL` stays short.

### 1.2 Publish images to Harbor (no `build:` in Swarm)
`docker-compose.ee.yml` currently uses `build:` for the enterprise backend. Swarm cannot
build. Publish to Harbor (community + premium mirrors):
- `industream/hub-backend:<v>` (CE)
- `industream/hub-backend-enterprise:<v>` (EE)
- `industream/industream-menu:<v>` (shell)

This also satisfies the repo rule "publish proper versions, never patch in compose".

### 1.3 Confirm worker auth path
`worker-manager` (and flow workers) authenticate against Keycloak today
(`KEYCLOAK_URL/REALM/CLIENT_ID` in `docker-stack.workers.yml`). They must move to
validating the Hub JWT (JWKS) or Logto directly. **Confirm what the worker supports.**

---

## 2. Current → Target

| Concern        | v1 (today)                                  | v2 (target)                                              |
|----------------|---------------------------------------------|----------------------------------------------------------|
| IdP            | Keycloak 26.1.0 (realm import)              | EE: Logto · CE: none (Hub BASIC admin)                   |
| Shell          | UIFusion (`uifusion/ui` + `uifusion/api`)   | Hub (`industream-menu` + `hub-backend`)                  |
| Token apps see | Keycloak OIDC token (generic OAuth)         | Hub JWT (`iss=industream-hub-backend`) via JWKS          |
| Ingress        | Traefik (Swarm) / Caddy (Compose)           | **Traefik (both)**                                       |
| Grafana auth   | `GF_AUTH_GENERIC_OAUTH` → Keycloak          | `GF_AUTH_JWT` → Hub JWKS                                 |
| Secrets        | `keycloak_admin/db_password`                | `hub_jwt_signing_key`, `hub_admin_password` (CE), `logto_db_password`, `logto_cookie_key` (EE) |
| Editions       | Keygen entitlements + `stack-filter.ts`     | + explicit `community`/`enterprise` edition → stack-file selection |

---

## 3. `industream-stack` changes

### 3.1 New stack files
- **`docker-stack.hub.yml`** (CE base, always deployed):
  - `industream-menu` — shell, `AUTH_METHOD=BASIC`, Traefik labels (the Hub host).
  - `hub-backend` — image (not build), `IH_AUTH_METHOD=BASIC`, `IH_ISSUER=industream-hub-backend`,
    `IH_USERNAME`/`IH_PASSWORD` (the latter from `hub_admin_password` secret via `_FILE`-style
    env wiring), `HUB_DATA_PATH` on a named volume, `IH_JWT_SIGNING_KEY` from secret (post §1.1),
    `deploy.replicas: 1` until §1.1 lands.
- **`docker-stack.ee.yml`** (EE overlay, enterprise edition only):
  - `logto` + Logto Postgres (reuse platform Postgres with a `logto` DB — drop the separate
    container; one less stateful service).
  - Flip `hub-backend`/`industream-menu` to `OAUTH` + `IH_OIDC_*` / `OIDC_*` (Swarm transposition
    of `industream-hub/.../docker-compose.ee.yml`: `_FILE` secrets, Traefik labels, replicas).

### 3.2 Removals
- `keycloak` service from `docker-stack.yml`; `keycloak-realms/`;
  `scripts/generate/generate-keycloak-realm.sh`; `scripts/utils/rotate-keycloak-password.sh`;
  `config/keycloak-entrypoint.sh`.
- Postgres `POSTGRES_MULTIPLE_DATABASES`: drop `keycloak:…`, add `logto:logto:…` (EE).

### 3.3 `scripts/deploy-swarm.sh`
`STACK_FILES` array (currently ~line 516): add `docker-stack.hub.yml` always; append
`docker-stack.ee.yml` when `EDITION=enterprise` (mirror the existing `COMMUNITY_MODE` gate
for premium workers).

### 3.4 `scripts/setup/create-secrets.sh`
`BASE_SECRETS`: remove `keycloak_admin_password`, `keycloak_db_password`; add
`hub_jwt_signing_key`, `hub_admin_password` (CE), `logto_db_password`, `logto_cookie_key` (EE).
CLI `SwarmSecrets`/`ComposeSecrets` follow automatically (they delegate to this script).

### 3.5 Traefik routing (the hard part)
The Hub needs the shell + embedded apps to be **same-site** (SharedWorker bridge, cookies,
`INDUSTREAM_HUB_ORIGIN`). v1 routes everything on one Host with `PathPrefix`; v2 wants sibling
subdomains (`menu.`, `auth.`, `grafana.`, `datacatalog.` …).
- Regenerate SANs (`scripts/generate/generate-sans.sh`) for the new subdomains.
- Add Traefik labels per Hub service; set `INDUSTREAM_HUB_ORIGIN` to the **menu** origin
  (serves `industream-login.js` + `/shared-worker.html`), not the backend.
- EE: Logto `ENDPOINT` must be HTTPS (browser token-exchange XHR is mixed-content-blocked
  otherwise) — Traefik already terminates TLS.

### 3.6 Grafana (`docker-stack.monitoring.yml`)
Replace the `GF_AUTH_GENERIC_OAUTH_*` block (lines ~48–62) with `GF_AUTH_JWT_*` (the validated
`grafana-hub-wrapper` config):
`JWK_SET_URL=<hub-backend>/auth/jwks`, `EXPECT_CLAIMS={"iss":"industream-hub-backend","aud":"industream-hub"}`,
`USERNAME_CLAIM=username`, `DISABLE_SIGNOUT_MENU=true`, `USERS_DISABLE_GRAVATAR=true`,
short `CACHE_TTL` until §1.1. Works for CE and EE unchanged.

---

## 4. `industream-cli` changes

- **`modules.json`**: remove `keycloak`; replace `uifusion`/`uifusion-api` with
  `industream-menu` + `hub-backend`; add `logto` gated by entitlement (`PRODUCT_SSO` or
  `edition=enterprise`) so CE never pulls it (`stack-filter.ts` already excludes by entitlement).
- **Edition notion**: derive `community`/`enterprise` from the Keygen plan; pass to
  `deploy-swarm.sh` (see §3.3). `stack-filter.ts` keeps Logto out of CE via the entitlement gate.
- **Compose runtime**: same overlay model via `fm-*` scripts; Traefik now used here too
  (drop the Caddy-only path for prod parity; Caddy may remain a local-dev convenience only).

---

## 5. Seeding (replaces Keycloak realm import)

- **EE**: adapt `industream-hub/.../seed-logto.sh` for Swarm (`--runtime swarm|compose`;
  resolve the Logto Postgres via `docker service ps` / one-shot). Wire into
  `scripts/setup/first-deployment.sh` after Logto is healthy, alongside `seed-menu-apps.sh`
  (Hub app registration) and `seed-confighub.sh`. Seeds SPA app + roles + admin (temp password).
- **CE**: no Logto. The admin is the BASIC env user — set `IH_USERNAME` +
  `IH_PASSWORD` (from `hub_admin_password` secret, generated by `create-secrets.sh`).
  No LMDB user seed needed.

---

## 6. Phased plan

1. **`industream-hub`**: signing-key fix (§1.1) + publish images (§1.2) + confirm worker auth (§1.3).
2. **`industream-stack`**: `docker-stack.hub.yml` (CE) + Grafana JWT swap + secrets + Traefik
   routing for the Hub shell. Deploy CE end-to-end on the test VM.
3. **`industream-stack`**: `docker-stack.ee.yml` (Logto) + EE Traefik routing + Logto seed.
   Deploy EE end-to-end.
4. **`industream-cli`**: `modules.json` + edition selection + `deploy-swarm.sh` wiring.
5. **Cleanup**: remove Keycloak artifacts; bump major version; update docs.

> No in-place user migration from Keycloak (different IdP). Provide the admin seed and
> document re-provisioning for v1→v2 upgrades.

---

## 6b. Licensing model (v2) — two gates, offline-first

Driven by the commercial model on industream.com/pricing: **CE** = free OSS
(BSL/Apache, no license); **paid** = **per-site** subscription (OPEX monthly/annual)
or perpetual **CAPEX + 15%/yr maintenance**; **90-day free trial**; three modules
(Data&Asset Catalog — tiered by *tags*; AI Studio — by *models*; MCP — by *users*)
plus add-ons (Backup, HA, DB connectors, process packages).

### Two complementary gates
| Gate | Where enforced | Revocable | Controls |
|------|----------------|-----------|----------|
| **Distribution** — per-client Harbor robot creds | Harbor (Industream-side, server) | ✅ rotate the robot account | Whether the client can **pull** premium/EE images at all. Leak → revoke that one client. |
| **Entitlement** — Ed25519-signed `.lic` file | deploy `ee`-gate, **offline** | ⚠️ via `expiry`/`maintenance_expiry` | What **runs**, until **when**, which **modules/limits**. |

`scripts/create-customer.ts` **already implements this** (Harbor robot + license +
`harborCredentials`/`tagsLimit` in license metadata). v2 keeps the Harbor robot
provisioning and **swaps the Keygen license for the offline signed file** — the strong,
revocable gate stays; the entitlement gate goes offline (air-gap-friendly).

### Why offline-signed, not Keygen-online or a local license server
- Current `keygen.ts` only does **online validate + a 30-day editable JSON cache** (no
  offline crypto) → needs internet every 30 days. Bad for air-gap.
- A **self-hosted license server in the client's stack** (e.g. SW-CD) "solves" connectivity
  but the **client owns the server** → its signing key is on their disk → forgeable; plus a
  stateful keepalive service the platform depends on. Worse tamper story, more ops.
- **Signed file**: the **private key never leaves Industream** → clients can't forge; **zero
  services, zero internet, no machine-binding** (per-*site*, so server migration never breaks).

### Prototype
`industream-stack/scripts/license/` (`gen-keys.sh`, `issue-license.sh`, `license.sh` + README).
Pure `openssl` (Ed25519) + `jq`. Tested: tamper→fail, wrong-key→fail, expiry+grace,
clock-rollback guard (monotonic high-water mark), perpetual. Format:
`base64(payload).base64(ed25519_sig)` (JWT-style signing over the encoded segment).

### Two enforcement layers
1. **Deploy-time (this prototype, boolean)** — modules on/off + add-ons → selects
   `docker-stack.*.yml` + `docker login` with the embedded Harbor creds. **stack-filter.ts**
   already filters by `entitlements: string[]`; the signed file just becomes that source.
2. **Runtime (apps, fast-follow)** — quantitative caps (`maxTags`/`maxModels`/`maxUsers`):
   the CLI can't count tags; DataBridge/AI-Studio/MCP must read the signed license and enforce.

### Expiry semantics
- **subscription (OPEX)** → `expiry` = billing-period end (calendar is primary).
- **perpetual (CAPEX)** → no run `expiry`; `maintenance_expiry` gates upgrades only.
- **trial** → `expiry = issued + 90d`, **plus a runtime countdown** (monotonic consumed-time
  budget) to blunt clock-rollback trial abuse. Countdown is documented, not yet prototyped.
- All: **grace window + warn, never brick** a running industrial plant.

## 7. Decisions locked & open questions

**Locked**
- **Ingress: Traefik everywhere** (Swarm + Compose) — avoid wiring the Hub same-site
  requirements twice. Caddy at most a local-dev convenience.
- **Deployment tool: bash-first.** The TS CLI mostly wraps bash; license validation is just
  `curl`+`jq`+cache (no offline crypto today) → no irreducible TS need. Consolidate to bash;
  reconsider Ink unless an interactive wizard is wanted.
- **CE/EE split: one common base + an `ee` overlay/subcommand**, EE-only bits as `*.ee.*`
  files (consistent with `industream-hub/.../docker-compose.ee.yml`). No duplicated scripts.
- **Licensing: offline Ed25519 signed file** (entitlement gate) + **per-client Harbor robot**
  (distribution gate, revocable). Calendar `expiry` is primary; countdown only for trial.
  **No machine-binding** (per-site). Prototype in `industream-stack/scripts/license/`.

**Open**
- **Q1** — Hub signing-key fix: inject-via-secret (HA) vs LMDB-persist (single-replica)? (§1.1)
- **Q2** — Logto Postgres: reuse the platform Postgres (`logto` DB) or dedicated container? (§3.1)
- **Q3** — worker-manager: validate the Hub JWT via JWKS, or talk to Logto? (§1.3)
- **Q4** — Runtime caps (`maxTags`/`maxModels`/`maxUsers`): enforce in the apps for v2, or
  ship boolean-only gating first and treat tiers commercially? (§6b)
- **Q5** — Trial: implement the runtime countdown now, or rely on calendar `expiry` + grace
  for the 90-day trial initially? (§6b)
