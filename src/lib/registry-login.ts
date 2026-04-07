// src/lib/registry-login.ts
// Manages docker login to the Industream Harbor registry.
//
// - Community users (no license or plan === "community"): logs in with
//   an embedded public pull-only robot account that has access to the
//   public `flowmaker.community` project only.
// - Premium users (paid license): uses the Harbor credentials stored in
//   their Keygen license metadata.
import { execa } from "execa";
import type { Plan } from "./modules.js";

// =============================================================================
// Community credentials — embedded public robot, pull-only on flowmaker.community
// =============================================================================
// These credentials are intentionally public. They give pull-only access to
// the BSL-licensed images mirrored under `flowmaker.community/`. Rotating them
// simply means pushing a new CLI release.
const COMMUNITY_USERNAME = "robot$community-public";
const COMMUNITY_SECRET = "b47KyO3MzeGc9QL8zfMf9daFDEfrC4qb";

/**
 * Ensure the user is logged in to the Harbor registry appropriate for their
 * plan. Community users get auto-login with the public robot. Premium users
 * must have a valid license with credentials in its metadata.
 */
export async function ensureRegistryLogin(
  registry: string,
  plan: Plan,
): Promise<void> {
  if (plan === "community") {
    await loginCommunity(registry);
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

async function loginCommunity(registry: string): Promise<void> {
  await dockerLogin(registry, COMMUNITY_USERNAME, COMMUNITY_SECRET);
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
