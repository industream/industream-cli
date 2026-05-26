# Registry architecture — proposal

> **Status**: planning, pending team sign-off
> **Date**: 2026-05-26
> **Companion docs**: [`HARBOR-MIGRATION.md`](./HARBOR-MIGRATION.md), [`RUNTIME-STRATEGY.md`](./RUNTIME-STRATEGY.md)

## TL;DR

Three registries with clearly separated roles. CI builds land in an internal staging Harbor and a dispatcher promotes each image to its public destination based on its license classification:

| Registry | Role | Audience | Auth | Path layout |
|---|---|---|---|---|
| `842775dh.c1.gra9.container-registry.ovh.net` | **Internal staging** | CI, build cache, dispatcher source | Robot accounts only | `<project>/<image>:<tag>` (today's layout) |
| `ghcr.io/industream/` | **Community published** | BSL 1.1 images, end users | Anonymous pull | `<project>/<image>:<tag>` (hierarchical, separator `/`) |
| `39t88114.c1.gra9.container-registry.ovh.net` | **Enterprise published** | Premium addons, paid plans only | Auth via license-bound robot | `<project>/<image>:<tag>` |

The customer pulls in **two layers**:
1. Base community set from **GHCR** (always)
2. Enterprise addons from **`39t88114`** (only if license entitles them)

Both layers share the same path structure so compose/stack files stay simple.

---

## 1. Why this change

Today:
- All images live in `842775dh.../<project>/<image>` and a manually-mirrored sub-project `842775dh.../flowmaker.community/<project>/<image>`.
- Community users pull from a private project with an embedded robot (`robot$community-public`) — leaks audit logs, sub-optimal for OSS positioning.
- Each version bump requires a manual `crane copy` from premium to community.

Wanted:
- **GHCR for community**: industry-standard OSS hosting, true anonymous public pulls, no embedded creds, GitHub Packages billing.
- **Dedicated enterprise registry**: clear separation, robot accounts bound to license, no leakage.
- **`842775dh` reduced to internal staging**: only CI artifacts, build cache, intermediate tags. Not customer-facing.

---

## 2. Image flow

```
                          GH Actions per worker repo
                                    │
                                    ▼
                    ┌─────────────────────────────────────┐
                    │  Build image                        │
                    │  Push to 842775dh/<project>/<img>   │  internal staging
                    └────────────────┬────────────────────┘
                                     │
                                     │ repository_dispatch / workflow_dispatch
                                     ▼
                        ┌────────────────────────┐
                        │  Dispatcher workflow   │
                        │  reads modules.json    │
                        │  classifies bsl/prop   │
                        └─────────┬──────────────┘
                                  │
                ┌─────────────────┴─────────────────┐
                ▼                                    ▼
       ┌────────────────────┐         ┌──────────────────────────┐
       │ ghcr.io/industream/│         │ 39t88114/                │
       │ <project>/<image>  │         │ <project>/<image>        │
       │ (license == bsl)   │         │ (license == proprietary) │
       └────────────────────┘         └──────────────────────────┘
```

---

## 3. Customer pull layout

### Community user (no license)

Pulls every service from GHCR only. Enterprise overlay stacks (`workers-premium.yml`, `ironstream.yml`) are not deployed.

```
ghcr.io/industream/flowmaker.core/flowmaker-launcher:2.1.0
ghcr.io/industream/flowmaker.boxes/flow-box-timer:2.0.3
ghcr.io/industream/datacatalog/api:1.9.0
...
```

### Enterprise user (license entitles premium + ironstream)

Pulls the **base set** from GHCR plus **addon stacks** from `39t88114`:

```
ghcr.io/industream/flowmaker.core/flowmaker-launcher:2.1.0     # base, same as community
ghcr.io/industream/flowmaker.boxes/flow-box-timer:2.0.3         # base worker
39t88114.c1.gra9.../flowmaker.boxes/flow-box-opc-ua-client:2.0.3  # premium worker
39t88114.c1.gra9.../ironstream/<service>:<tag>                   # business addon
```

`DOCKER_REGISTRY` resolves per-service:
- For community/base services → `ghcr.io/industream`
- For premium/addon services → `39t88114.c1.gra9.container-registry.ovh.net`

In practice, the stack files reference each image with its **full path** so the registry is implicit in the path; no env var swap is needed.

---

## 4. Path / naming convention

### GHCR

Uses the same hierarchical layout as Harbor for consistency:

```
ghcr.io/industream/flowmaker.core/flowmaker-launcher:2.1.0
ghcr.io/industream/flowmaker.boxes/flow-box-timer:2.0.3
ghcr.io/industream/datacatalog/api:1.9.0
ghcr.io/industream/uifusion/ui:1.0.10
```

Note: GHCR exposes each path component as a separate package (visible in `https://github.com/orgs/industream/packages`). The dispatcher creates them on first push. Each package must be marked **public** once via the GH UI or `gh api`.

### Enterprise Harbor

```
39t88114.c1.gra9.../flowmaker.core/flowmaker-launcher:2.1.0
39t88114.c1.gra9.../flowmaker.boxes/flow-box-opc-ua-client:2.0.3
39t88114.c1.gra9.../ironstream/<service>:<tag>
```

### Internal staging (`842775dh`)

Unchanged. Receives CI builds. Tags include intermediate / pre-release. Garbage collection rules can prune old tags (currently no rule).

---

## 5. Code changes (CLI)

### `src/lib/registry-login.ts`

```ts
export const COMMUNITY_REGISTRY = "ghcr.io/industream";
export const ENTERPRISE_REGISTRY = "39t88114.c1.gra9.container-registry.ovh.net";
// 842775dh is no longer a constant — not consumed by the customer CLI.

export function getRegistryForPlan(plan: Plan): string {
  return plan === "community" ? COMMUNITY_REGISTRY : ENTERPRISE_REGISTRY;
}

export async function ensureRegistryLogin(registry: string, plan: Plan): Promise<void> {
  if (registry.startsWith("ghcr.io")) {
    // GHCR public packages do not require auth for pull.
    return;
  }
  if (plan === "community") {
    // Community plan should never reach a paid registry.
    throw new Error("Community plan cannot pull from enterprise registry");
  }
  // Paid plan → fetch Keygen license metadata for Harbor credentials
  const creds = await getEnterpriseCredentials();
  if (!creds) {
    throw new Error(
      "Premium license missing Harbor credentials. Contact sales@industream.com.",
    );
  }
  await dockerLogin(registry, creds.username, creds.secret);
}
```

### `modules.json`

Each module already has `license: "bsl" | "proprietary"` plus an `imagePattern`. We **add** an explicit `registry` field for clarity (auto-derived from license, but explicit helps the dispatcher):

```jsonc
{
  "id": "worker-timer",
  "license": "bsl",
  "registry": "community",       // → ghcr.io/industream/flowmaker.boxes/flow-box-timer
  "imagePattern": "flowmaker.boxes/flow-box-timer"
}
{
  "id": "worker-opc-ua-client",
  "license": "proprietary",
  "registry": "enterprise",      // → 39t88114.../flowmaker.boxes/flow-box-opc-ua-client
  "imagePattern": "flowmaker.boxes/flow-box-opc-ua-client"
}
```

### Stack and compose files

`docker-stack.yml`, `docker-stack.flowmaker.yml`, `docker-stack.workers.yml`, `docker-stack.datacatalog.yml`, `docker-stack.cdn.yml`, `docker-stack.monitoring.yml` and `docker-compose.yml`, `docker-compose.workers.yml`, `docker-compose.datacatalog.yml` → all use the community registry. Image references become:

```yaml
image: ${COMMUNITY_REGISTRY}/${IMAGE_PATH}:${VERSION}
# e.g. ghcr.io/industream/flowmaker.boxes/flow-box-timer:2.0.3
```

`docker-stack.workers-premium.yml`, `docker-stack.ironstream.yml` use the enterprise registry:

```yaml
image: ${ENTERPRISE_REGISTRY}/${IMAGE_PATH}:${VERSION}
# e.g. 39t88114.../flowmaker.boxes/flow-box-opc-ua-client:2.0.3
```

`.env.example` introduces two vars instead of one `DOCKER_REGISTRY`:

```bash
COMMUNITY_REGISTRY=ghcr.io/industream
ENTERPRISE_REGISTRY=39t88114.c1.gra9.container-registry.ovh.net
```

`DOCKER_REGISTRY` stays as a back-compat alias for installs that haven't migrated yet (`DOCKER_REGISTRY=$COMMUNITY_REGISTRY`).

---

## 6. Dispatcher workflow

New file: `industream-stack/.github/workflows/dispatch-image.yml` (or, better, a new repo `industream/registry-dispatcher` so worker repos can `repository_dispatch` it).

```yaml
name: dispatch-image
on:
  workflow_dispatch:
    inputs:
      source_image:    { required: true, type: string }   # 842775dh/flowmaker.boxes/flow-box-timer:2.0.3
      module_id:       { required: true, type: string }   # worker-timer
  repository_dispatch:
    types: [build-completed]

jobs:
  dispatch:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          repository: industream/industream-cli
          path: cli

      - id: classify
        run: |
          LIC=$(jq -r --arg id "${{ inputs.module_id }}" \
            '.modules[] | select(.id==$id) | .license' cli/modules.json)
          if [ "$LIC" = "bsl" ]; then
            echo "destination=ghcr.io/industream" >> $GITHUB_OUTPUT
            echo "auth=github" >> $GITHUB_OUTPUT
          else
            echo "destination=39t88114.c1.gra9.container-registry.ovh.net" >> $GITHUB_OUTPUT
            echo "auth=harbor" >> $GITHUB_OUTPUT
          fi

      - name: Login to staging
        uses: docker/login-action@v3
        with:
          registry: 842775dh.c1.gra9.container-registry.ovh.net
          username: ${{ secrets.STAGING_HARBOR_USER }}
          password: ${{ secrets.STAGING_HARBOR_PASS }}

      - name: Login to destination
        uses: docker/login-action@v3
        with:
          registry: ${{ steps.classify.outputs.destination }}
          username: ${{ steps.classify.outputs.auth == 'github' && 'industream' || secrets.ENTERPRISE_HARBOR_USER }}
          password: ${{ steps.classify.outputs.auth == 'github' && secrets.GITHUB_TOKEN || secrets.ENTERPRISE_HARBOR_PASS }}

      - name: Setup crane
        run: |
          curl -fsSL https://github.com/google/go-containerregistry/releases/download/v0.20.2/go-containerregistry_Linux_x86_64.tar.gz \
            | tar -xz -C /usr/local/bin crane

      - name: Promote
        run: |
          SRC="${{ inputs.source_image }}"
          TAG="${SRC##*:}"
          REPO_PATH="${SRC#842775dh.c1.gra9.container-registry.ovh.net/}"
          REPO_PATH="${REPO_PATH%:*}"
          DEST="${{ steps.classify.outputs.destination }}/${REPO_PATH}:${TAG}"
          echo "Copying $SRC → $DEST"
          crane copy --all-tags=false "$SRC" "$DEST"
```

---

## 7. Migration plan (in phases)

### Phase 0 — Prep (1d)
- Provision GHCR : create the `industream` org packages, set permissions
- Provision robots on `39t88114` (dispatcher push, customer pull)
- Document GitHub Secrets (`STAGING_HARBOR_*`, `ENTERPRISE_HARBOR_*`)
- Branch off `feature/registry-rearchitecture` on all affected repos

### Phase 1 — Code (2-3d)
- Update `registry-login.ts`, `modules.json`, stack/compose files
- Update `install.tsx` to write `COMMUNITY_REGISTRY` + `ENTERPRISE_REGISTRY` to `.env`
- Add tests for `getRegistryForPlan` with the new constants

### Phase 2 — CI (2-3d)
- Create dispatcher repo (or workflow inside industream-stack)
- Add `repository_dispatch` calls in each worker repo's existing build workflow
- Run a manual dispatch for **one image** end-to-end to validate

### Phase 3 — Bulk migration (1d)
- Write `scripts/ops/promote-bulk.sh` that walks all tags in `842775dh.../flowmaker.community/*` and `842775dh.../<project>/*` and copies them to GHCR / `39t88114` per license
- Run in dry-run first, then live
- Mark all GHCR packages public via `gh api`

### Phase 4 — Cutover (1 release cycle)
- Roll new CLI to a few pilot installs (Bernegger included)
- Monitor pull errors / 401s
- Once stable: deprecate `842775dh.../flowmaker.community/*` writes (the legacy mirror sub-project)

### Phase 5 — Cleanup (post 2 stable releases)
- Remove the legacy embedded `robot$community-public` from `registry-login.ts`
- Delete `flowmaker.community/*` sub-project on `842775dh`
- Archive the `sync-community-mirror.sh` script and its workflow (superseded by dispatcher)

**Total: ~7-10 working days.**

---

## 8. Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| GHCR anonymous pull rate limits (~10k/h per IP) on a single tenant | Medium | Document in HARBOR-MIGRATION.md; consider Verdaccio cache layer if hit |
| GHCR layer size limits (5GB per layer) | Low | Audit existing image layers; should already be < 1GB |
| Public visibility of GHCR packages must be set per package | High (annoyance) | Automate via `gh api` in the dispatcher or a one-shot script |
| Keygen entitlements drift from Harbor robot state | Medium | Build a reconciliation cron: Keygen-API → Harbor-API |
| Existing customer installs break during transition | High | Keep three registries live (842775dh+GHCR+39t88114) during Phase 4 |
| `42775dh` continues to grow (no GC) | Low | Add Harbor retention policies (keep last 20 tags per repo) |
| `ironstream/*` business module classification | TBD | Decide explicitly in `modules.json` before Phase 1 |

---

## 9. Decisions still needed

1. **`ironstream/*` classification** : `proprietary` (enterprise-only) — confirmed?
2. **Repo for the dispatcher** : new `industream/registry-dispatcher` repo, or workflow inside `industream-stack/.github/workflows/`?
3. **GHCR billing** : enable GitHub Packages billing on the `industream` org — done? Free tier covers most usage.
4. **Date cible cutover** : after Bernegger migration is stable (mid-Q3?) or sooner?
5. **Harbor retention** on `842775dh` : keep last N tags per repo? Auto-delete tags older than X days?

---

## 10. Out-of-scope (for this proposal)

- Image signing (cosign / Notary v2) — separate sec hardening track
- Multi-arch build (linux/arm64) — already addressed in current CI
- SBOM generation — separate compliance track
- Replication to a third region (DR) — separate ops track
