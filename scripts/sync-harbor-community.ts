#!/usr/bin/env tsx
/**
 * scripts/sync-harbor-community.ts
 *
 * Copies all BSL images from the private projects into the public
 * `flowmaker.community` project, keeping their names but flattened
 * (dropping the source namespace).
 *
 * Harbor does not allow local-to-local replication policies, so we use
 * the registry HTTP API to copy artifacts by digest. This is atomic and
 * does not require pulling the image locally.
 *
 * Usage:
 *   HARBOR_USER=cdm HARBOR_PASSWORD=xxx npx tsx scripts/sync-harbor-community.ts           # dry run
 *   HARBOR_USER=cdm HARBOR_PASSWORD=xxx npx tsx scripts/sync-harbor-community.ts --apply   # copy
 *
 * Safe: this script never deletes.
 */

const HARBOR_HOST = "842775dh.c1.gra9.container-registry.ovh.net";
const API = `https://${HARBOR_HOST}/api/v2.0`;
const USER = process.env.HARBOR_USER;
const PASSWORD = process.env.HARBOR_PASSWORD;

if (!USER || !PASSWORD) {
  console.error("Missing HARBOR_USER / HARBOR_PASSWORD");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const COMMUNITY_PROJECT = "flowmaker.community";
// Keep only the N most recent artifacts per image (by push_time).
// Override with --keep=N
const KEEP_ARG = process.argv.find((a) => a.startsWith("--keep="));
const KEEP_RECENT = KEEP_ARG ? parseInt(KEEP_ARG.split("=")[1], 10) : 1;

// Images to sync: source path → destination sub-path inside flowmaker.community
// This organizes the community project into logical groups (core/, workers/, etc.)
// Harbor allows slashes in repo names, giving the illusion of sub-projects.
const BSL_IMAGES: Array<{ source: string; destSubPath: string }> = [
  // ===== core =====
  { source: "flowmaker.core/cdn-cache", destSubPath: "core/cdn-cache" },
  { source: "flowmaker.core/cdn-server", destSubPath: "core/cdn-server" },
  { source: "flowmaker.core/cdn-helper", destSubPath: "core/cdn-helper" },
  { source: "flowmaker.core/etcd3-browser", destSubPath: "core/etcd3-browser" },
  { source: "flowmaker.core/flowmaker-confighub", destSubPath: "core/flowmaker-confighub" },
  { source: "flowmaker.core/flowmaker-confighub-v2", destSubPath: "core/flowmaker-confighub-v2" },
  { source: "flowmaker.core/flowmaker-front", destSubPath: "core/flowmaker-front" },
  { source: "flowmaker.core/flowmaker-launcher", destSubPath: "core/flowmaker-launcher" },
  { source: "flowmaker.core/flowmaker-logger", destSubPath: "core/flowmaker-logger" },
  { source: "flowmaker.core/flowmaker-runtime", destSubPath: "core/flowmaker-runtime" },

  // ===== workers (BSL only) =====
  { source: "flowmaker.boxes/flow-box-mqtt-client", destSubPath: "workers/flow-box-mqtt-client" },
  { source: "flowmaker.boxes/flow-box-modbus-tcp", destSubPath: "workers/flow-box-modbus-tcp" },
  { source: "flowmaker.boxes/flow-box-http-client", destSubPath: "workers/flow-box-http-client" },
  { source: "flowmaker.boxes/flow-box-http", destSubPath: "workers/flow-box-http" },
  { source: "flowmaker.boxes/flow-box-postgres-client", destSubPath: "workers/flow-box-postgres-client" },
  { source: "flowmaker.boxes/flow-box-influx-client", destSubPath: "workers/flow-box-influx-client" },
  { source: "flowmaker.boxes/flow-box-timer", destSubPath: "workers/flow-box-timer" },
  { source: "flowmaker.boxes/flow-box-data-logger", destSubPath: "workers/flow-box-data-logger" },
  { source: "flowmaker.boxes/flow-box-test-data-generator", destSubPath: "workers/flow-box-test-data-generator" },
  { source: "flowmaker.boxes/flow-box-conditional-dataset-validator", destSubPath: "workers/flow-box-conditional-dataset-validator" },
  { source: "flowmaker.boxes/flow-box-enqueue", destSubPath: "workers/flow-box-enqueue" },
  { source: "flowmaker.boxes/flow-box-equation-solver", destSubPath: "workers/flow-box-equation-solver" },
  { source: "flowmaker.boxes/flow-box-js-expression", destSubPath: "workers/flow-box-js-expression" },
  { source: "flowmaker.boxes/flow-box-notification", destSubPath: "workers/flow-box-notification" },
  { source: "flowmaker.boxes/flow-box-notifications", destSubPath: "workers/flow-box-notifications" },
  { source: "flowmaker.boxes/flow-box-minio-sink", destSubPath: "workers/flow-box-minio-sink" },
  { source: "flowmaker.boxes/flow-box-datacatalog-mapper", destSubPath: "workers/flow-box-datacatalog-mapper" },
  { source: "flowmaker.boxes/flow-box-timeseries-workers", destSubPath: "workers/flow-box-timeseries-workers" },

  // ===== infra =====
  { source: "flowmaker.infra/flowmaker-worker-manager", destSubPath: "infra/flowmaker-worker-manager" },

  // ===== data =====
  { source: "datacatalog/api", destSubPath: "data/datacatalog-api" },
  { source: "datacatalog/ui", destSubPath: "data/datacatalog-ui" },
  { source: "datacatalog/uifusion", destSubPath: "data/uifusion" },
  { source: "datacatalog/acquisition-schema-api", destSubPath: "data/acquisition-schema-api" },

  // ===== monitoring =====
  { source: "grafana/grafana-industream", destSubPath: "monitoring/grafana-industream" },
];

const authHeader = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`;

interface Artifact {
  digest: string;
  push_time?: string;
  tags?: Array<{ name: string }>;
}

async function listArtifacts(
  project: string,
  repo: string,
): Promise<Artifact[]> {
  const all: Artifact[] = [];
  let page = 1;
  while (true) {
    const encRepo = encodeURIComponent(repo.replace(`${project}/`, ""));
    const url = `${API}/projects/${project}/repositories/${encRepo}/artifacts?with_tag=true&page=${page}&page_size=50`;
    const response = await fetch(url, {
      headers: { Authorization: authHeader, Accept: "application/json" },
    });
    if (response.status === 404) return [];
    if (!response.ok) {
      throw new Error(`list artifacts ${repo}: ${response.status}`);
    }
    const body = (await response.json()) as Artifact[];
    all.push(...body);
    if (body.length < 50) break;
    page++;
  }
  return all;
}

async function copyArtifact(
  sourceProject: string,
  sourceRepo: string,
  digest: string,
  destRepoName: string,
): Promise<{ ok: boolean; error?: string }> {
  // POST /projects/{dest}/repositories/{repo}/artifacts?from={src}@{digest}
  const encDest = encodeURIComponent(destRepoName);
  const from = `${sourceProject}/${sourceRepo}@${digest}`;
  const url = `${API}/projects/${COMMUNITY_PROJECT}/repositories/${encDest}/artifacts?from=${encodeURIComponent(from)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: authHeader, Accept: "application/json" },
  });
  if (response.status === 201 || response.status === 202) {
    return { ok: true };
  }
  const text = await response.text();
  return { ok: false, error: `${response.status}: ${text.slice(0, 200)}` };
}

async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`Images to sync: ${BSL_IMAGES.length}`);
  console.log("");

  let totalCopied = 0;
  let totalSkipped = 0;
  let totalFailed = 0;
  let totalMissing = 0;

  for (const { source, destSubPath } of BSL_IMAGES) {
    const [sourceProject, ...repoParts] = source.split("/");
    const sourceRepo = repoParts.join("/");
    const destName = destSubPath;

    process.stdout.write(`  ${source} → ${COMMUNITY_PROJECT}/${destName} ... `);

    const artifacts = await listArtifacts(sourceProject, source);
    if (artifacts.length === 0) {
      console.log("(no artifacts, skipping)");
      totalMissing++;
      continue;
    }

    // Keep only tagged artifacts, sort by push_time descending, keep N most recent
    const withTags = artifacts
      .filter((a) => a.tags && a.tags.length > 0)
      .sort((a, b) => {
        const ta = a.push_time ? new Date(a.push_time).getTime() : 0;
        const tb = b.push_time ? new Date(b.push_time).getTime() : 0;
        return tb - ta;
      })
      .slice(0, KEEP_RECENT);
    if (withTags.length === 0) {
      console.log("(no tagged artifacts, skipping)");
      totalMissing++;
      continue;
    }

    // Copy each unique tagged artifact
    let copied = 0;
    let failed = 0;
    for (const artifact of withTags) {
      if (!APPLY) {
        copied++;
        continue;
      }
      const result = await copyArtifact(
        sourceProject,
        sourceRepo,
        artifact.digest,
        destName,
      );
      if (result.ok) {
        copied++;
      } else {
        failed++;
        if (result.error?.includes("already exists")) {
          copied--;
          totalSkipped++;
        } else {
          console.log(`\n    ✗ digest ${artifact.digest.slice(0, 20)}: ${result.error}`);
        }
      }
    }

    if (failed === 0) {
      console.log(`${copied} tags ${APPLY ? "copied" : "to copy"}`);
      totalCopied += copied;
    } else {
      console.log(`${copied} ok, ${failed} failed`);
      totalCopied += copied;
      totalFailed += failed;
    }
  }

  console.log("");
  console.log(
    `Summary: ${totalCopied} copied, ${totalSkipped} already present, ${totalFailed} failed, ${totalMissing} missing in source`,
  );
  if (!APPLY) {
    console.log("Re-run with --apply to actually copy.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
