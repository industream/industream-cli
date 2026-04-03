// src/commands/license.ts
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { getConfigDir } from "../lib/config.js";
import { validateLicense, loadLicenseFromDisk } from "../lib/license.js";

export async function runLicense(options?: { set?: string }): Promise<void> {
  if (options?.set) {
    await saveLicense(options.set);
    return;
  }

  await displayLicense();
}

async function saveLicense(token: string): Promise<void> {
  const result = await validateLicense(token);

  if (!result.isValid) {
    console.error(`Invalid license: ${result.error}`);
    process.exit(1);
  }

  const configDirectory = getConfigDir();
  await mkdir(configDirectory, { recursive: true });
  const filePath = join(configDirectory, "industream.license");
  await writeFile(filePath, token.trim());

  console.log("License saved successfully.");
  await displayLicenseResult(result);
}

async function displayLicense(): Promise<void> {
  const token = await loadLicenseFromDisk();
  const result = await validateLicense(token);

  if (!token) {
    console.log("Community Edition (no license file)");
    return;
  }

  await displayLicenseResult(result);
}

async function displayLicenseResult(
  result: Awaited<ReturnType<typeof validateLicense>>,
): Promise<void> {
  const { payload, isValid, isGracePeriod, daysRemaining } = result;

  if (!payload) {
    console.error(`License error: ${result.error}`);
    return;
  }

  console.log("");
  console.log("  \x1b[1mLicense Information\x1b[0m");
  console.log("");
  console.log(`  Customer:       ${payload.customer}`);
  console.log(`  Plan:           ${payload.plan}`);
  console.log(`  Modules:        ${payload.modules.length}`);
  console.log(`  Trial:          ${payload.trial ? "Yes" : "No"}`);

  if (daysRemaining === Infinity) {
    console.log("  Expiration:     Never");
  } else if (daysRemaining >= 0) {
    console.log(`  Days remaining: ${daysRemaining}`);
  } else {
    console.log(`  Days remaining: expired ${Math.abs(daysRemaining)} days ago`);
  }

  if (!isValid) {
    console.log("");
    console.log(
      "  \x1b[31m⚠ License expired — grace period (30 days) exceeded.\x1b[0m",
    );
    console.log(
      "  \x1b[31m  Contact sales@industream.com to renew.\x1b[0m",
    );
  } else if (isGracePeriod) {
    console.log("");
    console.log(
      "  \x1b[33m⚠ License expired — running in grace period (30 days).\x1b[0m",
    );
    console.log(
      "  \x1b[33m  Renew soon to avoid service interruption.\x1b[0m",
    );
  }

  console.log("");
}
