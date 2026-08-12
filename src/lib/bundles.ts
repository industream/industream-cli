// src/lib/bundles.ts
// Release-bundle discovery + selection for the unified deploy tree.
//
// `deploy.sh` sources the full-ref ${X_IMAGE} vars from ONE
// releases/bundle-platform-<version>/ directory. It auto-selects when exactly one
// exists and hard-fails with "multiple bundles in releases/ — pass --bundle" as
// soon as there are two (a shipped render + a Forge download, an older version
// left behind, a named `forge-bundle.sh import`). `industream install` used to
// render a hardcoded version and never pass --bundle, so it walked straight into
// that abort with no way out. Resolution lives here: pure, testable, shared by
// install (wizard) and doctor (preflight).
import { readdir } from "node:fs/promises";
import { join } from "node:path";

export const BUNDLE_DIR_PREFIX = "bundle-platform-";
/** Rendered by install when the tree carries no bundle at all. */
export const DEFAULT_BUNDLE_VERSION = "1.0.1";

export interface BundleInfo {
  /** Version label — exactly what `deploy.sh --bundle` expects. */
  version: string;
  dirName: string;
  /** Forge bundles are downloaded artefacts: render-bundles.sh cannot produce them. */
  source: "local" | "forge";
}

/** `bundle-platform-1.0.1` → BundleInfo. Null for anything else. */
export function parseBundleDirName(name: string): BundleInfo | null {
  if (!name.startsWith(BUNDLE_DIR_PREFIX)) return null;
  const version = name.slice(BUNDLE_DIR_PREFIX.length);
  if (version.length === 0) return null;
  return { version, dirName: name, source: version.startsWith("forge-") ? "forge" : "local" };
}

/** Numeric-aware descending compare so 1.0.10 sorts above 1.0.9. */
function compareVersions(a: string, b: string): number {
  const parts = (v: string): (number | string)[] =>
    v.split(/[.\-+]/).map((p) => (/^\d+$/.test(p) ? Number(p) : p));
  const [pa, pb] = [parts(a), parts(b)];
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const [x, y] = [pa[i], pb[i]];
    if (x === y) continue;
    if (x === undefined) return 1;
    if (y === undefined) return -1;
    if (typeof x === "number" && typeof y === "number") return y - x;
    return String(y).localeCompare(String(x));
  }
  return 0;
}

/** Local renders first (the normal install path), then newest version first. */
export function sortBundles(bundles: BundleInfo[]): BundleInfo[] {
  return [...bundles].sort((a, b) =>
    a.source !== b.source
      ? a.source === "local"
        ? -1
        : 1
      : compareVersions(a.version, b.version),
  );
}

/** Bundles present under `<unified>/releases/`. Empty when the tree has none. */
export async function listBundles(unified: string): Promise<BundleInfo[]> {
  let entries;
  try {
    entries = await readdir(join(unified, "releases"), { withFileTypes: true });
  } catch {
    return []; // no tree / no releases dir yet — a fresh clone renders its own
  }
  const found = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => parseBundleDirName(entry.name))
    .filter((bundle): bundle is BundleInfo => bundle !== null);
  return sortBundles(found);
}

export type BundleResolution =
  | {
      ok: true;
      /** Pass to `deploy.sh --bundle` — always explicit, never left to auto-select. */
      version: string;
      /** Version to render first, or null when the bundle is already on disk. */
      render: string | null;
    }
  | { ok: false; error: string; available: BundleInfo[] };

function ambiguous(bundles: BundleInfo[]): BundleResolution {
  // Sort here too: the caller may pass raw readdir order, and the message (and
  // the picker built from `available`) must always list the newest first.
  const available = sortBundles(bundles);
  const versions = available.map((b) => b.version);
  return {
    ok: false,
    available,
    error:
      `${versions.length} release bundles in releases/ (${versions.join(", ")}) — ` +
      `pick one with --bundle <version>, or delete the ones you don't deploy.`,
  };
}

/**
 * Decide which bundle a deploy should use, and whether it must be rendered first.
 *
 * An explicit request always wins and is taken as-is when present on disk: it may
 * be a Forge download or a hand-imported bundle, and re-rendering would overwrite
 * it. Without a request we reuse the single existing bundle rather than adding a
 * second one — that silent second render is what broke `industream install`.
 */
export function resolveBundle(bundles: BundleInfo[], requested?: string): BundleResolution {
  const wanted = requested?.trim();
  if (wanted) {
    const match = bundles.find((bundle) => bundle.version === wanted);
    if (match) return { ok: true, version: match.version, render: null };
    if (wanted.startsWith("forge-"))
      return {
        ok: false,
        available: bundles,
        error:
          `no bundle at releases/${BUNDLE_DIR_PREFIX}${wanted} — Forge bundles are ` +
          `downloaded, not rendered: run scripts/forge-bundle.sh fetch <exportKey> <version>.`,
      };
    return { ok: true, version: wanted, render: wanted };
  }
  if (bundles.length === 0)
    return { ok: true, version: DEFAULT_BUNDLE_VERSION, render: DEFAULT_BUNDLE_VERSION };
  if (bundles.length > 1) return ambiguous(bundles);
  const only = bundles[0];
  return { ok: true, version: only.version, render: only.source === "local" ? only.version : null };
}
