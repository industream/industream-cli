// src/commands/license.ts
import {
  activateLicense,
  loadCachedLicense,
  loadLicenseKey,
  validateLicenseWithKeygen,
  type CachedLicense,
} from "../lib/keygen.js";

export async function runLicense(options?: { set?: string }): Promise<void> {
  if (options?.set) {
    await activate(options.set);
    return;
  }
  await displayLicense();
}

async function activate(key: string): Promise<void> {
  console.log("");
  console.log(`  Activating license ${key}...`);

  try {
    const response = await activateLicense(key.trim());

    if (!response.meta.valid) {
      console.error("");
      console.error(`  \x1b[31m✗ Activation failed: ${response.meta.detail}\x1b[0m`);
      console.error(`  \x1b[31m  Code: ${response.meta.code}\x1b[0m`);
      if (response.errors) {
        for (const err of response.errors) {
          console.error(`  \x1b[31m  ${err.title}: ${err.detail}\x1b[0m`);
        }
      }
      process.exit(1);
    }

    console.log("  \x1b[32m✓ License activated successfully\x1b[0m");
    console.log("");

    const cache = await loadCachedLicense();
    if (cache) {
      printLicenseDetails(cache);
    }
  } catch (err) {
    console.error("");
    console.error(`  \x1b[31m✗ Could not reach Keygen API: ${err instanceof Error ? err.message : String(err)}\x1b[0m`);
    console.error("  \x1b[31m  Check your internet connection and try again.\x1b[0m");
    process.exit(1);
  }
}

async function displayLicense(): Promise<void> {
  const key = await loadLicenseKey();
  if (!key) {
    console.log("");
    console.log("  Community Edition (no license)");
    console.log("");
    console.log("  To activate a license, run:");
    console.log("    industream license --set <license-key>");
    console.log("");
    return;
  }

  // Try to refresh online; falls back to cache if offline
  const result = await validateLicenseWithKeygen(key);

  if (!result.cache) {
    console.log("");
    console.log("  \x1b[31m✗ License found but never validated\x1b[0m");
    console.log("  \x1b[31m  Run: industream license --set " + key + "\x1b[0m");
    console.log("");
    return;
  }

  printLicenseDetails(result.cache, { online: result.online, valid: result.valid });
}

function printLicenseDetails(
  cache: CachedLicense,
  status?: { online: boolean; valid: boolean },
): void {
  const attrs = cache.response.data?.attributes;
  if (!attrs) {
    console.log("  No license data available");
    return;
  }

  const expiry = attrs.expiry ? new Date(attrs.expiry) : null;
  const daysRemaining = expiry
    ? Math.floor((expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;

  console.log("");
  console.log("  \x1b[1mLicense Information\x1b[0m");
  console.log("");
  console.log(`  Customer:       ${cache.customer ?? "—"}`);
  console.log(`  Plan:           ${cache.plan}`);
  console.log(`  Status:         ${attrs.status}`);
  console.log(`  Key:            ${maskKey(cache.key)}`);
  console.log(`  Machine:        ${cache.fingerprint}`);
  console.log(`  Max machines:   ${attrs.maxMachines ?? "unlimited"}`);
  if (expiry && daysRemaining !== null) {
    if (daysRemaining > 0) {
      console.log(`  Expiry:         ${expiry.toISOString().split("T")[0]} (${daysRemaining} days)`);
    } else {
      console.log(`  Expiry:         \x1b[31m${expiry.toISOString().split("T")[0]} (expired ${-daysRemaining} days ago)\x1b[0m`);
    }
  } else {
    console.log("  Expiry:         Never");
  }

  console.log("");
  console.log(`  \x1b[1mEntitlements (${cache.entitlements.length})\x1b[0m`);
  if (cache.entitlements.length === 0) {
    console.log("    (none)");
  } else {
    for (const ent of cache.entitlements) {
      console.log(`    \x1b[32m●\x1b[0m ${ent}`);
    }
  }

  console.log("");
  console.log(
    `  Last validated: ${new Date(cache.validatedAt).toISOString().split("T")[0]}` +
      (status?.online === false ? " \x1b[33m(offline cache)\x1b[0m" : ""),
  );
  if (status?.valid === false && status.online) {
    console.log("  \x1b[31m⚠ License is no longer valid on the server\x1b[0m");
  }
  console.log("");
}

function maskKey(key: string): string {
  if (key.length < 12) return key;
  return `${key.slice(0, 6)}…${key.slice(-6)}`;
}
