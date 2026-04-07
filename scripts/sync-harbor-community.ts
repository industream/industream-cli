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

const BSL_IMAGES = [
  // flowmaker.core
  "flowmaker.core/cdn-cache",
  "flowmaker.core/cdn-server",
  "flowmaker.core/cdn-helper",
  "flowmaker.core/etcd3-browser",
  "flowmaker.core/flowmaker-confighub",
  "flowmaker.core/flowmaker-confighub-v2",
  "flowmaker.core/flowmaker-front",
  "flowmaker.core/flowmaker-launcher",
  "flowmaker.core/flowmaker-logger",
  "flowmaker.core/flowmaker-runtime",

  // flowmaker.boxes (BSL only)
  "flowmaker.boxes/flow-box-mqtt-client",
  "flowmaker.boxes/flow-box-modbus-tcp",
  "flowmaker.boxes/flow-box-http-client",
  "flowmaker.boxes/flow-box-http",
  "flowmaker.boxes/flow-box-postgres-client",
  "flowmaker.boxes/flow-box-influx-client",
  "flowmaker.boxes/flow-box-timer",
  "flowmaker.boxes/flow-box-data-logger",
  "flowmaker.boxes/flow-box-test-data-generator",
  "flowmaker.boxes/flow-box-conditional-dataset-validator",
  "flowmaker.boxes/flow-box-enqueue",
  "flowmaker.boxes/flow-box-equation-solver",
  "flowmaker.boxes/flow-box-js-expression",
  "flowmaker.boxes/flow-box-notification",
  "flowmaker.boxes/flow-box-notifications",
  "flowmaker.boxes/flow-box-minio-sink",
  "flowmaker.boxes/flow-box-datacatalog-mapper",
  "flowmaker.boxes/flow-box-timeseries-workers",

  // flowmaker.infra
  "flowmaker.infra/flowmaker-worker-manager",

  // datacatalog
  "datacatalog/api",
  "datacatalog/ui",
  "datacatalog/uifusion",
  "datacatalog/acquisition-schema-api",

  // grafana
  "grafana/grafana-industream",
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

  for (const image of BSL_IMAGES) {
    const [sourceProject, ...repoParts] = image.split("/");
    const sourceRepo = repoParts.join("/");
    const destName = sourceRepo; // flatten: source repo name becomes dest name

    process.stdout.write(`  ${image} → ${COMMUNITY_PROJECT}/${destName} ... `);

    const artifacts = await listArtifacts(sourceProject, image);
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
