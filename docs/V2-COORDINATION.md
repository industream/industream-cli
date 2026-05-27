# V2 Auth/Hub Migration — CE ↔ EE coordination

> One-page handshake for the two parallel workstreams. Full design:
> [`V2-AUTH-MIGRATION.md`](./V2-AUTH-MIGRATION.md). Date: 2026-05-27.

## Lanes — who owns what

| Lane | Owner | Scope |
|------|-------|-------|
| **CE / community** | in-flight migration agent | Keycloak removal; `uifusion-api` → native Hub backend (JWKS-only/BASIC) **in `docker-stack.yml`**; version bumps (2.1.0); Grafana OAuth→JWKS; `create-secrets.sh` (CE secrets); `deploy-swarm.sh`. |
| **EE / enterprise** | (this work) | `docker-stack.ee.yml` overlay (Logto + OAUTH); offline license + `ee-gate`; jose auth backend; Logto seed. **Touches no CE file** — consumes contracts only. |

## PR index

| PR | Repo | Branch → base | What | State |
|----|------|---------------|------|-------|
| **#3** | hub | `v2/jwt-signing-key` → `main` | Stable JWT signing key (the HA blocker) | ready — **merge first** |
| **#4** | hub | `v2/jose-upstream` → `v2/jwt-signing-key` | Hand-rolled JWT crypto → `jose` (Hub + upstream) | ready (stacked on #3) |
| **#5** | hub | `v2/auth-licensing` → `main` | EE **dev**-compose + `seed-logto.sh` + `.env.ee` | draft |
| **#1** | stack | `v2/auth-licensing` → `main` | Offline Ed25519 license + `ee-gate.sh` | draft |
| **#2** | stack | `v2/ee-overlay` → `feature/flowmaker-jwt-auth-overlay` | **`docker-stack.ee.yml`** (Logto overlay) | draft |
| **#2** | cli | `v2/auth-licensing` → `main` | This plan + coordination | draft |
| — | cli | `v2/modules-api-ee` | `enterpriseVariant: uifusion/api-ee` (1 line) | **cherry-pick onto the migration branch**, not a PR to main |

Grafana↔Hub integration lives in repo **`grafana-hub-wrapper`** (`master`, README = contract).

## Contracts — CE provides → EE consumes

The CE migration **establishes** these; the EE overlay **depends on** them. Don't change unilaterally.

- Hub backend service name: **`uifusion-api`** (the EE overlay overrides it).
- Internal network alias: **`industream-hub-backend`**; JWKS at `http://industream-hub-backend:3050/auth/jwks`.
- Hub JWT: **issuer `hub-backend`, audience `industream-hub`** (override `HUB_AUTH_ISSUER`/`HUB_AUTH_AUDIENCE`). **Identical CE & EE** → Grafana/FlowMaker JWKS verifiers need no change.
- CE admin secrets: `hub_backend_admin_user` / `hub_backend_admin_password` (file-mounted). Unused in EE (OAUTH).
- Image naming: base = community (GHCR); `<name>-ee` = enterprise variant (39t) **only when it exists** → `modules.json` `enterpriseVariant`.

## Shared wiring — needs both lanes to agree (status)

| Item | File (owner) | EE need | Status |
|------|--------------|---------|--------|
| EE Logto secrets | `create-secrets.sh` (CE) | add `logto_db_password` + `logto_db_url` (EE-only) | ⬜ TODO |
| Cert SANs | `generate-sans.sh` (CE) | add `auth.${DOMAIN}` + `auth-admin.${DOMAIN}` | ⬜ TODO |
| Stack-file selection | `deploy-swarm.sh` (CE) | append `docker-stack.ee.yml` to STACK_FILES when edition=enterprise | ⬜ TODO |
| Route api-ee → 39t | `modules.json` (cli) | `enterpriseVariant: uifusion/api-ee` | ✅ on `v2/modules-api-ee` (cherry-pick) |
| Logto seed (app+roles+admin) | `seed-logto.sh` (EE, hub) | run after Logto healthy | ✅ prototype (hub `v2/auth-licensing`) |
| Grafana auth | `docker-stack.monitoring.yml` (CE) | `GF_AUTH_GENERIC_OAUTH` → `GF_AUTH_JWT` (JWKS = Hub) | ⬜ CE TODO (image already grafana-oss) |
| Grafana plugins offline | `docker-stack.monitoring.yml` (CE) | `GF_INSTALL_PLUGINS` pulls from grafana.com → ship plugins offline for air-gap | ⚠️ decide |

## Recommended merge order

1. **hub #3** (signing key — blocker; unblocks HA + stable JWKS).
2. **hub #4** (jose) — rebase onto `main` after #3.
3. **CE migration** (Keycloak removal + native hub-backend + Grafana JWKS + the wiring rows above) lands on its branch.
4. **stack #2** (EE overlay) — once CE contracts are merged; do the EE wiring rows.
5. Edition selection in CLI (`modules.json` hub/menu/logto + edition logic) — fast-follow.

## Open product decisions (see plan §7)

- Q1 signing key: inject-secret (HA) ✅ chosen — `IH_JWT_SIGNING_KEY(_FILE)`.
- Q2 Logto Postgres: **dedicated `logto-postgres`** in the EE overlay (chosen — self-contained, no CE postgres edit).
- Q4 runtime caps (tags/models/users): enforce in apps (fast-follow) vs boolean-only for v2.
- Q5 trial: runtime countdown vs calendar expiry + grace.
- Q6 Grafana plugins offline delivery (air-gap).
