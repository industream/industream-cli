# industream-cli — v2 migration (legacy stack → unified deploy)

> Branch `feat/v2-unified-migration`. Goal: make the CLI *ultra simple* — the
> user picks **runtime + edition (+ license for EE)**, the CLI selects the right
> tree/bundle and runs the right install. Nothing else to think about.

## Why
The current CLI targets the **legacy** deployment model:
- `modules.json` → `docker-stack.*.yml` (per-file stack list).
- Orchestration via `deploy-swarm.sh`, `generate-uifusion-config.sh`, `create-secrets.sh`.
- Old service names `uifusion` / `uifusion-api`, image patterns `uifusion/{ui,api}`.

The platform moved to the **unified tree** (`industream-stack/unified/`):
- Neutral `base/*.yml` + thin `runtime.{swarm,compose}.yml` overlays.
- One assembler: `scripts/deploy.sh --runtime --edition --env --bundle --groups`.
- License-aware **bundles** (`releases/bundle-platform-<ver>/`, full-ref `${X_IMAGE}`).
- T1 rename → `industream-hub-backend` / `industream-hub-frontend`.
- A shared `postgres` + dedicated compose DBs, vendored `base/config/`.

The CLI must be retargeted onto this model. See the live VM gate for the exact
runtime behaviour: `industream-stack/unified/RESUME.md` (T7) + branch
`feat/compose-ce-gate-fixes` (the compose fixes proven on .41).

## Decisions (locked)
- **Doctor = check + provision.** Diagnose, then offer to create what's missing.
- **EE license = Keygen license token.** Its metadata carries `harborCredentials`
  (robot user/secret) → `ensureRegistryLogin()` (already in `lib/registry-login.ts`)
  logs into the enterprise Harbor `39t88114…`. Community → GHCR, anonymous.
  (License validation is still pseudo-tested — treat a missing/invalid license as
  a FAIL with a clear remediation, never a hard crash.)
- **Single driver.** The CLI is the one front door; under the hood it calls the
  unified `scripts/deploy.sh`. The bash `scripts/industream` driver is the
  reference for the arg mapping.

## Phases
| Phase | Scope | State |
|---|---|---|
| **P1** | `industream doctor` — preflight (ask runtime/edition/license → check deps → provision) | **in progress** |
| P2 | retarget `deploy`/`install` → call `unified/scripts/deploy.sh` (bundle+groups), drop `deploy-swarm.sh` path | todo |
| P3 | rewrite `modules.json` → group/service map of the unified tree (base/overlays), rename `uifusion*`→`industream-hub-*` | todo |
| P4 | `lib/runtimes/{swarm,compose}.ts` → thin wrappers over `deploy.sh` (kill `generate-uifusion-config.sh`) | todo |
| P5 | secrets backends aligned (swarm external `${ENV}_*` / compose file secrets under `SECRETS_DIR`) | todo |
| P6 | tests + SEA build green; retire legacy code paths | todo |

## P1 — `doctor` design
Flow: `industream doctor [--runtime] [--edition] [--env] [--fix] [-y]`
1. Resolve **runtime** (swarm=prod / compose=dev), **edition** (ce/ee), **env** — prompt if absent.
2. Locate the unified tree: `<platformDir>/unified` (`platformDir` from `~/.industream/config.json`).
3. Run checks (PASS / WARN / FAIL), each with an optional `fix()`:
   - **common:** docker daemon · docker compose v2 · python3 · unified tree + `deploy.sh` ·
     a release bundle (`releases/bundle-platform-*`) · single env sources
     (`registries/versions/auth/runtime.<rt>.env`) · `.env.<env>` core vars ·
     **`base/config/` real files** (the bind-mount files — missing ones make Docker
     create root dirs → silent failures; the #1 gate bug).
   - **swarm:** swarm active · `traefik-shared_traefik-public` external net ·
     external secrets `${ENV}_*` (postgres_admin/datacatalog_db/grafana_*/minio_*/
     influx_*/timescaledb/databridge_pg [+ EE: logto_db_url/logto_db_password]).
   - **compose:** `FM_NETWORK` external net · file secrets under `SECRETS_DIR`
     (same set, file-named, no `${ENV}_` prefix).
   - **EE (both):** cached Keygen license valid · enterprise Harbor login
     (`ensureRegistryLogin`) · an enterprise image is pullable.
4. With `--fix`: run the fixes (confirm unless `-y`) — `docker swarm init`,
   `docker network create`, generate/create secrets, `docker login`,
   `render-bundles.sh <ver>`.
5. Verdict: **READY** (all green) prints the exact `deploy.sh` command to run.
