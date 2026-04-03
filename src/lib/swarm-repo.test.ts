// src/lib/swarm-repo.test.ts
import { describe, it, expect } from "vitest";
import { resolvePlatformDir, parseEnvFile } from "./swarm-repo.js";

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
