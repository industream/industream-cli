#!/usr/bin/env tsx
/**
 * scripts/create-customer.ts
 *
 * Creates a new customer setup:
 *  1. A Harbor robot account with pull access to the required projects
 *  2. A Keygen license attached to a policy
 *  3. Harbor credentials stored in the license metadata
 *
 * Usage:
 *   HARBOR_USER=cdm HARBOR_PASSWORD=xxx KEYGEN_TOKEN=admin-xxx \
 *     npx tsx scripts/create-customer.ts \
 *       --name "Acme Corp" \
 *       --policy "Professional 500 tags" \
 *       --addons ADDON_BACKUP,PACKAGE_IRONSTREAM
 */

// =============================================================================
// Config
// =============================================================================
const HARBOR_HOST = "842775dh.c1.gra9.container-registry.ovh.net";
const HARBOR_API = `https://${HARBOR_HOST}/api/v2.0`;
const KEYGEN_ACCOUNT = "industream-com";
const KEYGEN_API = `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT}`;
const KEYGEN_PRODUCT = "5d42435b-bd24-46f0-b577-9050e6daf477";

// All premium Harbor projects the robot will be allowed to pull from
const PREMIUM_PROJECTS = [
  "flowmaker.core",
  "flowmaker.boxes",
  "flowmaker.infra",
  "datacatalog",
  "grafana",
  "uifusion",
  "timeseries",
  "monitoring",
  "ironstream",
  "industream",
];

// =============================================================================
// Args
// =============================================================================
const args = process.argv.slice(2);
function getArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  return idx >= 0 ? args[idx + 1] : undefined;
}

const CUSTOMER_NAME = getArg("name");
const POLICY_NAME = getArg("policy") ?? "Professional 500 tags";
const ADDONS_STR = getArg("addons") ?? "";

if (!CUSTOMER_NAME) {
  console.error("Missing --name <customer-name>");
  console.error("");
  console.error("Usage: npx tsx scripts/create-customer.ts --name \"Acme Corp\" [options]");
  console.error("");
  console.error("Options:");
  console.error("  --name <name>           Customer display name (required)");
  console.error("  --policy <policy>       Keygen policy name (default: 'Professional 500 tags')");
  console.error("  --addons <list>         Comma-separated entitlement codes (e.g. ADDON_BACKUP,PACKAGE_IRONSTREAM)");
  process.exit(1);
}

const HARBOR_USER = process.env.HARBOR_USER;
const HARBOR_PASSWORD = process.env.HARBOR_PASSWORD;
const KEYGEN_TOKEN = process.env.KEYGEN_TOKEN;

if (!HARBOR_USER || !HARBOR_PASSWORD || !KEYGEN_TOKEN) {
  console.error("Missing HARBOR_USER / HARBOR_PASSWORD / KEYGEN_TOKEN env vars");
  process.exit(1);
}

const harborAuth = `Basic ${Buffer.from(`${HARBOR_USER}:${HARBOR_PASSWORD}`).toString("base64")}`;

const addons = ADDONS_STR.split(",").map((s) => s.trim()).filter(Boolean);

// =============================================================================
// Helpers
// =============================================================================
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 30);
}

async function harborApi(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${HARBOR_API}${path}`, {
    method,
    headers: {
      Authorization: harborAuth,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

async function keygenApi(
  path: string,
  method: "GET" | "POST" = "GET",
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const response = await fetch(`${KEYGEN_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${KEYGEN_TOKEN}`,
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

// =============================================================================
// Steps
// =============================================================================
async function createHarborRobot(slug: string): Promise<{
  name: string;
  secret: string;
}> {
  console.log("");
  console.log("[1/3] Creating Harbor robot account...");

  const robotName = `client-${slug}`;
  const permissions = PREMIUM_PROJECTS.map((project) => ({
    kind: "project",
    namespace: project,
    access: [{ resource: "repository", action: "pull" }],
  }));

  const response = await harborApi("/robots", "POST", {
    name: robotName,
    description: `Customer robot: ${CUSTOMER_NAME}`,
    duration: -1,
    level: "system",
    permissions,
  });

  if (response.status !== 201) {
    console.error(`  ✗ Harbor API error (${response.status}):`, response.body);
    process.exit(1);
  }

  const robot = response.body as { name: string; secret: string };
  console.log(`  ✓ Robot created: ${robot.name}`);
  return robot;
}

async function findPolicyIdByName(name: string): Promise<string> {
  console.log("");
  console.log(`[2/3] Looking up Keygen policy '${name}'...`);

  const response = await keygenApi(
    `/policies?page[number]=1&page[size]=100`,
  );
  const body = response.body as {
    data: Array<{ id: string; attributes: { name: string; metadata?: Record<string, unknown> } }>;
  };
  const policy = body.data.find((p) => p.attributes.name === name);
  if (!policy) {
    console.error(`  ✗ Policy not found: ${name}`);
    console.error(`  Available:`);
    for (const p of body.data) console.error(`    - ${p.attributes.name}`);
    process.exit(1);
  }
  console.log(`  ✓ Policy found: ${policy.id}`);
  return policy.id;
}

async function createLicense(
  policyId: string,
  robot: { name: string; secret: string },
): Promise<{ id: string; key: string }> {
  console.log("");
  console.log(`[3/3] Creating Keygen license for '${CUSTOMER_NAME}'...`);

  const response = await keygenApi("/licenses", "POST", {
    data: {
      type: "licenses",
      attributes: {
        name: CUSTOMER_NAME,
        metadata: {
          customer: CUSTOMER_NAME,
          harborCredentials: {
            username: robot.name,
            secret: robot.secret,
          },
        },
      },
      relationships: {
        policy: { data: { type: "policies", id: policyId } },
      },
    },
  });

  if (response.status !== 201) {
    console.error(`  ✗ Keygen API error (${response.status}):`, response.body);
    process.exit(1);
  }

  const license = (response.body as {
    data: { id: string; attributes: { key: string } };
  }).data;

  console.log(`  ✓ License created: ${license.id}`);

  // Copy policy metadata (plan, tagsLimit) to license metadata
  const policyResponse = await keygenApi(`/policies/${policyId}`);
  const policyMeta =
    (policyResponse.body as { data: { attributes: { metadata?: Record<string, unknown> } } })
      .data.attributes.metadata ?? {};
  const mergedMetadata = {
    customer: CUSTOMER_NAME,
    harborCredentials: {
      username: robot.name,
      secret: robot.secret,
    },
    ...policyMeta,
  };
  await keygenApi(`/licenses/${license.id}`, "POST", {
    // Keygen uses PATCH via POST with override
    data: {
      type: "licenses",
      attributes: { metadata: mergedMetadata },
    },
  });

  // Attach add-on entitlements
  if (addons.length > 0) {
    console.log(`  Attaching ${addons.length} addons...`);
    const entResponse = await keygenApi(
      `/entitlements?page[number]=1&page[size]=100`,
    );
    const entitlements = (entResponse.body as {
      data: Array<{ id: string; attributes: { code: string } }>;
    }).data;
    const toAttach = addons
      .map((code) => entitlements.find((e) => e.attributes.code === code))
      .filter((e): e is { id: string; attributes: { code: string } } => Boolean(e))
      .map((e) => ({ type: "entitlements", id: e.id }));

    if (toAttach.length > 0) {
      const attachResponse = await keygenApi(
        `/licenses/${license.id}/entitlements`,
        "POST",
        { data: toAttach },
      );
      if (attachResponse.status === 200 || attachResponse.status === 201) {
        console.log(`  ✓ Attached ${toAttach.length} entitlements`);
      } else {
        console.error(`  ✗ Attach failed:`, attachResponse.body);
      }
    }
  }

  return { id: license.id, key: license.attributes.key };
}

// =============================================================================
// Main
// =============================================================================
async function main(): Promise<void> {
  console.log("");
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(` Creating customer: ${CUSTOMER_NAME}`);
  console.log(` Policy:   ${POLICY_NAME}`);
  console.log(` Addons:   ${addons.length > 0 ? addons.join(", ") : "(none)"}`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

  const slug = slugify(CUSTOMER_NAME);
  const robot = await createHarborRobot(slug);
  const policyId = await findPolicyIdByName(POLICY_NAME);
  const license = await createLicense(policyId, robot);

  console.log("");
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(` ✓ Customer setup complete`);
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log("");
  console.log(`  Customer:       ${CUSTOMER_NAME}`);
  console.log(`  License key:    ${license.key}`);
  console.log(`  Harbor robot:   ${robot.name}`);
  console.log("");
  console.log(`  Send the license key to the customer. They install it with:`);
  console.log(`    industream license --set ${license.key}`);
  console.log("");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
