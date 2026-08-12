import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_BUNDLE_VERSION,
  listBundles,
  parseBundleDirName,
  resolveBundle,
  sortBundles,
} from "./bundles.js";
import type { BundleInfo } from "./bundles.js";

const local = (version: string): BundleInfo => ({
  version,
  dirName: `bundle-platform-${version}`,
  source: "local",
});
const forge = (version: string): BundleInfo => ({
  version,
  dirName: `bundle-platform-${version}`,
  source: "forge",
});

describe("parseBundleDirName", () => {
  it("extracts the version deploy.sh --bundle expects", () => {
    expect(parseBundleDirName("bundle-platform-1.0.1")).toEqual(local("1.0.1"));
  });

  it("flags Forge-materialized bundles as a distinct source", () => {
    expect(parseBundleDirName("bundle-platform-forge-flowmaker-community-2.1.5")).toEqual(
      forge("forge-flowmaker-community-2.1.5"),
    );
  });

  it("rejects unrelated directories and a bare prefix", () => {
    expect(parseBundleDirName("releases")).toBeNull();
    expect(parseBundleDirName("bundle-platform-")).toBeNull();
  });
});

describe("sortBundles", () => {
  it("puts local renders before Forge downloads", () => {
    const sorted = sortBundles([forge("forge-ironstream-1.0-beta"), local("1.0.1")]);
    expect(sorted.map((b) => b.version)).toEqual(["1.0.1", "forge-ironstream-1.0-beta"]);
  });

  it("orders versions numerically, newest first (not lexicographically)", () => {
    const sorted = sortBundles([local("1.0.9"), local("1.0.10"), local("1.1.0")]);
    expect(sorted.map((b) => b.version)).toEqual(["1.1.0", "1.0.10", "1.0.9"]);
  });
});

describe("listBundles", () => {
  let unified: string;

  beforeAll(async () => {
    unified = await mkdtemp(join(tmpdir(), "industream-bundles-"));
    await mkdir(join(unified, "releases", "bundle-platform-1.0.1"), { recursive: true });
    await mkdir(join(unified, "releases", "bundle-platform-forge-ironstream-1.0-beta"), {
      recursive: true,
    });
    await mkdir(join(unified, "releases", "portainer"), { recursive: true });
    await writeFile(join(unified, "releases", "bundle-platform-note.txt"), "not a dir");
  });

  afterAll(async () => {
    await rm(unified, { recursive: true, force: true });
  });

  it("lists only bundle directories, sorted", async () => {
    const found = await listBundles(unified);
    expect(found.map((b) => b.version)).toEqual(["1.0.1", "forge-ironstream-1.0-beta"]);
  });

  it("returns [] when the tree has no releases/ directory", async () => {
    expect(await listBundles(join(unified, "nope"))).toEqual([]);
  });
});

describe("resolveBundle", () => {
  it("renders the default version when the tree carries no bundle", () => {
    expect(resolveBundle([])).toEqual({
      ok: true,
      version: DEFAULT_BUNDLE_VERSION,
      render: DEFAULT_BUNDLE_VERSION,
    });
  });

  it("reuses the single existing bundle instead of rendering a second one", () => {
    // The install bug: rendering a hardcoded 1.0.1 next to a shipped 1.0.2 made
    // deploy.sh abort with "multiple bundles in releases/ — pass --bundle".
    expect(resolveBundle([local("1.0.2")])).toEqual({
      ok: true,
      version: "1.0.2",
      render: "1.0.2",
    });
  });

  it("never re-renders a lone Forge bundle (render-bundles.sh cannot produce it)", () => {
    expect(resolveBundle([forge("forge-flowmaker-community-2.1.5")])).toEqual({
      ok: true,
      version: "forge-flowmaker-community-2.1.5",
      render: null,
    });
  });

  it("fails with an actionable message when several bundles are present", () => {
    const result = resolveBundle([local("1.0.1"), local("1.0.2")]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an ambiguous resolution");
    expect(result.available.map((b) => b.version)).toEqual(["1.0.2", "1.0.1"]);
    expect(result.error).toContain("--bundle");
    expect(result.error).toContain("1.0.2");
  });

  it("honours an explicit request and leaves the on-disk bundle untouched", () => {
    expect(resolveBundle([local("1.0.1"), local("1.0.2")], "1.0.1")).toEqual({
      ok: true,
      version: "1.0.1",
      render: null,
    });
  });

  it("renders an explicitly requested version that is not on disk yet", () => {
    expect(resolveBundle([local("1.0.1")], "2.0.0")).toEqual({
      ok: true,
      version: "2.0.0",
      render: "2.0.0",
    });
  });

  it("refuses to invent a missing Forge bundle", () => {
    const result = resolveBundle([], "forge-ironstream-1.0-beta");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a failed resolution");
    expect(result.error).toContain("forge-bundle.sh");
  });

  it("ignores surrounding whitespace on the requested version", () => {
    expect(resolveBundle([local("1.0.1")], "  1.0.1  ")).toEqual({
      ok: true,
      version: "1.0.1",
      render: null,
    });
  });
});
