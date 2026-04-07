// src/lib/keygen.ts
// Wrapper around the Keygen.sh REST API for license validation
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, hostname, networkInterfaces, platform } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

export const KEYGEN_ACCOUNT = "industream-com";
export const KEYGEN_PRODUCT = "5d42435b-bd24-46f0-b577-9050e6daf477";
const KEYGEN_API = "https://api.keygen.sh/v1";

const LICENSE_DIR = join(homedir(), ".industream");
const LICENSE_KEY_FILE = join(LICENSE_DIR, "license.key");
const LICENSE_CACHE_FILE = join(LICENSE_DIR, "license-cache.json");

export interface KeygenLicenseAttributes {
  name: string | null;
  key: string;
  expiry: string | null;
  status: string;
  uses: number;
  maxMachines: number | null;
  metadata: Record<string, unknown>;
  created: string;
  updated: string;
}

export interface KeygenValidationMeta {
  ts: string;
  valid: boolean;
  detail: string;
  code: string;
  scope: { product: string; policy: string; fingerprint: string };
}

export interface KeygenIncluded {
  id: string;
  type: string;
  attributes: Record<string, unknown> & { code?: string; name?: string };
}

export interface KeygenValidationResponse {
  data: {
    id: string;
    type: "licenses";
    attributes: KeygenLicenseAttributes;
    relationships?: Record<string, unknown>;
  } | null;
  included?: KeygenIncluded[];
  meta: KeygenValidationMeta;
  errors?: Array<{ title: string; detail: string }>;
}

export interface CachedLicense {
  key: string;
  fingerprint: string;
  validatedAt: string;
  response: KeygenValidationResponse;
  /** Codes of entitlements active for this license */
  entitlements: string[];
  /** Plan name from policy metadata */
  plan: string;
  /** Customer name from license attributes */
  customer: string | null;
}

/**
 * Generate a stable machine fingerprint from MAC address.
 * Falls back to hostname if no MAC is available.
 */
export function getMachineFingerprint(): string {
  const interfaces = networkInterfaces();
  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs || name === "lo" || name.startsWith("docker")) continue;
    for (const addr of addrs) {
      if (addr.mac && addr.mac !== "00:00:00:00:00:00") {
        return addr.mac;
      }
    }
  }
  // Fallback: hash hostname
  return createHash("sha256")
    .update(homedir())
    .digest("hex")
    .slice(0, 17)
    .replace(/(.{2})/g, "$1:")
    .slice(0, -1);
}

/**
 * Validate a license key against the Keygen API (online).
 */
export async function validateKeyOnline(
  key: string,
  fingerprint: string = getMachineFingerprint(),
): Promise<KeygenValidationResponse> {
  const url = `${KEYGEN_API}/accounts/${KEYGEN_ACCOUNT}/licenses/actions/validate-key`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/vnd.api+json",
      Accept: "application/vnd.api+json",
    },
    body: JSON.stringify({
      meta: {
        key,
        scope: {
          product: KEYGEN_PRODUCT,
          fingerprint,
        },
      },
    }),
    signal: AbortSignal.timeout(10000),
  });

  return (await response.json()) as KeygenValidationResponse;
}

/**
 * Fetch the policy details for a license — including its metadata (plan name).
 */
export async function fetchLicensePolicy(
  licenseId: string,
  key: string,
): Promise<{ name: string; plan: string } | null> {
  const url = `${KEYGEN_API}/accounts/${KEYGEN_ACCOUNT}/licenses/${licenseId}/policy`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.api+json",
        Authorization: `License ${key}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as {
      data: {
        attributes: {
          name: string;
          metadata?: { plan?: string };
        };
      };
    };
    return {
      name: body.data.attributes.name,
      plan: body.data.attributes.metadata?.plan ?? "community",
    };
  } catch {
    return null;
  }
}

/**
 * Fetch the entitlements attached to a license (via its policy).
 * Returns the list of entitlement codes (e.g. ["MODULE_OPC_UA", "MODULE_S7"]).
 */
export async function fetchLicenseEntitlements(
  licenseId: string,
  key: string,
): Promise<string[]> {
  const url = `${KEYGEN_API}/accounts/${KEYGEN_ACCOUNT}/licenses/${licenseId}/entitlements`;
  try {
    const response = await fetch(url, {
      headers: {
        Accept: "application/vnd.api+json",
        Authorization: `License ${key}`,
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return [];
    const data = (await response.json()) as {
      data: Array<{ attributes: { code: string } }>;
    };
    return data.data.map((e) => e.attributes.code);
  } catch {
    return [];
  }
}


/**
 * Activate a license: validate it online and cache the result locally.
 * Automatically registers the current machine if the license requires it.
 */
export async function activateLicense(key: string): Promise<KeygenValidationResponse> {
  const fingerprint = getMachineFingerprint();
  let response = await validateKeyOnline(key, fingerprint);

  // License needs a machine registration — do it, then re-validate
  const needsMachine =
    response.meta.code === "NO_MACHINE" || response.meta.code === "NO_MACHINES";
  if (needsMachine && response.data) {
    const activationResult = await activateMachine(
      key,
      response.data.id,
      fingerprint,
    );
    if (!activationResult.ok) {
      return {
        data: response.data,
        meta: {
          ts: new Date().toISOString(),
          valid: false,
          detail: `Machine registration failed: ${activationResult.error}`,
          code: "ACTIVATION_FAILED",
          scope: { product: KEYGEN_PRODUCT, policy: "", fingerprint },
        },
      };
    }
    response = await validateKeyOnline(key, fingerprint);
  }

  if (!response.meta.valid) {
    return response;
  }

  // Save key + fetch entitlements + policy + cache the response
  await mkdir(LICENSE_DIR, { recursive: true });
  await writeFile(LICENSE_KEY_FILE, key, "utf-8");

  const [entitlements, policy] = response.data
    ? await Promise.all([
        fetchLicenseEntitlements(response.data.id, key),
        fetchLicensePolicy(response.data.id, key),
      ])
    : [[], null];

  const cache: CachedLicense = {
    key,
    fingerprint,
    validatedAt: new Date().toISOString(),
    response,
    entitlements,
    plan: policy?.plan ?? "community",
    customer: (response.data?.attributes.name as string) ?? null,
  };
  await writeFile(LICENSE_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");

  return response;
}

/**
 * Register a machine with a license (required for strict licenses).
 * Returns { ok: true } on success or { ok: false, error: "..." } on failure.
 */
async function activateMachine(
  key: string,
  licenseId: string,
  fingerprint: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const url = `${KEYGEN_API}/accounts/${KEYGEN_ACCOUNT}/machines`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
        Authorization: `License ${key}`,
      },
      body: JSON.stringify({
        data: {
          type: "machines",
          attributes: {
            fingerprint,
            name: hostname(),
            platform: platform(),
          },
          relationships: {
            license: { data: { type: "licenses", id: licenseId } },
          },
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) return { ok: true };

    const body = (await response.json()) as {
      errors?: Array<{ title: string; detail: string }>;
    };
    const errorMsg =
      body.errors?.[0]?.detail ?? `HTTP ${response.status}`;
    return { ok: false, error: errorMsg };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * Load the cached license from disk (offline mode).
 */
export async function loadCachedLicense(): Promise<CachedLicense | null> {
  if (!existsSync(LICENSE_CACHE_FILE)) return null;
  try {
    const content = await readFile(LICENSE_CACHE_FILE, "utf-8");
    return JSON.parse(content) as CachedLicense;
  } catch {
    return null;
  }
}

/**
 * Load just the saved license key (without cache).
 */
export async function loadLicenseKey(): Promise<string | null> {
  if (!existsSync(LICENSE_KEY_FILE)) return null;
  try {
    return (await readFile(LICENSE_KEY_FILE, "utf-8")).trim();
  } catch {
    return null;
  }
}

/**
 * Validate a license: try online first, fall back to cached response.
 */
export async function validateLicenseWithKeygen(
  key?: string,
): Promise<{
  valid: boolean;
  online: boolean;
  response: KeygenValidationResponse | null;
  cache: CachedLicense | null;
}> {
  const licenseKey = key ?? (await loadLicenseKey());
  if (!licenseKey) {
    return { valid: false, online: false, response: null, cache: null };
  }

  // Try online validation
  try {
    const fingerprint = getMachineFingerprint();
    const response = await validateKeyOnline(licenseKey, fingerprint);

    // Cache successful validation
    if (response.meta.valid) {
      await mkdir(LICENSE_DIR, { recursive: true });
      const [entitlements, policy] = response.data
        ? await Promise.all([
            fetchLicenseEntitlements(response.data.id, licenseKey),
            fetchLicensePolicy(response.data.id, licenseKey),
          ])
        : [[], null];
      const cache: CachedLicense = {
        key: licenseKey,
        fingerprint,
        validatedAt: new Date().toISOString(),
        response,
        entitlements,
        plan: policy?.plan ?? "community",
        customer: (response.data?.attributes.name as string) ?? null,
      };
      await writeFile(LICENSE_CACHE_FILE, JSON.stringify(cache, null, 2), "utf-8");
      return { valid: true, online: true, response, cache };
    }
    return { valid: false, online: true, response, cache: null };
  } catch {
    // Offline: fall back to cache
    const cache = await loadCachedLicense();
    if (!cache) {
      return { valid: false, online: false, response: null, cache: null };
    }
    // Cache valid for 30 days
    const cacheAge = Date.now() - new Date(cache.validatedAt).getTime();
    const maxAge = 30 * 24 * 60 * 60 * 1000;
    if (cacheAge > maxAge) {
      return { valid: false, online: false, response: cache.response, cache };
    }
    return { valid: true, online: false, response: cache.response, cache };
  }
}
