#!/usr/bin/env tsx
/**
 * scripts/cleanup-keygen.ts
 *
 * Removes the old MODULE_* entitlements from your Keygen account.
 * These were the per-module entitlements used before the switch to
 * product/bundle-based entitlements (PRODUCT_*, ADDON_*, PACKAGE_*).
 *
 * Usage:
 *   KEYGEN_TOKEN=admin-xxx npx tsx scripts/cleanup-keygen.ts            # dry run
 *   KEYGEN_TOKEN=admin-xxx npx tsx scripts/cleanup-keygen.ts --apply    # actually delete
 */

const KEYGEN_ACCOUNT = "industream-com";
const API = `https://api.keygen.sh/v1/accounts/${KEYGEN_ACCOUNT}`;

const TOKEN = process.env.KEYGEN_TOKEN;
if (!TOKEN) {
  console.error("Missing KEYGEN_TOKEN");
  process.exit(1);
}

const APPLY = process.argv.includes("--apply");

const headers = {
  "Content-Type": "application/vnd.api+json",
  Accept: "application/vnd.api+json",
  Authorization: `Bearer ${TOKEN}`,
};

interface Entitlement {
  id: string;
  attributes: {
    name: string;
    code: string;
  };
}

async function listAll(): Promise<Entitlement[]> {
  const all: Entitlement[] = [];
  let page = 1;
  while (true) {
    const response = await fetch(
      `${API}/entitlements?page[number]=${page}&page[size]=100`,
      { headers },
    );
    const body = (await response.json()) as {
      data?: Entitlement[];
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
  console.log(`Mode: ${APPLY ? "APPLY (delete)" : "DRY RUN (no changes)"}`);
  console.log("");
  console.log("Loading entitlements...");

  const all = await listAll();
  const toDelete = all.filter((e) => e.attributes.code.startsWith("MODULE_"));
  const toKeep = all.filter((e) => !e.attributes.code.startsWith("MODULE_"));

  console.log(`  ${all.length} total entitlements`);
  console.log(`  ${toKeep.length} to keep (PRODUCT_*, ADDON_*, PACKAGE_*)`);
  console.log(`  ${toDelete.length} to delete (MODULE_*)`);
  console.log("");

  if (toDelete.length === 0) {
    console.log("Nothing to delete. Bye.");
    return;
  }

  console.log("To delete:");
  for (const e of toDelete) {
    console.log(`  - ${e.attributes.code} (${e.id})`);
  }
  console.log("");

  if (!APPLY) {
    console.log("Re-run with --apply to actually delete these entitlements.");
    return;
  }

  console.log("Deleting...");
  let deleted = 0;
  let failed = 0;
  for (const e of toDelete) {
    const response = await fetch(`${API}/entitlements/${e.id}`, {
      method: "DELETE",
      headers,
    });
    if (response.ok || response.status === 204) {
      console.log(`  ✓ ${e.attributes.code}`);
      deleted++;
    } else {
      const body = await response.text();
      console.log(`  ✗ ${e.attributes.code}: ${body.slice(0, 100)}`);
      failed++;
    }
  }

  console.log("");
  console.log(`Done. Deleted: ${deleted}, Failed: ${failed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
