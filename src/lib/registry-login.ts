// src/lib/registry-login.ts
// Manages docker login to the Industream Harbor registries.
//
// Industream runs two Harbor instances side-by-side:
//   • PREMIUM_REGISTRY — paid plans (trial, pro, enterprise) and the legacy
//     community robot. Private projects require authentication.
//   • COMMUNITY_REGISTRY — new public Harbor for BSL 1.1 images. Anonymous
//     pulls work out of the box so no credentials are required. A robot may
//     be introduced later if we want quotas or richer audit logs.
//
// Login rules:
//   • plan === "community" && registry === COMMUNITY_REGISTRY → skip login
//     (public, anonymous pulls are sufficient).
//   • plan === "community" && registry === PREMIUM_REGISTRY → legacy behavior,
//     log in with the embedded `robot$community-public` account.
//   • plan !== "community" → pull Harbor credentials from the Keygen license
//     metadata and log in.
import { execa } from "execa";
import type { Plan } from "./modules.js";

// =============================================================================
// Registry hostnames
// =============================================================================
/** Legacy Harbor — premium plans and the `flowmaker.community` private project. */
export const PREMIUM_REGISTRY = "842775dh.c1.gra9.container-registry.ovh.net";
/** New public Harbor — BSL 1.1 images, anonymous pulls. */
export const COMMUNITY_REGISTRY = "39t88114.c1.gra9.container-registry.ovh.net";

// =============================================================================
// Legacy community credentials — embedded pull-only robot on the premium Harbor
// =============================================================================
// These credentials are intentionally distributed inside the CLI binary.
// They grant pull-only access to the BSL-licensed images in the private
// `flowmaker.community` project on PREMIUM_REGISTRY. Once all community images
// live on COMMUNITY_REGISTRY (which allows anonymous pulls) this constant can
// be retired.
const LEGACY_COMMUNITY_USERNAME = "robot$community-public";
const LEGACY_COMMUNITY_SECRET = "b47KyO3MzeGc9QL8zfMf9daFDEfrC4qb";

/**
 * Pick the registry hostname a given plan should pull from.
 * Community users target the new public Harbor; every paid plan keeps using
 * the premium Harbor.
 */
export function getRegistryForPlan(plan: Plan): string {
  return plan === "community" ? COMMUNITY_REGISTRY : PREMIUM_REGISTRY;
}

/**
 * Ensure the user is logged in to the Harbor registry appropriate for their
 * plan. Community users on the new public Harbor skip login entirely;
 * community users on the legacy Harbor use the embedded robot; premium users
 * must have a valid license with credentials in its metadata.
 */
export async function ensureRegistryLogin(
  registry: string,
  plan: Plan,
): Promise<void> {
  if (plan === "community") {
    if (registry === COMMUNITY_REGISTRY) {
      // Public Harbor — anonymous pulls are allowed, no login needed.
      return;
    }
    if (registry === PREMIUM_REGISTRY) {
      await dockerLogin(
        registry,
        LEGACY_COMMUNITY_USERNAME,
        LEGACY_COMMUNITY_SECRET,
      );
      return;
    }
    // Unknown registry on a community plan — fall through to legacy behavior
    // so existing integrations that point at a custom Harbor keep working.
    await dockerLogin(
      registry,
      LEGACY_COMMUNITY_USERNAME,
      LEGACY_COMMUNITY_SECRET,
    );
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
    // Use the absolute path (PATH may be limited in sg sessions)
    const dockerBin = "/usr/bin/docker";
    await execa(dockerBin, ["login", registry, "-u", username, "--password-stdin"], {
      input: secret,
    });
  } catch (err) {
    const errorMsg =
      err instanceof Error
        ? (err as Error & { stderr?: string }).stderr || err.message
        : String(err);
    throw new Error(
      `Failed to authenticate to Docker registry ${registry}:\n  ${errorMsg}`,
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
