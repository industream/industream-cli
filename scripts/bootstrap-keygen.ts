#!/usr/bin/env tsx
/**
 * scripts/bootstrap-keygen.ts
 *
 * Creates all Industream policies and entitlements in your Keygen account.
 * Run once to set up the licensing structure, then re-run safely (idempotent).
 *
 * Usage:
 *   KEYGEN_TOKEN=admin-xxxxx npx tsx scripts/bootstrap-keygen.ts
 *
 * Get your admin token from:
 *   https://app.keygen.sh/tokens
 */

const KEYGEN_ACCOUNT = "industream-com";
const KEYGEN_PRODUCT = "5d42435b-bd24-46f0-b577-9050e6daf477";
const API = `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT}`;

const TOKEN = process.env.KEYGEN_TOKEN;
if (!TOKEN) {
  console.error("Missing KEYGEN_TOKEN environment variable");
  console.error("Get your admin token from https://app.keygen.sh/tokens");
  process.exit(1);
}

// =============================================================================
// POLICIES — one per pricing tier
// =============================================================================
const POLICIES = [
  {
    name: "Community",
    duration: null, // perpetual
    maxMachines: null, // unlimited
    floating: true,
    strict: false,
    metadata: { plan: "community", tagsLimit: 0 },
  },
  {
    name: "Trial 90 days",
    duration: 90 * 24 * 60 * 60,
    maxMachines: 1,
    floating: false,
    strict: true,
    metadata: { plan: "trial", tagsLimit: 5000 },
  },
  {
    name: "Starter 25 tags",
    duration: 365 * 24 * 60 * 60,
    maxMachines: 1,
    floating: false,
    strict: true,
    metadata: { plan: "pro", tagsLimit: 25 },
  },
  {
    name: "Standard 100 tags",
    duration: 365 * 24 * 60 * 60,
    maxMachines: 1,
    floating: false,
    strict: true,
    metadata: { plan: "pro", tagsLimit: 100 },
  },
  {
    name: "Professional 500 tags",
    duration: 365 * 24 * 60 * 60,
    maxMachines: 1,
    floating: false,
    strict: true,
    metadata: { plan: "pro", tagsLimit: 500 },
  },
  {
    name: "Business 1000 tags",
    duration: 365 * 24 * 60 * 60,
    maxMachines: 2,
    floating: true,
    strict: true,
    metadata: { plan: "business", tagsLimit: 1000 },
  },
  {
    name: "Enterprise 5000 tags",
    duration: 365 * 24 * 60 * 60,
    maxMachines: 5,
    floating: true,
    strict: true,
    metadata: { plan: "enterprise", tagsLimit: 5000 },
  },
];

// =============================================================================
// ENTITLEMENTS — one per product/bundle (matching Industream pricing structure)
// =============================================================================
const ENTITLEMENTS = [
  // Main products (sold as bundles in Customer Pricing)
  {
    code: "PRODUCT_DATACATALOG",
    name: "Data & Asset Catalog (FlowMaker, DataBridge, UI Fusion, Grafana)",
  },
  { code: "PRODUCT_AI_STUDIO", name: "AI Studio & Inference" },
  { code: "PRODUCT_MCP", name: "MCP Agentic Access (LLM enabler)" },

  // System options (add-ons, sold separately)
  { code: "ADDON_BACKUP", name: "Backup & monitoring" },
  { code: "ADDON_REDUNDANT", name: "Redundant server (HA active/passive)" },

  // Database add-ons (sold per-database)
  { code: "ADDON_DB_TIMESCALE", name: "TimescaleDB (time-series database)" },
  { code: "ADDON_DB_MSSQL", name: "MS SQL Server connector" },
  { code: "ADDON_DB_OSISOFT", name: "OSIsoft PI connector" },

  // Process packages (quoted separately)
  { code: "PACKAGE_IRONSTREAM", name: "IronStream — Blast Furnace process package" },
  { code: "PACKAGE_ARCSTREAM", name: "ArcStream — EAF process package" },
  { code: "PACKAGE_FLOWGUARD", name: "FlowGuard — OEE/TRS monitoring" },
  { code: "PACKAGE_MONITORING", name: "Industrial Monitoring (Tuyere, IR Hot Spot, Free Roll)" },
];

// =============================================================================
// POLICY → ENTITLEMENTS mapping
// =============================================================================
// All commercial tag bundles include PRODUCT_DATACATALOG by default (it IS the
// product being sold). Trial gets the 3 main products (DataCatalog, AI Studio,
// MCP) for evaluation. Process packages (IronStream, ArcStream, FlowGuard,
// Monitoring) and add-ons (Backup, Redundant) are NEVER attached to a policy
// — they must be attached to individual licenses after a signed contract.
const POLICY_ENTITLEMENTS: Record<string, string[]> = {
  Community: [],
  "Trial 90 days": ["PRODUCT_DATACATALOG", "PRODUCT_AI_STUDIO", "PRODUCT_MCP"],
  "Starter 25 tags": ["PRODUCT_DATACATALOG"],
  "Standard 100 tags": ["PRODUCT_DATACATALOG"],
  "Professional 500 tags": ["PRODUCT_DATACATALOG"],
  "Business 1000 tags": ["PRODUCT_DATACATALOG"],
  "Enterprise 5000 tags": ["PRODUCT_DATACATALOG"],
};

// =============================================================================
// Helper functions
// =============================================================================
const headers = {
  "Content-Type": "application/vnd.api+json",
  Accept: "application/vnd.api+json",
  Authorization: `Bearer ${TOKEN}`,
};

interface ApiResource {
  id: string;
  attributes: Record<string, unknown>;
}

interface ApiResponse {
  data?: ApiResource | ApiResource[];
  errors?: Array<{ title: string; detail: string }>;
}

async function api(
  path: string,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: unknown,
): Promise<ApiResponse> {
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status === 204) return {};
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as ApiResponse;
  } catch {
    throw new Error(`Invalid JSON response: ${text}`);
  }
}

async function listAll(path: string): Promise<ApiResource[]> {
  const all: ApiResource[] = [];
  let page = 1;
  while (true) {
    const result = await api(`${path}?page[size]=100&page[number]=${page}`);
    const items = (result.data as ApiResource[]) ?? [];
    all.push(...items);
    if (items.length < 100) break;
    page++;
  }
  return all;
}

// =============================================================================
// Main bootstrap
// =============================================================================
async function bootstrap(): Promise<void> {
  console.log("Bootstrapping Keygen account: industream-com");
  console.log("");

  // 1. Create entitlements
  console.log("Creating entitlements...");
  const existingEntitlements = await listAll("/entitlements");
  const entitlementByCode = new Map<string, string>();
  for (const e of existingEntitlements) {
    entitlementByCode.set(e.attributes.code as string, e.id);
  }

  for (const ent of ENTITLEMENTS) {
    if (entitlementByCode.has(ent.code)) {
      console.log(`  = ${ent.code} (already exists)`);
      continue;
    }
    const result = await api("/entitlements", "POST", {
      data: {
        type: "entitlements",
        attributes: { name: ent.name, code: ent.code },
      },
    });
    if (result.errors) {
      console.error(`  ✗ ${ent.code}: ${result.errors[0]?.detail}`);
      continue;
    }
    const id = (result.data as ApiResource).id;
    entitlementByCode.set(ent.code, id);
    console.log(`  + ${ent.code}`);
  }

  // 2. Create policies
  console.log("");
  console.log("Creating policies...");
  const existingPolicies = await listAll("/policies");
  const policyByName = new Map<string, string>();
  for (const p of existingPolicies) {
    policyByName.set(p.attributes.name as string, p.id);
  }

  for (const pol of POLICIES) {
    if (policyByName.has(pol.name)) {
      console.log(`  = ${pol.name} (already exists)`);
      continue;
    }
    const result = await api("/policies", "POST", {
      data: {
        type: "policies",
        attributes: {
          name: pol.name,
          duration: pol.duration,
          maxMachines: pol.maxMachines,
          floating: pol.floating,
          strict: pol.strict,
          metadata: pol.metadata,
        },
        relationships: {
          product: { data: { type: "products", id: KEYGEN_PRODUCT } },
        },
      },
    });
    if (result.errors) {
      console.error(`  ✗ ${pol.name}: ${result.errors[0]?.detail}`);
      continue;
    }
    const id = (result.data as ApiResource).id;
    policyByName.set(pol.name, id);
    console.log(`  + ${pol.name}`);
  }

  // 3. Reconcile entitlements on each policy (add missing, remove extra)
  console.log("");
  console.log("Syncing entitlements on policies...");
  for (const [policyName, desiredCodes] of Object.entries(POLICY_ENTITLEMENTS)) {
    const policyId = policyByName.get(policyName);
    if (!policyId) {
      console.log(`  ! ${policyName}: policy not found, skipping`);
      continue;
    }

    // Fetch currently attached entitlements
    const currentResult = await api(`/policies/${policyId}/entitlements`);
    const currentList = (currentResult.data as ApiResource[] | undefined) ?? [];
    const currentByCode = new Map<string, string>(
      currentList.map((e) => [e.attributes.code as string, e.id]),
    );

    const desiredSet = new Set(desiredCodes);
    const currentSet = new Set(currentByCode.keys());

    const toAdd = [...desiredSet].filter((code) => !currentSet.has(code));
    const toRemove = [...currentSet].filter((code) => !desiredSet.has(code));

    // Detach entitlements that should not be on this policy
    if (toRemove.length > 0) {
      const removeData = toRemove
        .map((code) => currentByCode.get(code))
        .filter((id): id is string => Boolean(id))
        .map((id) => ({ type: "entitlements", id }));
      const result = await api(
        `/policies/${policyId}/entitlements`,
        "DELETE",
        { data: removeData },
      );
      if (result.errors) {
        console.error(`  ✗ ${policyName} detach: ${result.errors[0]?.detail}`);
      } else {
        console.log(`  − ${policyName}: removed ${toRemove.join(", ")}`);
      }
    }

    // Attach entitlements that are missing
    if (toAdd.length > 0) {
      const addData = toAdd
        .map((code) => entitlementByCode.get(code))
        .filter((id): id is string => Boolean(id))
        .map((id) => ({ type: "entitlements", id }));
      if (addData.length > 0) {
        const result = await api(
          `/policies/${policyId}/entitlements`,
          "POST",
          { data: addData },
        );
        if (result.errors) {
          console.error(`  ✗ ${policyName} attach: ${result.errors[0]?.detail}`);
        } else {
          console.log(`  + ${policyName}: added ${toAdd.join(", ")}`);
        }
      }
    }

    if (toAdd.length === 0 && toRemove.length === 0) {
      console.log(`  = ${policyName}: ${desiredCodes.length} entitlements (in sync)`);
    }
  }

  console.log("");
  console.log("Done. Your Keygen account is ready.");
  console.log("");
  console.log(
    `Existing: ${entitlementByCode.size}/${ENTITLEMENTS.length} entitlements, ${policyByName.size}/${POLICIES.length} policies`,
  );
}

bootstrap().catch((err) => {
  console.error("Bootstrap failed:", err);
  process.exit(1);
});
