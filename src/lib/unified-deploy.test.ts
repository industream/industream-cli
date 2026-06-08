import { describe, it, expect } from "vitest";
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
    expect(p).toEqual({ runtime: "compose", edition: "ee", env: "dev", bundle: "1.0.1", groups: undefined });
  });

  it("defaults to swarm/ce when no .env and no overrides", async () => {
    const p = await resolveParamsFromEnv(NO_ENV, "prod");
    expect(p.runtime).toBe("swarm");
    expect(p.edition).toBe("ce");
    expect(p.bundle).toBeUndefined();
  });
});
