// src/lib/swarm-repo.test.ts
import { describe, it, expect } from "vitest";
import { resolvePlatformDir, parseEnvFile, planTreeUpdate } from "./swarm-repo.js";

describe("swarm-repo", () => {
  it("resolves ~ in platform dir", () => {
    const resolved = resolvePlatformDir("~/industream-platform");
    expect(resolved).not.toContain("~");
    expect(resolved).toContain("industream-platform");
  });

  it("parses .env file content", () => {
    const content = `
DOCKER_REGISTRY=842775dh.c1.gra9.container-registry.ovh.net
UIFUSION_VERSION=1.0.8
# Comment
FLOWMAKER_CORE_VERSION=2.0.2

KEYCLOAK_VERSION=26.1.0
`;
    const env = parseEnvFile(content);
    expect(env.DOCKER_REGISTRY).toBe("842775dh.c1.gra9.container-registry.ovh.net");
    expect(env.UIFUSION_VERSION).toBe("1.0.8");
    expect(env.FLOWMAKER_CORE_VERSION).toBe("2.0.2");
    expect(env.KEYCLOAK_VERSION).toBe("26.1.0");
  });
});

describe("planTreeUpdate", () => {
  it("resets when the tree sits on the default branch", () => {
    expect(planTreeUpdate("main", "origin/main")).toEqual({ action: "reset", reason: "main" });
  });

  it("skips a feature branch instead of discarding it", () => {
    // A hard reset to origin/HEAD would delete whatever that branch adds to the
    // tree (e.g. base/ironstream.yml), and the next deploy would prune the
    // services those files define.
    const plan = planTreeUpdate("feature/unified-forge-bundle", "origin/main");
    expect(plan.action).toBe("skip");
    expect(plan.reason).toContain("feature/unified-forge-bundle");
  });

  it("skips a detached HEAD (no branch intent to honour)", () => {
    expect(planTreeUpdate("HEAD", "origin/main").action).toBe("skip");
  });

  it("honours a non-main default branch", () => {
    expect(planTreeUpdate("develop", "origin/develop").action).toBe("reset");
    expect(planTreeUpdate("main", "origin/develop").action).toBe("skip");
  });

  it("tolerates a bare default ref and surrounding whitespace", () => {
    expect(planTreeUpdate(" main\n", "main").action).toBe("reset");
  });

  it("protects against a stale origin/HEAD symref", () => {
    // Observed on the swarm test VM: the clone's refs/remotes/origin/HEAD still
    // pointed at a long-gone feature branch, so the old unconditional reset
    // would have rewritten the tree to `feat/hub-admin-tiles` — not even main.
    expect(planTreeUpdate("main", "origin/feat/hub-admin-tiles").action).toBe("skip");
    expect(planTreeUpdate("feature/unified-forge-bundle", "origin/feat/hub-admin-tiles").action)
      .toBe("skip");
  });
});
