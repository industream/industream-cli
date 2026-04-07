#!/usr/bin/env tsx
/**
 * scripts/setup-harbor-community.ts
 *
 * Creates the `flowmaker.community` public project in Harbor, a replication
 * rule that mirrors all BSL-licensed images from the private projects, and
 * a pull-only robot account that community users can embed in their CLI.
 *
 * Usage:
 *   HARBOR_USER=cdm HARBOR_PASSWORD=xxx npx tsx scripts/setup-harbor-community.ts           # dry run
 *   HARBOR_USER=cdm HARBOR_PASSWORD=xxx npx tsx scripts/setup-harbor-community.ts --apply   # create resources
 *
 * Safe: this script never deletes or modifies existing resources.
 */

const HARBOR_HOST = "842775dh.c1.gra9.container-registry.ovh.net";
const API = `https://${HARBOR_HOST}/api/v2.0`;
const USER = process.env.HARBOR_USER;
const PASSWORD = process.env.HARBOR_PASSWORD;

if (!USER || !PASSWORD) {
  console.error("Missing HARBOR_USER or HARBOR_PASSWORD environment variable");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");
const COMMUNITY_PROJECT = "flowmaker.community";
const REPLICATION_NAME = "community-bsl-mirror";
const ROBOT_NAME = "community-public";

// Images to replicate — each entry is the full `source_project/repo_name`
// The filter uses Harbor's double-star pattern with a name list.
const BSL_IMAGES = [
  // flowmaker.core (all BSL)
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

  // flowmaker.infra (BSL only — backup-monitor is proprietary, excluded)
  "flowmaker.infra/flowmaker-worker-manager",

  // datacatalog (BSL only — mcp-server is proprietary, excluded)
  "datacatalog/api",
  "datacatalog/ui",
  "datacatalog/uifusion",
  "datacatalog/acquisition-schema-api",

  // grafana (Apache 2.0)
  "grafana/grafana-industream",
];

// =============================================================================
// Harbor API helpers
// =============================================================================
const authHeader = `Basic ${Buffer.from(`${USER}:${PASSWORD}`).toString("base64")}`;

interface HarborResponse {
  status: number;
  body: unknown;
  headers: Headers;
}

async function api(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" = "GET",
  body?: unknown,
): Promise<HarborResponse> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      Authorization: authHeader,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let parsed: unknown = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return { status: response.status, body: parsed, headers: response.headers };
}

// =============================================================================
// Steps
// =============================================================================
async function ensureProject(): Promise<void> {
  console.log(`\n[1/3] Project: ${COMMUNITY_PROJECT}`);

  const existing = await api(`/projects/${COMMUNITY_PROJECT}`);
  if (existing.status === 200) {
    console.log(`  = already exists`);
    return;
  }

  if (!APPLY) {
    console.log(`  + would create public project ${COMMUNITY_PROJECT}`);
    return;
  }

  const result = await api("/projects", "POST", {
    project_name: COMMUNITY_PROJECT,
    metadata: {
      public: "true",
      enable_content_trust: "false",
      prevent_vul: "false",
      severity: "none",
      auto_scan: "false",
    },
  });

  if (result.status === 201) {
    console.log(`  + created`);
  } else {
    console.error(`  ✗ failed (${result.status}): ${JSON.stringify(result.body)}`);
    process.exit(1);
  }
}

async function ensureReplicationRule(): Promise<void> {
  console.log(`\n[2/3] Replication rule: ${REPLICATION_NAME}`);

  // List existing policies
  const list = await api("/replication/policies?page_size=100");
  const policies = Array.isArray(list.body) ? list.body : [];
  const existing = policies.find(
    (p: { name: string }) => p.name === REPLICATION_NAME,
  );

  if (existing) {
    console.log(`  = already exists (id=${(existing as { id: number }).id})`);
    return;
  }

  // Build the replication rule
  // src_registry null = local Harbor, dest_registry null = local Harbor
  // filter by list of repository names
  const rule = {
    name: REPLICATION_NAME,
    description: "Mirror BSL-licensed images to the public community project",
    src_registry: { id: 0 }, // local
    dest_registry: { id: 0 }, // local
    dest_namespace: COMMUNITY_PROJECT,
    dest_namespace_replace_count: -1, // flatten source namespace
    trigger: {
      type: "event_based",
      trigger_settings: {
        cron: "",
      },
    },
    filters: [
      {
        type: "name",
        value: `{${BSL_IMAGES.join(",")}}`,
      },
    ],
    enabled: true,
    deletion: false,
    override: true,
    speed: -1,
    copy_by_chunk: false,
  };

  if (!APPLY) {
    console.log(`  + would create event-based rule mirroring ${BSL_IMAGES.length} images`);
    console.log(`    sources:`);
    for (const img of BSL_IMAGES) console.log(`      - ${img}`);
    return;
  }

  const result = await api("/replication/policies", "POST", rule);
  if (result.status === 201) {
    console.log(`  + created`);
  } else {
    console.error(`  ✗ failed (${result.status}): ${JSON.stringify(result.body)}`);
    process.exit(1);
  }
}

async function ensureRobotAccount(): Promise<void> {
  console.log(`\n[3/3] Robot account: ${ROBOT_NAME}`);

  // Check if robot exists
  const list = await api("/robots?page_size=100");
  const robots = Array.isArray(list.body) ? list.body : [];
  const existing = robots.find(
    (r: { name: string }) =>
      r.name === `robot$${ROBOT_NAME}` || r.name === ROBOT_NAME,
  );

  if (existing) {
    console.log(`  = already exists (id=${(existing as { id: number }).id})`);
    console.log(`    (existing robots have no retrievable secret — recreate if needed)`);
    return;
  }

  if (!APPLY) {
    console.log(`  + would create system robot with pull-only on ${COMMUNITY_PROJECT}`);
    return;
  }

  const robot = {
    name: ROBOT_NAME,
    description: "Public community pull-only robot (credentials embedded in CLI)",
    duration: -1, // never expires
    level: "system",
    permissions: [
      {
        kind: "project",
        namespace: COMMUNITY_PROJECT,
        access: [
          { resource: "repository", action: "pull" },
        ],
      },
    ],
  };

  const result = await api("/robots", "POST", robot);
  if (result.status === 201) {
    const created = result.body as { name: string; secret: string };
    console.log(`  + created`);
    console.log(``);
    console.log(`    ════════════════════════════════════════════════════`);
    console.log(`    IMPORTANT: Save these credentials now (not retrievable later)`);
    console.log(``);
    console.log(`    username: ${created.name}`);
    console.log(`    secret:   ${created.secret}`);
    console.log(`    ════════════════════════════════════════════════════`);
  } else {
    console.error(`  ✗ failed (${result.status}): ${JSON.stringify(result.body)}`);
    process.exit(1);
  }
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  console.log(`Mode: ${APPLY ? "APPLY" : "DRY RUN"}`);
  console.log(`Host: ${HARBOR_HOST}`);

  await ensureProject();
  // NOTE: Harbor does not support local → local replication rules, so image
  // copying is handled by scripts/sync-harbor-community.ts instead.
  // await ensureReplicationRule();
  await ensureRobotAccount();

  console.log(``);
  if (!APPLY) {
    console.log(`Re-run with --apply to actually create these resources.`);
  } else {
    console.log(`Done. Trigger a manual replication from the UI to seed the project:`);
    console.log(`  Harbor UI → Replications → ${REPLICATION_NAME} → Replicate`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
