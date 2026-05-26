# Migration Guide — Legacy CLIs → Unified `industream`

> **Audience**: anyone who still runs the historical Swarm `industream.sh` or
> the Compose `./fm` script from `industream-flowmaker/deployment/`.
> **Goal**: switch to the unified `industream` CLI without rewriting muscle
> memory or breaking existing instances.
> **Companion docs**: [`RUNTIME-STRATEGY.md`](./RUNTIME-STRATEGY.md),
> [`INTEGRATION-PLAN.md`](./INTEGRATION-PLAN.md),
> [`HARBOR-MIGRATION.md`](./HARBOR-MIGRATION.md).

## TL;DR

The two historical CLIs are now a **single binary, `industream`**, that picks
its runtime (Swarm or Compose) from one entry in `.env`: `RUNTIME=swarm` or
`RUNTIME=compose`. Bash remains the source of truth; the TypeScript layer is
optional UX. Every legacy invocation keeps working through compat wrappers.

| Old world | New world |
|---|---|
| `./industream.sh deploy prod` (Swarm) | `industream deploy --env prod` |
| `./industream.sh down prod` | `industream down --env prod` |
| `./fm create dev` (Compose) | `industream dev create dev` |
| `./fm up dev --workers` | `industream dev up dev --workers` |
| `./fm caddy:rebuild` | `industream caddy rebuild` (or `industream caddy:rebuild` via bash) |
| `./fm launch-worker dev timer` | `industream dev launch-worker dev timer` |

You can keep typing `./fm …` — the new `scripts/compose/fm` is a compat
wrapper that forwards to the thematic scripts.

## What changed and why

The platform used to ship two parallel orchestrators: a Swarm-only
`industream.sh` for production and a 1721-line Compose `fm` script for
developer workstations. They duplicated registry handling, secret layout, and
even reverse-proxy logic, and they drifted apart over time (security patches
landed in one but not the other, version pins diverged silently). The new
`industream` binary is a **bash dispatcher** with one Compose runtime and
one Swarm runtime behind a stable surface. The TypeScript layer
(`industream-cli/src/index.ts`) is invoked only for UX commands (`menu`,
`status`, `install`, `license`, …); the day-to-day `deploy` / `dev up` /
`logs` paths execute pure bash with no Node startup penalty (~5 ms vs ~150
ms). See [`RUNTIME-STRATEGY.md`](./RUNTIME-STRATEGY.md) §3.3.

Operationally, you get:

- One CLI to learn, one binary to upgrade.
- A single source of truth for image tags (the community Harbor at
  `39t88114.c1.gra9.container-registry.ovh.net`, anonymous pull).
- A predictable split between the bash core (Docker-touching) and the
  TypeScript shell (Commander + Ink).

## Migration matrix — Swarm side

Legacy `industream.sh` and the standalone `scripts/*.sh` helpers map cleanly
to the new dispatcher. The Swarm code path is preserved verbatim: the new
`industream deploy` simply `exec`s the existing `scripts/deploy-swarm.sh`.

| Old command | New command | Notes |
|---|---|---|
| `./industream.sh deploy prod` | `industream deploy --env prod` | Same `scripts/deploy-swarm.sh` underneath |
| `./industream.sh deploy dev --with-demo` | `industream deploy --env dev --with-demo` | `--with-demo` still dev-only |
| `./industream.sh deploy staging` | `industream deploy --env staging` | 3 envs (`prod\|dev\|staging`) unchanged |
| `./industream.sh down prod` | `industream down --env prod` | Falls back to `scripts/down-swarm.sh` if present, else the TS CLI |
| `./industream.sh logs <svc>` | `industream logs <svc>` | Routes to `scripts/docker-logs.sh` then TS CLI fallback |
| `./industream.sh ps` | `industream ps` | Routes to `scripts/docker-ps.sh` then TS CLI fallback |
| `./industream.sh status` | `industream status` | Always TS CLI (Ink dashboard) |
| `./industream.sh secrets …` | `industream secrets [--show\|--regenerate]` | TS CLI; calls `scripts/setup/create-secrets.sh` |
| `./industream.sh install …` | `industream install --env prod --domain X --tls Y --runtime swarm` | New `--runtime` flag, locked into `.env` |
| `./industream.sh license` | `industream license [--set <token>]` | TS CLI |
| `./industream.sh update` | `industream update` | TS CLI |
| `./industream.sh config` | `industream config` | TS CLI; opens `.env` editor |
| `./industream.sh uninstall` | `industream uninstall --env <env>` | TS CLI |
| `./industream.sh worker add <path>` | `industream worker add <path>` | TS CLI |
| `./industream.sh worker list` | `industream worker list` | TS CLI |
| `./industream.sh worker remove <name>` | `industream worker remove <name>` | TS CLI |
| `./scripts/deploy-swarm.sh --env prod` | `industream deploy --env prod` *or* same script directly | Direct bash invocation still supported |
| `./scripts/setup/create-secrets.sh --env prod` | Same, or `industream secrets --regenerate` | Bash script untouched |
| `./scripts/fetch-latest-versions.sh` | Same | Runtime-agnostic, unchanged |

## Migration matrix — Compose side

The monolithic `industream-flowmaker/deployment/fm` script has been split
into thematic files under `industream-stack/scripts/compose/`. Behaviour is
identical: every `cmd_*` function was copied verbatim. Two dead-code
duplicates (`cmd_sync` lines 872–1047, `cmd_init` lines 1048–1167) were
dropped — bash had been ignoring them anyway.

| Old command | New CLI command | Underlying bash script |
|---|---|---|
| `./fm create <name>` | `industream dev create <name>` | `scripts/compose/fm-instance.sh create` |
| `./fm up <name>` | `industream dev up <name>` | `scripts/compose/fm-instance.sh up` |
| `./fm up <name> --workers` | `industream dev up <name> --workers` | same |
| `./fm up <name> --workers --uimaker` | `industream dev up <name> --workers --uimaker` | same |
| `./fm up <name> --workers --community` | `industream dev up <name> --workers --community` | same; pulls from public Harbor |
| `./fm up <name> --local` | `industream dev up <name> --local` | `--pull never`, unchanged |
| `./fm down <name>` | `industream dev down <name>` | `scripts/compose/fm-instance.sh down` |
| `./fm ps <name>` | `industream dev ps <name>` | same |
| `./fm logs <name> [svc]` | `industream dev logs <name> [svc]` | same |
| `./fm list` | `industream dev list` | same |
| `./fm delete <name>` | `industream dev delete <name>` | same |
| `./fm caddy:rebuild` | `industream caddy rebuild` *or* `industream caddy:rebuild` | `scripts/compose/fm-caddy.sh rebuild` |
| `./fm caddy:stop` | `industream caddy stop` *or* `industream caddy:stop` | `scripts/compose/fm-caddy.sh stop` |
| `./fm caddy:delete` | `industream caddy delete` *or* `industream caddy:delete` | `scripts/compose/fm-caddy.sh delete` |
| `./fm caddy:logs` | `industream caddy logs` *or* `industream caddy:logs` | `scripts/compose/fm-caddy.sh logs` |
| `./fm caddy:ca [dest]` | `industream caddy ca [dest]` *or* `industream caddy:ca [dest]` | `scripts/compose/fm-caddy.sh ca` |
| `./fm cdn-reset <name> [worker\|all]` | `industream dev cdn-reset <name> [worker\|all]` | `scripts/compose/fm-worker.sh cdn-reset` |
| `./fm init <name>` | `industream dev init <name>` | `scripts/compose/fm-sync.sh init` |
| `./fm sync <name>` | `industream dev sync <name>` | `scripts/compose/fm-sync.sh sync` |
| `./fm launch-worker <inst> <name>` | `industream dev launch-worker <inst> <name>` | `scripts/compose/fm-worker.sh launch-worker` |
| `./fm launch-worker <inst> --id X --port P <name>` | Same flags via `industream dev launch-worker --id X --port P` | options forwarded verbatim |
| `./fm hosts` | `industream dev hosts` | `scripts/compose/fm-hosts.sh` |

### Path differences worth memorising

- The old `./fm` lived in `industream-flowmaker/deployment/`. The new wrapper
  lives in `industream-stack/scripts/compose/fm` and is also reachable as
  `industream dev …`.
- Instance directories (`instances/<name>/.env`, `docker-compose.override.yml`)
  stay under `industream-flowmaker/deployment/instances/`. The new scripts
  resolve that path automatically via the `COMPOSE_ROOT` variable
  (overridable with `COMPOSE_ROOT=/custom/path`).

## Installing the new CLI

Pick one:

```bash
# One-liner (recommended — fetches Node deps, builds SEA binary, opens menu)
bash <(curl -fsSL https://raw.githubusercontent.com/industream/industream-cli/main/install.sh)

# Manual: clone industream-stack + industream-cli side by side, then
cd industream-cli && npm install && npm run build
ln -s "$(pwd)/../industream-stack/scripts/industream" /usr/local/bin/industream
```

The bash dispatcher (`industream-stack/scripts/industream`) finds its sibling
TypeScript build at `industream-cli/dist/index.mjs`. As long as both repos
live in the same parent directory, no further configuration is required.

## Backward compatibility

The new layout is deliberately additive — nothing is removed or rewritten in
place.

- **`scripts/compose/fm`** is a compat wrapper. `./fm up dev --workers`,
  `./fm caddy:rebuild`, `./fm launch-worker …` all still work, with the
  same arguments and the same output.
- **The original `industream-flowmaker/deployment/fm`** is left untouched on
  disk. Anyone who still invokes the legacy file in-place keeps the old
  behaviour. (Phase 5 of the integration plan removes it after one release
  cycle — see [`INTEGRATION-PLAN.md`](./INTEGRATION-PLAN.md) §7.)
- **Thematic scripts** (`fm-instance.sh`, `fm-caddy.sh`, `fm-sync.sh`,
  `fm-worker.sh`, `fm-hosts.sh`) are all directly executable. Bash devs can
  bypass the dispatcher and call them straight: zero Node, zero Commander.
- **`scripts/deploy-swarm.sh`**, **`scripts/setup/create-secrets.sh`** and
  every other historical helper run unchanged — `industream deploy` is just
  a thin `exec` wrapper.
- **No data migration**: `.env`, `.env.defaults`, `instances/`, Swarm
  secrets, raft state, Caddy volumes, and licence files are all unchanged.

## Breaking changes

Two small surfaces shifted. Both have workarounds.

### Commander does not accept `:` in command names

Inside the TypeScript CLI, the `caddy:*` subcommands had to be re-namespaced
as `caddy rebuild`, `caddy stop`, etc. The bash dispatcher
(`scripts/industream`) still recognises the colon form and routes it directly
to `scripts/compose/fm-caddy.sh`. Practical impact:

| Form | Path | Works? |
|---|---|---|
| `industream caddy:rebuild` | Bash dispatcher → `fm-caddy.sh rebuild` | yes |
| `industream caddy rebuild` | TS CLI (Commander) → `runCaddyRebuild()` | yes |
| `./fm caddy:rebuild` | Compat wrapper | yes |

So you do not have to retrain your fingers, but scripts that go through the
TS surface (e.g. `node dist/index.mjs caddy rebuild`) must use the spaced
form.

### `RUNTIME=` in `.env` determines `deploy`

`industream install` writes `RUNTIME=swarm` or `RUNTIME=compose` into the
platform `.env`. The TS deploy router reads that key (defaults to `swarm`
for retro-compat). You cannot mix runtimes on the same deployment — pick one
at install time. See [`INTEGRATION-PLAN.md`](./INTEGRATION-PLAN.md) §5.

### Stack-name expectations

Swarm stacks are still named `industream-<env>` (`industream-prod`,
`industream-dev`, `industream-staging`). Compose project names are still
`fm-<instance>`. Nothing changed here — but if you scripted around those
strings, double-check before assuming they will move.

## FAQ

**Q: Do my old `./fm` commands still work?**
Yes. `scripts/compose/fm` is a verbatim compat wrapper; the historical
`industream-flowmaker/deployment/fm` is untouched. You can migrate
incrementally.

**Q: Will my existing instances (`instances/<name>/.env`) work with
`industream dev`?**
Yes. The new scripts read the same `instances/<name>/.env` and
`docker-compose.override.yml` files. No regeneration needed.

**Q: How do I know which runtime is active on this machine?**
`grep RUNTIME= .env`. Absent → defaults to `swarm`. Install-time prompt sets
it; you can edit it manually but you must redeploy after.

**Q: Can I still call `./scripts/compose/fm-instance.sh up dev` directly?**
Yes — that is the intended bash-first workflow. The TS layer is optional UX.

**Q: I want the old monolithic `fm` script for one more release — where is
it?**
Untouched at `industream-flowmaker/deployment/fm`. It will be removed after
phase 5 of the integration plan; until then, both paths coexist.

**Q: My CI pipeline calls `./industream.sh deploy prod` — what do I change?**
Either replace with `industream deploy --env prod` (preferred) or keep the
legacy script invocation if it still exists in your fork. The new dispatcher
intentionally accepts the same Swarm flags (`--env`, `--with-demo`).

**Q: Where do I report a regression I see only after switching?**
File against `industream-cli` with the legacy command, the new command, and
the diff between them. The bash scripts under
`industream-stack/scripts/compose/` were copied function-by-function from
the legacy `fm`, so most regressions will be path-resolution or environment
issues rather than behavioural changes.

## Rollback

The migration is reversible at every layer.

1. **Stop using `industream`** and resume calling the historical scripts:
   - Swarm: `./scripts/deploy-swarm.sh --env prod`, `docker stack rm
     industream-prod`, etc.
   - Compose: `cd industream-flowmaker/deployment && ./fm up dev --workers`.
2. **Pin the legacy runtime** by deleting `RUNTIME=` from your platform
   `.env` (the TS router defaults to `swarm`, matching the pre-merger
   behaviour).
3. **Remove the symlink** if you installed via the one-liner:
   `sudo rm /usr/local/bin/industream`.
4. **Compose users**: if the `scripts/compose/fm` wrapper misbehaves on a
   specific instance, fall back to the monolithic
   `industream-flowmaker/deployment/fm` — it is still on disk and still
   functional. No instance metadata is lost in either direction.
5. **Premium worker users**: keep your `DOCKER_REGISTRY=842775dh…` line in
   `.env` if you have not yet migrated to the dual-registry resolver. The
   new CLI honours that variable verbatim.

No data conversion has to be undone — the new CLI never rewrites secrets,
instance files, or stack labels. The only persistent side effect of running
the new install is the `RUNTIME=` line added to `.env`; remove it to revert
to default behaviour.

## Related docs

- [`RUNTIME-STRATEGY.md`](./RUNTIME-STRATEGY.md) — architecture rationale,
  bash-first principle, dispatcher design.
- [`INTEGRATION-PLAN.md`](./INTEGRATION-PLAN.md) — phased plan, command
  mapping, blocking decisions, `fm` script inventory.
- [`HARBOR-MIGRATION.md`](./HARBOR-MIGRATION.md) — community vs premium
  registry split, anonymous pull, per-license routing.
- `industream-stack/scripts/compose/README.md` — thematic split details and
  direct bash invocation.
- `industream-stack/custom/README.md` — bringing your own Grafana plugins
  and custom stack files.
- `industream-stack/docs/runbook/patching.md` — production patching
  workflow on the Swarm runtime.
