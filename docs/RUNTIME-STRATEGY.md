# Swarm + Compose Merger Strategy for `industream-cli`

> **Audience**: Industream platform team
> **Status**: proposal (pending validation)
> **Authors**: Cyril / Claude
> **Date**: 2026-04-20

## TL;DR

We unify the two deployment paths (`industream-stack` on Swarm, `flowmaker/deployment/fm` on Compose) **under the single `industream` CLI**, with one runtime chosen per deployment:

- **Swarm** → canonical runtime in **production** (raft secrets, shared Traefik, multi-env, security/reliability audit already baked in).
- **Compose** → default runtime for **dev/local** (multi-instance, Caddy, easy overrides, zero Swarm setup).

The two runtimes do not coexist on the same deployment: it is **one or the other**, chosen at install time.

### Core principle: bash-first, TypeScript optional

> **Bash is the source of truth for deployment. TypeScript is a UX layer on top, never mandatory.**

- All bash scripts (Swarm + Compose) are **directly executable**, no TypeScript CLI required.
- The TS CLI (`industream`) is a dispatcher plus UX commands (Ink menu, status dashboard, license, modules).
- Developers who want to stay in pure bash **can** (`./scripts/compose/fm-up.sh dev`).
- End users who want interactivity go through `industream`.
- **No Node overhead** on the Docker-critical path: the bash dispatcher routes straight to native scripts without spinning up the TS runtime.

---

## 1. Context — what exists today

### `industream-stack` (Swarm side)
- Files `docker-stack.*.yml` (core, data, ironstream, workers, monitoring, …).
- Script `scripts/deploy-swarm.sh` consumed by `industream deploy`.
- **Three hardcoded environments**: `prod`, `dev`, `staging`, prefix `${ENV}_` applied to volumes/networks/secrets.
- Secrets managed via `docker secret create` (Swarm raft).
- Shared **Traefik** reverse proxy, labels under `deploy.labels`.
- TypeScript CLI (`industream-cli`) already covers: `install`, `deploy`, `down`, `logs`, `status`, `secrets`, `update`, `license`, `worker add/list/remove`.

### `industream-flowmaker/deployment` (Compose side)
- Files `docker-compose.*.yml` (core, datacatalog, workers, infra, ports).
- Bash script `fm` (~1700 lines) for orchestration.
- **Free-form multi-instance model**: `fm create <name>` → `instances/<name>/` folder with its own `.env` and `docker-compose.override.yml`.
- No Swarm secrets: everything via `.env` and local files.
- Shared **Caddy** local reverse proxy, auto-HTTPS via self-signed CA.
- Extra commands: `launch-worker` (run a worker locally against a running Docker instance), `sync`/`init` (confighub), `cdn-reset`.

### Problem
- Two different UXs, two sources of truth for images and versions.
- Developers must learn two tools.
- Security patches and version bumps drift over time.

---

## 2. Decision — one CLI, two runtimes

> `industream-cli` becomes **the single entry point**. It owns a runtime abstraction and delegates to one of two engines.

### Runtime selection rules

| Context | Runtime | Why |
|---|---|---|
| Client production (VPS, VM, on-prem) | **Swarm** | Raft secrets, restart policies, resources, already hardened |
| Local dev (developer workstation) | **Compose** | Parallel multi-instance, easy hot-reload, zero Swarm ops |
| CI / integration | **Compose** | Fast to bring up/down, no global swarm init |
| Very constrained single-node edge | Single-node Swarm | The hardened stack already runs on 1 node |

**Important**: no `--runtime` flag lets you mix both on the same environment. Runtime is locked at `install` time.

---

## 3. Target architecture

### 3.0 Two-layer model

```
┌──────────────────────────────────────────────────────────┐
│  UX LAYER (TS, optional)                                 │
│  industream-cli/src/                                      │
│    • Commander (arg parsing)                              │
│    • Ink (menu, status dashboard)                         │
│    • License / Modules / User config (~/.config)          │
│    • TS routers that delegate to bash scripts             │
└──────────────────────────────────────────────────────────┘
                         │
                         │ execa (stdio: inherit)
                         ▼
┌──────────────────────────────────────────────────────────┐
│  BASH DISPATCHER (industream-stack/scripts/industream)    │
│    • Fast path : direct bash routes (no Node)             │
│    • Slow path : launches the TS binary (menu, status)    │
└──────────────────────────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          ▼                              ▼
┌──────────────────────┐      ┌──────────────────────┐
│  SWARM SCRIPTS        │      │  COMPOSE SCRIPTS     │
│  scripts/deploy-      │      │  scripts/compose/    │
│    swarm.sh (existing)│      │    fm-create.sh      │
│  scripts/setup/       │      │    fm-up.sh          │
│  scripts/generate/    │      │    fm-down.sh        │
│                       │      │    fm-launch-worker  │
└──────────────────────┘      └──────────────────────┘
                         │
                         ▼
                    ┌──────────┐
                    │  DOCKER  │
                    └──────────┘
```

**Key property**: the TS layer is a **UX option**, not a dependency. Bash scripts are standalone and complete.

### 3.1 Bash vs TS ownership

| Stays in bash | Goes to TS |
|---|---|
| Any call to `docker`, `docker compose`, `docker stack`, `docker secret` | Argument parsing (Commander) |
| Cert/override/secret file generation | Interactive menus (Ink) |
| Compose instance create/delete | Status dashboard (colored tables) |
| Main dispatcher (`industream`) | License activation (JWT) |
| Simple text prompts (`read -rp`) | Module management (modules.json) |
|  | User config (`~/.config/industream`) |

**Rule of thumb**: if it touches Docker or the platform filesystem → **bash**. If it is CLI UX itself → **TS**.

### 3.2 Team impact

| Persona | Workflow | Nothing changes? |
|---|---|---|
| **Bash dev (author of `fm`)** | `./scripts/compose/fm-up.sh dev --workers` | ✅ Same as today's `./fm up dev --workers`, only the path changes |
| **New user** | `industream` then menu | New, Ink-guided |
| **Production operator** | `industream deploy --env prod` | Identical to today |
| **TS contributor** | `src/lib/runtimes/compose.ts` | New, but bounded |

### 3.3 Bash dispatcher — the heart of the architecture

The `industream` binary is **not** a Node wrapper over everything. It is a **bash dispatcher** that decides line-by-line whether the command goes through Node or not.

```bash
#!/usr/bin/env bash
# scripts/industream (main dispatcher)
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PLATFORM_DIR="${SCRIPT_DIR%/scripts}"

case "${1:-}" in
  # === FAST PATH : direct bash, 0 Node overhead ===
  dev)
    shift
    cmd="${1:-help}"; shift || true
    exec "$PLATFORM_DIR/scripts/compose/fm-${cmd}.sh" "$@"
    ;;
  deploy|down)
    exec "$PLATFORM_DIR/scripts/deploy-swarm.sh" "$@"
    ;;
  logs|ps)
    exec "$PLATFORM_DIR/scripts/docker-${1}.sh" "${@:2}"
    ;;

  # === SLOW PATH : goes through Node/Ink for UX ===
  status|menu|install|license|config|update|secrets|worker|"")
    exec node "$PLATFORM_DIR/industream-cli/dist/index.js" "$@"
    ;;

  *)
    echo "Unknown command: $1" >&2
    exec node "$PLATFORM_DIR/industream-cli/dist/index.js" --help
    ;;
esac
```

**Direct consequence for the bash dev**:
```bash
industream dev up myinstance --workers   # → exec fm-up.sh, ~5ms startup
industream dev list                       # → exec fm-list.sh, ~5ms
industream dev launch-worker v2 timer    # → exec fm-launch-worker.sh, ~5ms
```
**Not a single Node call on the daily workflow.** Same UX as today's `./fm`.

And for the user who wants the UI:
```bash
industream            # → Ink menu (Node, 150ms, acceptable to start a session)
industream status     # → Ink dashboard (Node, 150ms, acceptable)
```

### 3.4 Runtime abstraction

One TypeScript contract, two implementations:

```ts
// src/lib/runtimes/index.ts
export interface Runtime {
  readonly name: "swarm" | "compose";
  deploy(env: Environment, opts: DeployOptions): Promise<void>;
  down(env: Environment): Promise<void>;
  status(): Promise<StackStatus>;
  logs(service: string, opts: LogsOptions): Promise<void>;
  secrets: SecretsBackend;
}

export function getRuntime(config: PlatformConfig): Runtime {
  return config.runtime === "swarm" ? new SwarmRuntime(config) : new ComposeRuntime(config);
}
```

### 3.5 Target file tree

```
industream-cli/
├── src/
│   ├── lib/
│   │   ├── runtimes/
│   │   │   ├── index.ts          # factory + detection
│   │   │   ├── swarm.ts          # wraps scripts/deploy-swarm.sh
│   │   │   └── compose.ts        # docker compose up + generated overrides
│   │   ├── secrets/
│   │   │   ├── swarm.ts          # docker secret create
│   │   │   └── compose.ts        # files under ./secrets/
│   │   └── config.ts             # stores { runtime, platformDir, … }
│   └── commands/
│       ├── deploy.ts             # delegates → runtime.deploy()
│       ├── down.ts               # same
│       ├── status.ts             # same
│       └── install.tsx           # prompts "Swarm or Compose?" on first install

industream-stack/
├── scripts/
│   ├── industream                # bash dispatcher (new)
│   ├── deploy-swarm.sh           # existing
│   ├── setup/create-secrets.sh   # gains --mode swarm|compose
│   ├── generate/
│   │   ├── generate-certs.sh
│   │   ├── generate-uifusion-config.sh
│   │   └── compose-override.sh   # new: generates compose override from stack
│   └── compose/                  # new: split of fm
│       ├── lib/common.sh
│       ├── fm-create.sh
│       ├── fm-up.sh
│       ├── fm-down.sh
│       ├── fm-list.sh
│       ├── fm-logs.sh
│       ├── fm-launch-worker.sh
│       ├── caddy-rebuild.sh
│       └── ...
```

### 3.6 Secrets — the real hard point

This is the biggest split between the two runtimes.

| Aspect | Swarm | Compose |
|---|---|---|
| Creation | `docker secret create` | file under `./secrets/${ENV}_<name>` |
| Mount | `/run/secrets/<name>` (native) | `secrets: { file: … }` in compose |
| Rotation | `docker service update --secret-rm/add` | service restart + file replacement |
| Backup | raft (on each manager) | filesystem (must be in backup plan) |

**Plan**: `scripts/setup/create-secrets.sh` gains a flag `--mode swarm|compose`. For compose, it writes files under `${platformDir}/secrets/` (perms 0600) and generates a compose override that declares the expected `secrets:` section.

### 3.7 Reverse proxy

| Runtime | Proxy | Notes |
|---|---|---|
| Swarm | **Traefik** (separate stack, overlay `traefik-public`) | Labels under `deploy.labels` |
| Compose dev | **Caddy** (taken from `fm`) | Labels under `labels`, local auto-HTTPS |

To avoid maintaining two label sets, the compose override is **generated** from `docker-stack.yml` (see §3.8).

### 3.8 Registries — dual Harbor (BSL + premium)

Since April 2026 the community BSL images live on a dedicated public Harbor (`39t88114.c1.gra9.container-registry.ovh.net`, anonymous pull), while premium add-ons stay on the legacy Harbor (`842775dh…`) behind per-plan robot credentials. Impact on the runtime split:

- **Compose runtime** pulls exclusively from the new Harbor by default, no `docker login` step. A future `docker-compose.community.yml` is the user-facing file.
- **Swarm runtime** resolves the registry per module `license` field in `modules.json` — BSL modules → new Harbor, premium modules → old Harbor. `registry-login.ts` must call `docker login` only for the premium side.
- **Secrets backend**: registry credentials in Swarm stay as `docker secret` entries (`registry_community_token` for legacy compat, `registry_premium_token` for the old Harbor). Compose uses a single file-based secret or no credentials at all for BSL.

Detailed inventory, exclusions and migration status: see `industream-cli/docs/HARBOR-MIGRATION.md`.

### 3.9 Compose override generator

A script `scripts/generate/compose-override.sh` that:
1. Reads `docker-stack.yml`.
2. Strips Swarm-only bits (`deploy.replicas`, `deploy.placement`, `deploy.update_config`).
3. Lifts `deploy.resources` to compose `mem_limit` / `cpus`.
4. Lifts `deploy.labels` to `labels`.
5. Replaces `deploy.restart_policy` with `restart: unless-stopped`.
6. Rewrites the external `secrets:` section as file-based secrets.

Output: `docker-compose.generated.yml`, never hand-edited, regenerated on every `deploy` in compose mode.

---

## 4. Phasing — how we get there

Each phase is a **self-contained commit** that passes tests and breaks nothing in production.

### Phase 1 — Extract `SwarmRuntime` (zero-risk)
**Goal**: lift the current logic from `deploy.ts:60-141` into `src/lib/runtimes/swarm.ts` **without changing behavior**.

- `new SwarmRuntime(config).deploy(env, opts)` does exactly what `runDeploy` does today.
- `deploy.ts`, `down.ts`, `logs.ts`, `status.ts` become routers to the selected runtime.
- Unit tests mock the `execa` calls.
- `getRuntime()` always returns `SwarmRuntime` (no `ComposeRuntime` yet).

**Merge criterion**: `industream deploy --env prod` makes the same system calls as before.

### Phase 2 — Minimal `ComposeRuntime`
**Goal**: enable `industream deploy --runtime compose` on a dev workstation.

- `scripts/setup/create-secrets.sh --mode compose` writes secret files.
- `scripts/generate/compose-override.sh` produces `docker-compose.generated.yml`.
- `ComposeRuntime.deploy()` runs: `docker compose -f docker-stack.yml -f docker-compose.generated.yml -f docker-compose.override.yml --env-file .env up -d`.
- Traefik replaced by local Caddy (lifted from `fm/caddy:rebuild`).

**Merge criterion**: full stack up on dev workstation, reachable at `https://*.industream.localhost`.

### Phase 3 — Multi-instance dev (the `fm` model)
**Goal**: let a dev run 2+ instances in parallel.

- New sub-command `industream dev` with `create`, `up`, `down`, `list`, `delete`.
- Each instance = `instances/<name>/` folder with its own `.env` and override.
- Forced runtime = compose, project name = `industream-dev-<name>`.
- Shared Caddy (one Caddy instance for all dev instances).

**Merge criterion**: `industream dev create foo` + `industream dev create bar` run in parallel without conflict.

### Phase 4 — Worker dev flow
**Goal**: lift `fm launch-worker` into the CLI for worker devs.

- `industream dev launch-worker <instance> <worker-name> [cmd…]`.
- Injects the instance's service addresses as env vars.
- Useful to iterate on a worker without rebuilding images.

**Merge criterion**: a dev can launch a local worker against a compose instance.

### Phase 5 — `fm` deprecation
Once phase 4 is stable, `fm` becomes a thin wrapper that redirects to `industream dev …`, then is removed after one release cycle.

---

## 5. What does NOT change

- Files `docker-stack.*.yml` remain **the single source of truth**. The compose override is derived from them, never the other way.
- Production workflow is unchanged: `industream deploy --env prod` still calls `scripts/deploy-swarm.sh`.
- Existing Swarm secrets are not migrated.
- Licensing, backups: untouched.
- Registries: the **premium** Harbor (`842775dh…`) is untouched. A **second** Harbor (`39t88114…`) was added in April 2026 for public BSL images — consumer-side code must resolve per `license` (see §3.8 and `HARBOR-MIGRATION.md`).

---

## 6. Risks and mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| Drift between `docker-stack.yml` and the generated compose override | Medium | Override **generated** on every deploy, never committed |
| A dev thinks they are on swarm and deploys compose to production | Low | Explicit refusal: `ComposeRuntime` blocks if `NODE_ENV=production` or a public domain is detected |
| Compose secret files accidentally checked into git | Medium | `.gitignore` + pre-commit hook that refuses any `secrets/**` |
| Maintaining two reverse proxies (Traefik + Caddy) | Low | Caddy for local dev only, no prod support |
| Loss of `fm` features during deprecation | Medium | Phases 3-4 explicitly port every `fm` command before deprecation |

---

## 7. Points to settle with the team

1. **Who validates the architecture before code?** (platform architect, tech lead)
2. **Compose override: generated or committed?** I propose **generated**, to be confirmed.
3. **Dev Caddy: keep the existing `fm` CA or standardize on mkcert?**
4. **Timeline**: phases 1-2 fit one sprint; phases 3-4 depend on worker needs.

---

## 8. Appendices

### A. Target commands after merger

```bash
# Installation (asks for runtime once)
industream install --domain foo.example.com --tls letsencrypt

# Production — exactly as today
industream deploy --env prod
industream down --env prod
industream logs keycloak
industream status

# Multi-instance dev (phase 3)
industream dev create feature-x
industream dev up feature-x --with-workers
industream dev launch-worker feature-x timer
industream dev down feature-x
industream dev list
```

### B. Files to create / modify

| File | Action | Phase |
|---|---|---|
| `src/lib/runtimes/index.ts` | new | 1 |
| `src/lib/runtimes/swarm.ts` | new (extracted from `deploy.ts`) | 1 |
| `src/lib/runtimes/compose.ts` | new | 2 |
| `src/lib/secrets/{swarm,compose}.ts` | new | 2 |
| `src/commands/deploy.ts` | refactor to router | 1 |
| `src/commands/down.ts`, `status.ts`, `logs.ts` | refactor to router | 1 |
| `src/commands/install.tsx` | add runtime prompt | 1 |
| `src/commands/dev/*` | new sub-tree | 3-4 |
| `scripts/setup/create-secrets.sh` | `--mode` flag | 2 |
| `scripts/generate/compose-override.sh` | new | 2 |
| `scripts/industream` | new bash dispatcher | 1 |
| `scripts/compose/fm-*.sh` | new (split from `fm`) | 2-3 |
| `docs/RUNTIME-STRATEGY.md` | this document | 0 |

### C. Existing code references

- CLI entry point: `industream-cli/src/index.ts`
- Current deploy: `industream-cli/src/commands/deploy.ts:60-141`
- Swarm stack: `industream-stack/docker-stack.yml`
- Swarm script: `industream-stack/scripts/deploy-swarm.sh`
- Compose script (to port): `industream-flowmaker/deployment/fm`
- Compose files: `industream-flowmaker/deployment/docker-compose.*.yml`
