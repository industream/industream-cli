# Community Harbor Migration — Snapshot

> **Audience**: Industream platform team (producers, CLI maintainers, ops)
> **Status**: clone complete, consumer-side rewiring pending
> **Companion docs**: [`INTEGRATION-PLAN.md`](./INTEGRATION-PLAN.md), [`RUNTIME-STRATEGY.md`](./RUNTIME-STRATEGY.md)
> **Date**: 2026-04-20

## TL;DR

The community (BSL 1.1) images used to live under `842775dh.c1.gra9.container-registry.ovh.net/flowmaker.community/*` as a manual mirror of the private Harbor, which was fragile and forced every GitHub Action to push twice. A second OVH Harbor — `39t88114.c1.gra9.container-registry.ovh.net` — now hosts the community images across **7 public projects, 29 repos, 139 tags**, with anonymous pull enabled. Premium workers stay on the old Harbor behind the `community-public` robot credentials. This document records what was migrated, what was intentionally left out, and what still needs to be rewired.

---

## 1. Context

- **Old layout** — one Harbor (`842775dh…`) held everything: private per-project repos (`flowmaker.core`, `flowmaker.boxes`, `datacatalog`, …) plus a flat mirror project `flowmaker.community/*` kept in sync by hand. Every producer pipeline had to push twice (once to the canonical project, once to the community mirror) or be patched retroactively.
- **Problems** — (a) mirror drift when a producer forgot the second push, (b) the mirror still required auth, so end users had to be handed a `community-public` robot password, (c) one-way: removing or retagging an image on the source left orphan tags on the mirror.
- **Goal** — give BSL users a true public registry, remove the second push, and cleanly separate BSL (public) from premium (paid, still private).

---

## 2. New Harbor layout

**Registry**: `39t88114.c1.gra9.container-registry.ovh.net`
**Access**: anonymous pull for all 7 projects; push requires an admin/robot account (Terraform-managed, not in this doc).

| Project | Repos | Purpose |
|---|---:|---|
| `flowmaker.core` | 6 | Scheduler, frontend, confighub, logger, CDN (server + cache) |
| `flowmaker.boxes` | 16 | FlowMaker worker images (BSL only — see §3 for exclusions) |
| `flowmaker.infra` | 1 | Worker manager |
| `datacatalog` | 2 | DataCatalog API + UI |
| `grafana` | 1 | `grafana-industream` (custom plugin bundle) |
| `timeseries` | 1 | Timeseries API (reused by InfluxDB + Postgres DataBridge) |
| `uifusion` | 2 | UIFusion UI + API |

**Total**: 29 repos, 139 tags as of the initial clone.

### Repos per project

| Project | Repo | Source of truth |
|---|---|---|
| flowmaker.core | cdn-cache | `industream-flowmaker/cdn-cache` |
| flowmaker.core | cdn-server | `industream-flowmaker/cdn-server` |
| flowmaker.core | flowmaker-confighub-v2 | `industream-flowmaker/confighub` |
| flowmaker.core | flowmaker-front | `industream-flowmaker/frontend` |
| flowmaker.core | flowmaker-launcher | `industream-flowmaker/scheduler` |
| flowmaker.core | flowmaker-logger | `industream-flowmaker/logger` |
| flowmaker.boxes | flow-box-conditional-dataset-validator | `industream-workers` |
| flowmaker.boxes | flow-box-data-logger | `industream-workers` |
| flowmaker.boxes | flow-box-datacatalog-mapper | `industream-workers` |
| flowmaker.boxes | flow-box-enqueue | `industream-workers` |
| flowmaker.boxes | flow-box-equation-solver | `industream-workers` |
| flowmaker.boxes | flow-box-http | `industream-workers` |
| flowmaker.boxes | flow-box-influx-client | `industream-workers` |
| flowmaker.boxes | flow-box-js-expression | `industream-workers` |
| flowmaker.boxes | flow-box-minio-sink | `industream-workers` |
| flowmaker.boxes | flow-box-modbus-tcp | `industream-workers` |
| flowmaker.boxes | flow-box-mqtt-client | `industream-workers` |
| flowmaker.boxes | flow-box-notification | `industream-workers` |
| flowmaker.boxes | flow-box-postgres-client | `industream-workers` |
| flowmaker.boxes | flow-box-test-data-generator | `industream-workers` |
| flowmaker.boxes | flow-box-timer | `industream-workers` |
| flowmaker.boxes | flow-box-timeseries-workers | `industream-workers` |
| flowmaker.infra | flowmaker-worker-manager | `industream-flowmaker/worker-manager` |
| datacatalog | api | `industream-datacatalog/api` |
| datacatalog | ui | `industream-datacatalog/ui` |
| grafana | grafana-industream | `industream-grafana` |
| timeseries | api | `industream-databridge` |
| uifusion | api | `industream-uifusion/api` |
| uifusion | ui | `industream-uifusion/ui` |

---

## 3. Premium exclusions (NOT migrated)

Source of truth: `industream-cli/modules.json` — field `license`. Only `"bsl"` images were cloned. The following premium images stay exclusively on the old Harbor (under their private projects) and keep requiring `community-public` or paid-plan credentials:

| Image | License | Entitlement |
|---|---|---|
| `flowmaker.boxes/flow-box-opc-ua-client` | proprietary | — |
| `flowmaker.boxes/flow-box-rtsp-client` | proprietary | — |
| `flowmaker.boxes/flow-box-luminosity-box` | proprietary | — |
| `flowmaker.boxes/flow-box-gstreamer-client` | proprietary | `PRODUCT_DATACATALOG` |
| `flowmaker.boxes/flow-box-audio-client` | proprietary | `PRODUCT_DATACATALOG` |
| `flowmaker.boxes/flow-box-mssql-client` | proprietary | `ADDON_DB_MSSQL` |
| `flowmaker.boxes/flow-box-osisoft-pi-client` | proprietary | `ADDON_DB_OSISOFT` |
| `flowmaker.infra/backup-monitor` | proprietary | `ADDON_BACKUP` |
| `monitoring/cadvisor` | proprietary | `ADDON_BACKUP` |

Timescale (`timescale/timescaledb`, `timeseries/api` used as `databridge-timescaledb`) is flagged `proprietary` in `modules.json` via the `ADDON_DB_TIMESCALE` entitlement — the image binary is already on Docker Hub / Timescale's registry, so no clone is needed; gating is done by the CLI license check, not by the registry.

---

## 4. Credentials summary

| Registry | Use | Auth |
|---|---|---|
| `39t88114.c1.gra9.container-registry.ovh.net` (new, community) | Pull BSL images — end users, community plan | **Anonymous pull** (no credentials) |
| `842775dh.c1.gra9.container-registry.ovh.net` (old, premium + mirror) | Pull premium add-on images under a paid plan | Robot account (per plan), still provisioned by the license server |
| `842775dh…/flowmaker.community/*` | Legacy community mirror | `community-public` robot — **to be decommissioned** (see §6) |

The old Harbor itself is **not** going away: it still hosts the private/premium projects. Only the `flowmaker.community/*` mirror project becomes redundant once all consumers have been flipped.

---

## 5. Migration steps — done

1. **Created 7 public projects** on `39t88114…` via Harbor UI (`flowmaker.core`, `flowmaker.boxes`, `flowmaker.infra`, `datacatalog`, `grafana`, `timeseries`, `uifusion`), all with `public = true`.
2. **Cloned images with `crane`** using `industream-stack/scripts/ops/clone-harbor-community.sh`. The script walks the 29 BSL repos listed inline (cross-referenced against `modules.json`), mirrors every tag from `842775dh/flowmaker.community/<sub>/<repo>` to `39t88114/<sub>/<repo>`, preserving digests + multi-arch + signatures. Premium repos are intentionally absent from the script's `REPOS=()` array.
3. **Verified counts** with `crane ls` and the Harbor v2.0 API: 29 repos, 139 tags, no failed copies.
4. **Confirmed anonymous pull** from a machine without any docker login — all 29 repos resolve.

---

## 6. Next steps — not yet done

1. **Patch producer GitHub Actions** in the 5 repos that build community images so they push to `39t88114…/<project>/<image>` instead of (or in addition to, during transition) `842775dh…/flowmaker.community/<project>/<image>`. Producers affected:
   - `industream-flowmaker` (core, confighub, logger, frontend, cdn-*, worker-manager)
   - `industream-workers` (16 BSL workers)
   - `industream-datacatalog` (api, ui)
   - `industream-uifusion` (api, ui)
   - `industream-grafana` (grafana-industream)
2. **Dual-registry support in `industream-cli`** — the TS code currently reads `DOCKER_REGISTRY` as a single value. It must resolve to the new Harbor for BSL modules and to the old Harbor for modules flagged `license !== "bsl"`. Natural seam: `src/lib/modules.ts` (module metadata) + `src/lib/registry-login.ts` (login routine).
3. **Ship `docker-compose.community.yml`** — the Compose-runtime integration (see `INTEGRATION-PLAN.md` §3, §6.3) must default to the anonymous new Harbor when no license is present. This is the file Compose users will point `docker compose -f` at without running `docker login` first.
4. **Decommission `flowmaker.community/*`** on `842775dh…` once producers are patched and at least one release cycle has shipped. Keep the old project read-only for 2 releases, then delete.

---

## 7. Commands

### Clone (historical — already run)

```bash
export SOURCE_USER=<old-harbor-admin> SOURCE_PASS=<…>
export DEST_USER=<new-harbor-admin>  DEST_PASS=<…>
./industream-stack/scripts/ops/clone-harbor-community.sh          # full run
./industream-stack/scripts/ops/clone-harbor-community.sh --dry-run
./industream-stack/scripts/ops/clone-harbor-community.sh --repo flow-box-timer --skip-existing
```

### Verify public pull (no auth)

```bash
docker logout 39t88114.c1.gra9.container-registry.ovh.net
docker pull 39t88114.c1.gra9.container-registry.ovh.net/flowmaker.boxes/flow-box-timer:latest
```

### Inspect registry structure

```bash
# List projects (anonymous)
curl -s https://39t88114.c1.gra9.container-registry.ovh.net/api/v2.0/projects | jq '.[].name'

# List repos for a project
curl -s 'https://39t88114.c1.gra9.container-registry.ovh.net/api/v2.0/projects/flowmaker.boxes/repositories?page_size=100' \
  | jq '.[].name'

# List tags for a repo
crane ls 39t88114.c1.gra9.container-registry.ovh.net/flowmaker.boxes/flow-box-timer
```

---

## 8. References

- Clone script: `industream-stack/scripts/ops/clone-harbor-community.sh`
- License source of truth: `industream-cli/modules.json`
- Integration plan (Compose + Swarm): [`INTEGRATION-PLAN.md`](./INTEGRATION-PLAN.md) (Community Harbor addressed in §6.6)
- Runtime architecture: [`RUNTIME-STRATEGY.md`](./RUNTIME-STRATEGY.md)
- Old Harbor: `842775dh.c1.gra9.container-registry.ovh.net` (premium + legacy mirror)
- New Harbor: `39t88114.c1.gra9.container-registry.ovh.net` (BSL community, public)
