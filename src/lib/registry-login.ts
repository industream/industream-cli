// src/lib/registry-login.ts
// Manages docker login to the Industream Harbor registry.
//
// - Community users (no license or plan === "community"): no login needed,
//   `flowmaker.community` is a public Harbor project with anonymous pull.
// - Premium users (paid license): uses the Harbor credentials stored in
//   their Keygen license metadata.
import { execa } from "execa";
import type { Plan } from "./modules.js";

/**
 * Ensure the user is logged in to the Harbor registry appropriate for their
 * plan. Community users don't need authentication (public project). Premium
 * users must have a valid license with credentials in its metadata.
 */
export async function ensureRegistryLogin(
  registry: string,
  plan: Plan,
): Promise<void> {
  if (plan === "community") {
    // Public project — anonymous pull works, no login required
    return;
  }

  // Premium: credentials should come from Keygen license metadata
  const credentials = await getPremiumCredentials();
  if (!credentials) {
    throw new Error(
      `Premium license found but no Harbor credentials in license metadata.\n` +
        `Contact sales@industream.com to get your registry access.`,
    );
  }
  await dockerLogin(registry, credentials.username, credentials.secret);
}

async function dockerLogin(
  registry: string,
  username: string,
  secret: string,
): Promise<void> {
  try {
    await execa(
      "docker",
      ["login", registry, "-u", username, "--password-stdin"],
      { input: secret, stdio: ["pipe", "pipe", "pipe"] },
    );
  } catch (err) {
    throw new Error(
      `Failed to authenticate to Docker registry ${registry}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function getPremiumCredentials(): Promise<
  { username: string; secret: string } | null
> {
  const { loadCachedLicense } = await import("./keygen.js");
  const cache = await loadCachedLicense();
  if (!cache?.response.data) return null;
  const metadata = cache.response.data.attributes.metadata as
    | { harborCredentials?: { username: string; secret: string } }
    | undefined;
  return metadata?.harborCredentials ?? null;
}
