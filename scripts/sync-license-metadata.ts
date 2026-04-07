#!/usr/bin/env tsx
/**
 * scripts/sync-license-metadata.ts
 *
 * Copies the plan and tagsLimit metadata from each policy to its licenses.
 * Run this after updating policy metadata (via fix-policies.ts) so that
 * existing licenses get the correct plan visible to the CLI.
 *
 * Usage:
 *   KEYGEN_TOKEN=prod-xxx npx tsx scripts/sync-license-metadata.ts
 */

const KEYGEN_ACCOUNT = "industream-com";
const API = `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT}`;

const TOKEN = process.env.KEYGEN_TOKEN;
if (!TOKEN) {
  console.error("Missing KEYGEN_TOKEN");
  process.exit(1);
}

const headers = {
  "Content-Type": "application/vnd.api+json",
  Accept: "application/vnd.api+json",
  Authorization: `Bearer ${TOKEN}`,
};

interface ResourceWithMetadata {
  id: string;
  attributes: {
    name: string;
    metadata?: Record<string, unknown>;
  };
  relationships?: {
    policy?: { data?: { id: string } };
  };
}

async function listAll(path: string): Promise<ResourceWithMetadata[]> {
  const all: ResourceWithMetadata[] = [];
  let page = 1;
  while (true) {
    const response = await fetch(
      `${API}${path}?page[number]=${page}&page[size]=100`,
      { headers },
    );
    const body = (await response.json()) as {
      data?: ResourceWithMetadata[];
      errors?: Array<{ detail: string }>;
    };
    if (body.errors) {
      console.error("API error:", body.errors);
      process.exit(1);
    }
    const items = body.data ?? [];
    all.push(...items);
    if (items.length < 100) break;
    page++;
  }
  return all;
}

async function main(): Promise<void> {
  console.log("Loading policies...");
  const policies = await listAll("/policies");
  const policyMeta = new Map<string, Record<string, unknown>>();
  for (const p of policies) {
    policyMeta.set(p.id, p.attributes.metadata ?? {});
  }
  console.log(`  Loaded ${policies.length} policies`);

  console.log("");
  console.log("Loading licenses...");
  const licenses = await listAll("/licenses");
  console.log(`  Loaded ${licenses.length} licenses`);
  console.log("");

  console.log("Syncing license metadata from policy metadata...");
  console.log("");

  for (const license of licenses) {
    const policyId = license.relationships?.policy?.data?.id;
    if (!policyId) {
      console.log(`  ? ${license.attributes.name ?? license.id} (no policy)`);
      continue;
    }

    const policyMetadata = policyMeta.get(policyId);
    if (!policyMetadata) {
      console.log(
        `  ? ${license.attributes.name ?? license.id} (policy not found)`,
      );
      continue;
    }

    // Merge policy metadata into license metadata (policy metadata wins
    // for keys like plan/tagsLimit but we keep license-specific keys).
    const mergedMetadata = {
      ...(license.attributes.metadata ?? {}),
      ...policyMetadata,
    };

    const update = await fetch(`${API}/licenses/${license.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        data: {
          type: "licenses",
          attributes: { metadata: mergedMetadata },
        },
      }),
    });

    if (update.ok) {
      const plan = mergedMetadata.plan ?? "—";
      console.log(
        `  ✓ ${license.attributes.name ?? license.id} → plan=${plan}`,
      );
    } else {
      const error = (await update.json()) as {
        errors?: Array<{ detail: string }>;
      };
      console.log(
        `  ✗ ${license.attributes.name ?? license.id}: ${error.errors?.[0]?.detail ?? "failed"}`,
      );
    }
  }

  console.log("");
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
