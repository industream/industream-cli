# Swarm + Compose Integration Plan — Consolidated Findings

> **Audience**: Industream platform team (Cyril + colleague)
> **Status**: analysis complete, pending team sign-off before implementation
> **Source**: consolidated output of 4 analysis agents on `industream-cli`, `industream-stack/scripts/`, `industream-flowmaker/deployment/fm`, and the Compose vs Swarm stack files
> **Companion doc**: `RUNTIME-STRATEGY.md` (architecture rationale)
> **Date**: 2026-04-20

## TL;DR

- **Architecture validated**: bash-first with an optional TS wrapper (see `RUNTIME-STRATEGY.md`).
- **Compose and Swarm stack files are NOT fully mergeable.** Automatic override generation covers ~70%; the remaining 30% (secrets, reverse proxy, network driver) must be maintained manually.
- **`fm` (1721 lines) is split thematically**, not per command, because `cmd_caddy_rebuild` is called by `create` and `delete`.
- **~1075 lines of new TypeScript** to write, across 4 phases. Existing Swarm behavior is preserved by snapshot tests.
- **Two bugs found in `fm`**: `cmd_sync` and `cmd_init` are each defined twice (dead code).
- **5 product decisions are blocking implementation** (see §6).

---

## 1. Scope of the change

### What bash code exists today

| Codebase | Script / file | Lines | Role |
|---|---|---|---|
| `industream-stack/` | `scripts/deploy-swarm.sh` | 1146 | Swarm stack orchestrator |
| `industream-stack/` | `scripts/setup/create-secrets.sh` | 287 | `docker secret create` |
| `industream-stack/` | `scripts/generate/generate-certs.sh` | 235 | OpenSSL CA + TLS (runtime-agnostic) |
| `industream-stack/` | `scripts/generate/generate-uifusion-config.sh` | 181 | `envsubst` on UIFusion JSON (agnostic) |
| `industream-stack/` | `scripts/fetch-latest-versions.sh` | 137 | release-tracker fetch (agnostic) |
| `industream-stack/` | `scripts/quick-deploy.sh` | 480 | Interactive bootstrap wrapper |
| `industream-stack/` | ~40 other scripts under `maintenance/`, `platform/`, `operations/`, `bench/` | — | Ops, benchmarks, rotation |
| `industream-flowmaker/deployment/` | `fm` | 1721 | Compose multi-instance manager |

### What TS code exists today

- Entry point: `src/index.ts` (~150 lines) with Commander subcommands.
- Commands: `deploy`, `down`, `status`, `logs`, `secrets`, `install`, `config`, `license`, `update`, `uninstall`, `menu`, `worker add/list/remove`.
- Libs: `docker.ts`, `swarm-repo.ts`, `stack-filter.ts`, `config.ts`, `license.ts`, `keygen.ts`, `modules.ts`, `registry-login.ts`, `release-tracker.ts`, `external-workers.ts`.
- Tests (Vitest): `config.test.ts`, `docker.test.ts`, `external-workers.test.ts`, `license.test.ts`, `modules.test.ts`, `stack-filter.test.ts`, `swarm-repo.test.ts`.
- Packaging: Node SEA (Single Executable Application) via `sea-config.json`.

### Existing TS → bash call points

Only 4 places currently bridge TS to bash — **this is the delegation surface to extend**:

| TS file | Line | Script invoked |
|---|---|---|
| `commands/deploy.ts` | 135 | `scripts/deploy-swarm.sh` |
| `commands/secrets.ts` | 14 | `scripts/setup/create-secrets.sh` |
| `commands/versions.ts` | 32, 41 | `scripts/fetch-latest-versions.sh` |
| `utils/runner.ts` | 25 | Generic helper `runScript()` |

---

## 2. `fm` script breakdown

Full inventory of the 17 commands (line numbers in the current file):

| Command | Line | Args | Touches |
|---|---|---|---|
| `create` | 136 | `<name>` | Writes `instances/<name>/.env` + override ; calls `caddy:rebuild` |
| `up` | 285 | `<name> [--workers] [--uimaker] [--local]` | `docker compose -p fm-<name> up -d` |
| `down` | 352 | `<name>` | `docker compose down` |
| `ps` | 402 | `<name>` | `docker ps -a` |
| `logs` | 378 | `<name> [service]` | `docker compose logs -f` |
| `list` | 432 | — | scans `instances/*/.env` |
| `delete` | 719 | `<name>` | removes volumes, networks ; calls `caddy:rebuild` |
| `caddy:rebuild` | 485 | — | regenerates `docker-compose.infra.override.yml` from all instances |
| `caddy:stop` | 574 | — | `docker compose -p caddy down` |
| `caddy:delete` | 587 | — | removes `volumes/caddy/` |
| `caddy:logs` | 626 | — | `docker compose -p caddy logs -f` |
| `caddy:ca` | 674 | `[dest]` | `docker cp` the root CA |
| `cdn-reset` | 631 | `<name> [worker\|all]` | `docker exec rm` seed flag |
| `init` | 1344 | `<name>` | `curl` POST/PUT confighub |
| `sync` | 1168 | `<name>` | `gh api` versions.json → `.env` |
| `launch-worker` | 1464 | `<instance> [opts] <worker> [cmd...]` | `exec env` worker process |
| `hosts` | 839 | — | `ip addr` suggestions |

### Bugs found

- **Duplicate definitions**: `cmd_sync` at lines 872 **and** 1168, `cmd_init` at 1048 **and** 1344. Bash keeps the last definition; lines 872-1047 and 1048-1167 are dead code. Remove during extraction.

### Thematic split (recommended)

Per-command files would force circular sourcing because `cmd_create` and `cmd_delete` both call `cmd_caddy_rebuild`. Group by theme:

```
scripts/compose/
├── lib/common.sh        # log_*, get_existing_*, prompt*, colors, SCRIPT_DIR
├── fm-instance.sh       # create, up, down, ps, logs, list, delete
├── fm-caddy.sh          # caddy:{rebuild,stop,delete,logs,ca}
├── fm-sync.sh           # init, sync
├── fm-worker.sh         # launch-worker, cdn-reset
└── fm-hosts.sh          # hosts
```

Dispatcher (`scripts/industream` or `scripts/fm` compat alias) sources `lib/common.sh` then calls the right function.

### Bash pitfalls to respect during split

- **`set -euo pipefail`** must be duplicated in every sub-script.
- **`shopt -s nullglob` / `-u nullglob`** wraps every `instances/*/.env` scan.
- **Colors** (`RED`, `GREEN`, ...) must be sourced — `set -u` crashes on undefined vars.
- **`</dev/tty`** reads (lines 986, 1084-1088) are mandatory for interactive prompts when stdin is piped.
- **`exec env "${env_vars[@]}" "${process_cmd[@]}"`** in `launch-worker` replaces the process — TS wrapper must `spawn` with `stdio: inherit` and relay the exit code.

---

## 3. Compose vs Swarm stack files — mergeable or not?

**Short answer: NOT fully mergeable.** This overrides §3.8 of `RUNTIME-STRATEGY.md` — the auto-generated override is only partially viable.

### Per-service delta matrix (4 common services audited)

| Aspect | postgres | keycloak | uifusion | flowmaker-scheduler |
|---|---|---|---|---|
| Secrets model | Swarm `*_FILE` vs Compose inline | Same | Same | Same |
| Reverse proxy labels | Swarm `deploy.labels` Traefik vs Compose Caddyfile | Same | Same | Same |
| Network driver | Overlay vs bridge | Same | Same | Same |
| Volume naming | `${ENV}-postgres-data` vs `postgres_data` | Same | Same | Same |
| `deploy.replicas` | 1 | 1 | 1 | Swarm `replicas: 3` vs Compose single |
| `depends_on.condition` | Ignored by Swarm | Same | Same | `service_healthy` works in Compose, ignored in Swarm |

### What the generator CAN do (~70%)

1. Strip Swarm-only blocks (`deploy.replicas`, `deploy.placement`, `deploy.update_config`).
2. Lift `deploy.resources` → compose `mem_limit` / `cpus`.
3. Lift `deploy.restart_policy` → `restart: unless-stopped`.
4. Replace overlay with bridge network.

### What the generator CANNOT reliably do (~30%)

1. **Secrets conversion** (`*_FILE` → `secrets.file:` mount). Requires mapping Swarm external secrets to locally-generated files — non-trivial.
2. **Traefik labels → Caddyfile**. The two proxy configs have incompatible semantics (middleware chains, TLS providers). Needs manual Caddyfile maintenance.
3. **Network model change** (overlay encrypted vs bridge). Not cosmetic — attach policies differ.

### Recommendation (revised from §3.8)

**Keep two parallel file trees** with a validation script, instead of full auto-generation:

- `industream-stack/docker-stack.*.yml` — Swarm source of truth (unchanged).
- `scripts/compose/overlays/*.yml` — Compose-specific overlays (hand-maintained, slim).
- `scripts/compose/validate-parity.sh` — audits image tags, healthcheck URLs, environment variables across both trees and **fails CI if they drift on critical fields**.

Rationale: generating valid Compose from Swarm is a parser/AST project (yq transforms + label rewriter), roughly 2-3 days of work for a fragile result. A validation script is a few hours of work and keeps humans honest.

---

## 4. TS refactor — what changes, what doesn't

### Commands to refactor (5 files, polymorphic via `Runtime` interface)

| Command | Swarm-specific lines | Breaking changes |
|---|---|---|
| `deploy.ts` | L14-16 (3 envs hardcoded), L20-29 (`docker stack ls`), L37-38 (`industream-${env}`), L135 (`deploy-swarm.sh` hardcoded) | Delegate to `runtime.deploy()` |
| `status.tsx` | L6 (`getSwarmServices`), L27-39 (stack name + `isSwarmActive`), L155, L164 | `runtime.status()` ; `ServiceTable` shows `state` instead of `replicas` in Compose |
| `logs.ts` | L10-13 (stack name + service prefix `${stack}_${svc}`), L17-23, L32-37 | `runtime.logs(service, opts)` |
| `stop.ts` | L14 (stack name), L40 (`docker stack rm`) | `runtime.down()` |
| `secrets.ts` | L27-38 (`docker secret ls` + `${env}_` prefix), L63-70 ("cannot read back" — Swarm-only) | `runtime.secrets.list/regenerate/show` ; `show` is allowed in Compose (files are readable) |
| `install.tsx` | L9, L187-190 (`docker swarm init`), L330-353 (`deploy-swarm.sh`), L358-376 (polling `docker service ps`), L388-393 (`seed-confighub.sh`) | Add runtime prompt to `InstallConfigPrompt` ; seed ConfigHub via HTTP instead of Docker polling (runtime-agnostic) |

### Runtime-agnostic code (no change)

- `license.ts`, `keygen.ts` — HTTP Keygen.io flow.
- `modules.ts` — JSON read.
- `registry-login.ts` — `docker login` (both runtimes).
- `release-tracker.ts` — GitHub fetch.
- `config.ts` — extend with `runtime` key, API stable.
- `stack-filter.ts` — returns `excludedServices[]` ; Compose translates to `profiles:` or override removal.
- `commands/{license,update,config,menu}.tsx` — pure UX.
- `commands/worker` — depends on `external-workers.ts` audit (see §6.4).

### Snapshot tests before refactor (Phase 1 pre-requisite)

No current tests cover `runDeploy`, `runDown`, `runLogs`, `runSecrets`, `runStatus`. Add snapshot tests that mock `execa` and record the exact call sequence of today's `runDeploy`. Phase 1 must produce the same snapshot.

---

## 5. Runtime storage

Chosen: **`.env` as single source of truth** (bash-first principle).

- `platformDir/.env` holds `RUNTIME=swarm|compose`.
- TS helper `getRuntime(platformDir)` reads it via existing `loadEnvFile()`.
- Fallback: `"swarm"` if absent (rétro-compatibility with existing installs).
- `~/.config/industream/config.json` keeps only `platformDir` + `defaultEnvironment`.

Why: the bash dispatcher needs to decide fast-path routing in O(1) without spinning up Node. If runtime lived only in JSON, every `industream dev up` would pay Node startup just to read it.

---

## 6. Blocking product decisions

Each of these must be answered by the team **before Phase 2 starts**. Phase 1 is safe to do in parallel.

### 6.1 ConfigHub seeding mechanism
`install.tsx:358-393` currently polls `docker service ps ${stackName}_flowmaker-confighub`. Compose has no equivalent. **Decision**: switch to HTTP polling on the ConfigHub endpoint (runtime-agnostic and more robust). Requires the ConfigHub image to expose a readiness endpoint.

### 6.2 Environment vs instance model
Swarm: 3 hardcoded envs (`prod/dev/staging`). Compose (`fm`): free-form instance names.
**Decision**: keep `industream deploy --env prod` Swarm-only. Compose instances live under `industream dev create <name>`. Do not try to unify the two under a common "deployment" abstraction — forcing fit would leak Compose semantics into Swarm.

### 6.3 Production guard for Compose
`RUNTIME-STRATEGY.md` §6 says Compose must refuse production deploys. **Decision**: heuristic = refuse if `INDUSTREAM_DOMAIN` doesn't match `*.localhost`, `*.lan`, or an explicitly-configured dev suffix list. Override via `--allow-compose-prod` flag for rare edge-node deployments. Needs policy approval.

### 6.4 External workers in Compose mode
`external-workers.ts` (317 lines, not fully audited) probably uses `docker stack deploy`. **Decision needed**: does `industream worker add` support Compose in Phase 3, or stay Swarm-only initially? If Compose-compatible, add ~150 lines and audit fully.

### 6.5 Reverse proxy in Compose
Compose uses Caddy (from `fm`), Swarm uses Traefik. `ComposeRuntime.deploy()` must add `traefik` to `excludedServices` automatically. **Decision**: bundle a Caddyfile template in `scripts/compose/caddy/` or require user-provided one? Recommendation: bundle a default, let instance overrides customize.

### 6.6 Community Harbor migration (✅ clone done, consumer rewiring pending)

The BSL community images were moved from the legacy mirror project `842775dh…/flowmaker.community/*` to a dedicated public Harbor `39t88114.c1.gra9.container-registry.ovh.net` with 7 projects, 29 repos, 139 tags and anonymous pull. Premium workers (OPC-UA, RTSP, luminosity, GStreamer, audio, MS SQL, OSIsoft PI), `backup-monitor` and `monitoring/cadvisor` stay on the old Harbor under paid-plan robot credentials.

Impact on this plan:
- `ComposeRuntime` (Phase 2) ships `docker-compose.community.yml` pointed at the new Harbor, no login required.
- `SwarmRuntime` keeps `DOCKER_REGISTRY` pointing at the old Harbor for now, but the module resolver (`src/lib/modules.ts`) must learn to route per `license` field so BSL modules pull from the new Harbor while premium modules stay on the old one. Natural seam = `src/lib/registry-login.ts`.
- Producer GitHub Actions in 5 repos still need to be flipped to push to the new Harbor.

Full details, image lists, exclusions and commands: [`HARBOR-MIGRATION.md`](./HARBOR-MIGRATION.md).

---

## 7. Phased plan (cross-referenced with `RUNTIME-STRATEGY.md` §4)

| Phase | Deliverable | New LOC | Risk | Prerequisite |
|---|---|---|---|---|
| **0** | Snapshot tests on current `runDeploy`/`runDown`/`runLogs`/`runSecrets`/`runStatus` | +120 TS | low | — |
| **1** | `SwarmRuntime` extraction + `runtime` key in `.env` + prompt in `install.tsx` | +275 TS | medium | Phase 0 |
| **2** | `ComposeRuntime` + `SecretsBackend` compose + bash dispatcher + `fm` split | +425 TS, +1700 bash (reshuffled) | high | Phase 1, decisions 6.1 + 6.3 |
| **3** | `industream dev create/up/down/list/delete` sub-commands | +270 TS | medium | Phase 2 |
| **4** | `industream dev launch-worker` + `external-workers.ts` Compose support | +270 TS | high | Decision 6.4 |
| **5** | Deprecation of standalone `fm` (compat alias), documentation | — | low | Phase 4 stable |

**Total**: ≈ 1075 TS lines (new) + `fm` reshuffled into 6 thematic bash files.

**Estimated calendar**: phases 0-2 = 1 sprint (2 weeks). Phases 3-4 = 1 sprint. Phase 5 = 1 week after stabilization.

### Out-of-band work already completed (Harbor)

| Item | Status |
|---|---|
| New community Harbor provisioned (`39t88114…`, 7 public projects) | ✅ done |
| Clone 29 BSL repos / 139 tags via `scripts/ops/clone-harbor-community.sh` | ✅ done |
| Anonymous pull verified end-to-end | ✅ done |
| Producer GH Actions flipped to push to new Harbor | ⏳ pending |
| `industream-cli` dual-registry resolution (per `license`) | ⏳ pending |
| `docker-compose.community.yml` for Compose users | ⏳ pending (Phase 2) |
| Decommission `842775dh…/flowmaker.community/*` | ⏳ pending (after 2 releases) |

See [`HARBOR-MIGRATION.md`](./HARBOR-MIGRATION.md) for the full inventory.

---

## 8. What the colleague keeps (reassurance)

Every `fm` command is preserved with identical behavior. Only the location changes:

| Before | After | Change |
|---|---|---|
| `./fm create dev` | `./scripts/compose/fm-instance.sh create dev` OR `industream dev create dev` | Path + optional CLI wrapping |
| `./fm up dev --workers` | Same, or `industream dev up dev --workers` | Fast-path = bash direct (0 Node overhead) |
| `./fm caddy:rebuild` | `./scripts/compose/fm-caddy.sh rebuild` | Same script, split into theme file |
| `./fm launch-worker v2 timer` | `./scripts/compose/fm-worker.sh launch v2 timer` | Split |

An optional compat wrapper `scripts/fm` that forwards to the new layout keeps muscle memory working.

---

## 9. Immediate next steps

1. **Team review** of this document + `RUNTIME-STRATEGY.md`.
2. **Answer the 5 blocking decisions in §6.**
3. **Create branch** `integration/compose-swarm` in `industream-cli` and `industream-stack` (sync by PR cross-link).
4. **Start Phase 0** (snapshot tests) — can begin before decisions are finalized.
5. **Assign owners**: colleague owns the `fm` split into `scripts/compose/*`. Cyril (or agent) owns TS runtime abstraction. Both merge via coordinated PRs.

## Appendix A — References

- Architecture rationale: [`RUNTIME-STRATEGY.md`](./RUNTIME-STRATEGY.md)
- Harbor migration: [`HARBOR-MIGRATION.md`](./HARBOR-MIGRATION.md)
- CLI entry point: `industream-cli/src/index.ts`
- Current Swarm deploy: `industream-cli/src/commands/deploy.ts:60-141`
- Current Swarm stack: `industream-stack/docker-stack.yml`
- Current deploy script: `industream-stack/scripts/deploy-swarm.sh`
- Current Compose script (source): `industream-flowmaker/deployment/fm`
- Compose stack files: `industream-flowmaker/deployment/docker-compose.*.yml`
- Harbor clone script: `industream-stack/scripts/ops/clone-harbor-community.sh`

### Registry endpoints

| Endpoint | Role | Auth |
|---|---|---|
| `39t88114.c1.gra9.container-registry.ovh.net` | Community Harbor — 7 public projects, BSL images | Anonymous pull |
| `842775dh.c1.gra9.container-registry.ovh.net` | Legacy / premium Harbor — paid add-ons, private projects | Robot account per plan |
| `842775dh…/flowmaker.community/*` | Legacy community mirror — to be decommissioned | `community-public` robot (transitional) |
