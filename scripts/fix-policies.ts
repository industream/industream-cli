#!/usr/bin/env tsx
/**
 * scripts/fix-policies.ts
 * Update all policies with:
 *  - authenticationStrategy: LICENSE (allow license-based machine activation)
 *  - metadata.plan (plan name used by the CLI)
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

// Map policy name → plan code used by the CLI
const PLAN_BY_NAME: Record<string, { plan: string; tagsLimit: number }> = {
  Community: { plan: "community", tagsLimit: 0 },
  "Trial 90 days": { plan: "trial", tagsLimit: 5000 },
  "Starter 25 tags": { plan: "pro", tagsLimit: 25 },
  "Standard 100 tags": { plan: "pro", tagsLimit: 100 },
  "Professional 500 tags": { plan: "pro", tagsLimit: 500 },
  "Business 1000 tags": { plan: "business", tagsLimit: 1000 },
  "Enterprise 5000 tags": { plan: "enterprise", tagsLimit: 5000 },
};

async function main(): Promise<void> {
  const response = await fetch(
    `${API}/policies?page[number]=1&page[size]=100`,
    { headers },
  );
  const body = (await response.json()) as {
    data?: Array<{
      id: string;
      attributes: { name: string; metadata?: Record<string, unknown> };
    }>;
    errors?: Array<{ detail: string }>;
  };

  if (body.errors || !body.data) {
    console.error("API error:", body.errors);
    process.exit(1);
  }

  console.log(`Updating ${body.data.length} policies...`);
  console.log("");

  for (const policy of body.data) {
    const planInfo = PLAN_BY_NAME[policy.attributes.name];
    if (!planInfo) {
      console.log(`  ? ${policy.attributes.name} (no plan mapping, skipping)`);
      continue;
    }

    const update = await fetch(`${API}/policies/${policy.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({
        data: {
          type: "policies",
          attributes: {
            authenticationStrategy: "LICENSE",
            metadata: {
              ...(policy.attributes.metadata ?? {}),
              plan: planInfo.plan,
              tagsLimit: planInfo.tagsLimit,
            },
          },
        },
      }),
    });

    if (update.ok) {
      console.log(`  ✓ ${policy.attributes.name} → plan=${planInfo.plan}, tags=${planInfo.tagsLimit}`);
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
