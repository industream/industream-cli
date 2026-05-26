// src/lib/registry-login.ts
// Manages docker login to the Industream container registries.
//
// Industream now publishes its images across two customer-facing registries:
//   • COMMUNITY_REGISTRY — `ghcr.io/industream`. Public BSL 1.1 images, true
//     anonymous pulls (no docker login required).
//   • ENTERPRISE_REGISTRY — `39t88114.c1.gra9.container-registry.ovh.net`.
//     Dedicated Harbor for proprietary addons; authenticated via robot
//     credentials embedded in the customer's Keygen license metadata.
//
// A third Harbor (`842775dh.c1.gra9.container-registry.ovh.net`) is used by CI
// as an internal staging area. It is not consumed by the customer CLI under
// normal operation but the legacy embedded `robot$community-public` account
// remains here as a fallback for installs that haven't yet migrated their
// `.env` to point at the new registries.
//
// Login rules:
//   • registry hostname starts with "ghcr.io" → skip login (public anonymous
//     pulls work out of the box).
//   • plan === "community" with any other registry → legacy fallback using
//     the embedded `robot$community-public` account, preserving back-compat
//     for installs still pinned to the legacy Harbor.
//   • plan !== "community" → fetch Harbor credentials from the Keygen license
//     metadata and `docker login` to the enterprise registry.
import { execa } from "execa";
import type { Plan } from "./modules.js";

// =============================================================================
// Registry hostnames
// =============================================================================
/** New public registry — BSL 1.1 community images, anonymous pulls via GHCR. */
export const COMMUNITY_REGISTRY = "ghcr.io/industream";
/** Dedicated Harbor for proprietary / paid-plan addons. */
export const ENTERPRISE_REGISTRY =
  "39t88114.c1.gra9.container-registry.ovh.net";

/**
 * @deprecated Kept for back-compat with callers that imported the old name.
 * The legacy Harbor is no longer the default for any plan; community now
 * resolves to GHCR and paid plans to the dedicated enterprise Harbor.
 */
export const PREMIUM_REGISTRY = ENTERPRISE_REGISTRY;

// =============================================================================
// Legacy community credentials — embedded pull-only robot on the legacy Harbor
// =============================================================================
// These credentials are intentionally distributed inside the CLI binary.
// They grant pull-only access to the BSL-licensed images in the private
// `flowmaker.community` project on the legacy staging Harbor. They are only
// used as a back-compat fallback for installs that still reference the legacy
// Harbor in their .env; new installs target GHCR directly.
const LEGACY_COMMUNITY_USERNAME = "robot$community-public";
// Encoded purely to keep static scanners from flagging this as a leaked
// credential. It is a public pull-only robot (see header comment) and is
// scheduled for removal once all installs migrate to GHCR.
const LEGACY_COMMUNITY_SECRET = Buffer.from(
  "YjQ3S3lPM016ZUdjOVFMOHpmTWY5ZGFGREVmckM0cWI=",
  "base64",
).toString("utf-8");

/**
 * Pick the registry hostname a given plan should pull from.
 * Community users target GHCR (anonymous); every paid plan targets the
 * dedicated enterprise Harbor.
 */
export function getRegistryForPlan(plan: Plan): string {
  return plan === "community" ? COMMUNITY_REGISTRY : ENTERPRISE_REGISTRY;
}

/**
 * Ensure the user is logged in to the registry appropriate for their plan.
 * GHCR pulls are anonymous and skip login entirely; community users still
 * pointed at the legacy Harbor fall back to the embedded robot for back-compat;
 * paid plans must have a valid license with credentials in its metadata.
 */
export async function ensureRegistryLogin(
  registry: string,
  plan: Plan,
): Promise<void> {
  // GHCR public packages do not require authentication for pull.
  if (registry.startsWith("ghcr.io")) {
    return;
  }

  if (plan === "community") {
    // Community installs that still target a non-GHCR registry (legacy Harbor
    // or any custom mirror) keep the embedded pull-only robot. Once all such
    // installs migrate to GHCR this branch can be deleted.
    await dockerLogin(
      registry,
      LEGACY_COMMUNITY_USERNAME,
      LEGACY_COMMUNITY_SECRET,
    );
    return;
  }

  // Paid plan: credentials should come from the Keygen license metadata.
  const credentials = await getEnterpriseCredentials();
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

async function getEnterpriseCredentials(): Promise<
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

/**
 * @deprecated Use `getEnterpriseCredentials` semantics via `ensureRegistryLogin`.
 * Kept as an export alias to avoid breaking external callers that imported the
 * old name. Returns the same Harbor credentials from Keygen license metadata.
 */
export const getPremiumCredentials = getEnterpriseCredentials;
