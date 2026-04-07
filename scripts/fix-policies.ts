#!/usr/bin/env tsx
/**
 * scripts/fix-policies.ts
 * Update all policies to allow license-based machine activation.
 *
 * Usage:
 *   KEYGEN_TOKEN=prod-xxx npx tsx scripts/fix-policies.ts
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

async function main(): Promise<void> {
  const response = await fetch(
    `${API}/policies?page[number]=1&page[size]=100`,
    { headers },
  );
  const body = (await response.json()) as {
    data?: Array<{ id: string; attributes: { name: string } }>;
    errors?: Array<{ detail: string }>;
  };

  if (body.errors) {
    console.error("API errors:", body.errors);
    process.exit(1);
  }

  if (!body.data) {
    console.error("No data in response");
    process.exit(1);
  }

  console.log(`Updating ${body.data.length} policies...`);
  console.log("");

  for (const policy of body.data) {
    const update = await fetch(`${API}/policies/${policy.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        data: {
          type: "policies",
          attributes: {
            authenticationStrategy: "LICENSE",
          },
        },
      }),
    });

    if (update.ok) {
      console.log(`  ✓ ${policy.attributes.name}`);
    } else {
      const error = (await update.json()) as {
        errors?: Array<{ detail: string }>;
      };
      console.log(
        `  ✗ ${policy.attributes.name}: ${error.errors?.[0]?.detail ?? "failed"}`,
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
