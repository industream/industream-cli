import { describe, it, expect } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildDeployArgs, unifiedDir, resolveParamsFromEnv } from "./unified-deploy.js";

describe("buildDeployArgs", () => {
  it("swarm/ce → --stack industream-<env>, no bundle/groups", () => {
    expect(buildDeployArgs({ runtime: "swarm", edition: "ce", env: "prod" })).toEqual([
      "--runtime", "swarm", "--edition", "ce", "--env", "prod", "--stack", "industream-prod",
    ]);
  });

  it("compose/ee with bundle + groups → --project + flags in order", () => {
    expect(
      buildDeployArgs({ runtime: "compose", edition: "ee", env: "dev", bundle: "1.0.1", groups: "core data" }),
    ).toEqual([
      "--runtime", "compose", "--edition", "ee", "--env", "dev",
      "--bundle", "1.0.1", "--groups", "core data", "--project", "dev",
    ]);
  });

  it("airgap → appends --airgap so deploy.sh skips the pre-pull and strips digests", () => {
    const args = buildDeployArgs({ runtime: "swarm", edition: "ee", env: "prod", airgap: true });
    expect(args).toContain("--airgap");
  });

  it("omits --airgap when not requested", () => {
    expect(buildDeployArgs({ runtime: "swarm", edition: "ee", env: "prod" })).not.toContain("--airgap");
  });

  it("omits --bundle/--groups when absent", () => {
    const args = buildDeployArgs({ runtime: "compose", edition: "ce", env: "staging" });
    expect(args).not.toContain("--bundle");
    expect(args).not.toContain("--groups");
    expect(args.slice(-2)).toEqual(["--project", "staging"]);
  });
});

describe("unifiedDir", () => {
  it("appends /unified to an absolute platform dir", () => {
    expect(unifiedDir("/opt/industream-platform")).toBe("/opt/industream-platform/unified");
  });
});

describe("resolveParamsFromEnv", () => {
  const NO_ENV = "/nonexistent-platform-dir-xyz";

  it("CLI overrides win and apply over the (missing) .env defaults", async () => {
    const p = await resolveParamsFromEnv(NO_ENV, "dev", { runtime: "compose", edition: "ee", bundle: "1.0.1" });
    // EE with no persisted GROUPS falls back to the full EE set so a redeploy
    // never silently drops workers-premium/timescale (see EE_DEFAULT_GROUPS).
    expect(p).toEqual({
      runtime: "compose", edition: "ee", env: "dev", bundle: "1.0.1",
      groups: "core flowmaker datacatalog workers workers-premium data monitoring timescale",
      airgap: false,
    });
  });

  it("CE without a persisted GROUPS keeps deploy.sh's own default", async () => {
    const p = await resolveParamsFromEnv(NO_ENV, "dev", { runtime: "compose", edition: "ce" });
    expect(p.groups).toBeUndefined();
  });

  it("--airgap override applies without a .env", async () => {
    const p = await resolveParamsFromEnv(NO_ENV, "prod", { airgap: true });
    expect(p.airgap).toBe(true);
  });

  it("reads AIRGAP=true from the platform .env and lets the flag win", async () => {
    const dir = await mkdtemp(join(tmpdir(), "cli-airgap-"));
    await writeFile(join(dir, ".env"), "RUNTIME=swarm\nEDITION=ee\nBUNDLE=1.0.1\nAIRGAP=true\n");
    const fromEnv = await resolveParamsFromEnv(dir, "prod");
    expect(fromEnv.airgap).toBe(true);
    expect(fromEnv.bundle).toBe("1.0.1");
    const forcedOff = await resolveParamsFromEnv(dir, "prod", { airgap: false });
    expect(forcedOff.airgap).toBe(false);
  });

  it("defaults to swarm/ce when no .env and no overrides", async () => {
    const p = await resolveParamsFromEnv(NO_ENV, "prod");
    expect(p.runtime).toBe("swarm");
    expect(p.edition).toBe("ce");
    expect(p.bundle).toBeUndefined();
  });
});
