// src/commands/__tests__/deploy.test.ts
//
// Snapshot tests that capture the exact sequence of execa calls produced by
// runDeploy. Acts as a regression net before the Phase 1 refactor of the
// deploy command.
//
// We mock every external boundary (execa, loadConfig, registry login, license
// flags, swarm-repo helpers) so the tests stay pure and deterministic.
import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — declared before the module under test is imported.
// ---------------------------------------------------------------------------
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("../../lib/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../lib/swarm-repo.js", () => ({
  resolvePlatformDir: (path: string): string =>
    path.replace(/^~/, "/home/test"),
  isPlatformInstalled: vi.fn(),
  loadEnvFile: vi.fn(),
}));

vi.mock("../../lib/stack-filter.js", () => ({
  getDeployFlags: vi.fn(),
}));

vi.mock("../../lib/registry-login.js", () => ({
  ensureRegistryLogin: vi.fn(),
  getRegistryForPlan: (plan: string): string =>
    plan === "community"
      ? "ghcr.io/industream"
      : "39t88114.c1.gra9.container-registry.ovh.net",
  COMMUNITY_REGISTRY: "ghcr.io/industream",
  ENTERPRISE_REGISTRY: "39t88114.c1.gra9.container-registry.ovh.net",
}));

import { execa } from "execa";
import { loadConfig } from "../../lib/config.js";
import { isPlatformInstalled, loadEnvFile } from "../../lib/swarm-repo.js";
import { getDeployFlags } from "../../lib/stack-filter.js";
import { ensureRegistryLogin } from "../../lib/registry-login.js";
import { runDeploy } from "../deploy.js";

const mockedExeca = vi.mocked(execa);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedIsInstalled = vi.mocked(isPlatformInstalled);
const mockedLoadEnv = vi.mocked(loadEnvFile);
const mockedGetFlags = vi.mocked(getDeployFlags);
const mockedEnsureLogin = vi.mocked(ensureRegistryLogin);

/** Helper — returns the execa mock.calls reduced to [command, args] tuples. */
function callSignatures(): Array<[string, unknown]> {
  return mockedExeca.mock.calls.map(
    (call) => [call[0] as string, call[1]] as [string, unknown],
  );
}

describe("runDeploy — execa call sequence snapshots", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedLoadConfig.mockResolvedValue({
      platformDir: "~/industream-platform",
      defaultEnvironment: "prod",
    });
    mockedIsInstalled.mockResolvedValue(true);
    mockedEnsureLogin.mockResolvedValue(undefined);
    mockedLoadEnv.mockResolvedValue({
      TLS_MODE: "selfsigned",
      INDUSTREAM_DOMAIN: "industream.test",
    });
    mockedGetFlags.mockResolvedValue({
      plan: "community",
      customer: null,
      licensedModuleCount: 5,
      totalModuleCount: 10,
      excludedServices: [],
      entitlements: [],
      online: false,
      valid: false,
    });
    // execa returns an empty stdout for any call in these tests.
    mockedExeca.mockResolvedValue({ stdout: "", stderr: "" } as never);
  });

  it("community plan, prod env, no demo — baseline deploy", async () => {
    await runDeploy("prod", { withDemo: false });

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "/home/test/industream-platform/scripts/generate/generate-certs.sh",
          [],
        ],
        [
          "/home/test/industream-platform/scripts/generate/generate-uifusion-config.sh",
          [
            "--force",
            "--env",
            "prod",
          ],
        ],
        [
          "/home/test/industream-platform/scripts/setup/create-secrets.sh",
          [
            "--env",
            "prod",
          ],
        ],
        [
          "/home/test/industream-platform/scripts/deploy-swarm.sh",
          [
            "--env",
            "prod",
            "--community",
            "--skip-memory-check",
          ],
        ],
      ]
    `);
  });

  it("community plan, dev env, with demo flag", async () => {
    await runDeploy("dev", { withDemo: true });

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "/home/test/industream-platform/scripts/generate/generate-certs.sh",
          [],
        ],
        [
          "/home/test/industream-platform/scripts/generate/generate-uifusion-config.sh",
          [
            "--force",
            "--env",
            "dev",
          ],
        ],
        [
          "/home/test/industream-platform/scripts/setup/create-secrets.sh",
          [
            "--env",
            "dev",
          ],
        ],
        [
          "/home/test/industream-platform/scripts/deploy-swarm.sh",
          [
            "--env",
            "dev",
            "--with-demo",
            "--community",
            "--skip-memory-check",
          ],
        ],
      ]
    `);
  });

  it("enterprise plan with excluded services passes --exclude", async () => {
    mockedGetFlags.mockResolvedValue({
      plan: "enterprise",
      customer: "Acme Corp",
      licensedModuleCount: 8,
      totalModuleCount: 10,
      excludedServices: ["worker-opc-ua-client", "backup-monitor"],
      entitlements: ["PRODUCT_DATACATALOG"],
      online: true,
      valid: true,
    });

    await runDeploy("prod", { withDemo: false });

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "/home/test/industream-platform/scripts/generate/generate-certs.sh",
          [],
        ],
        [
          "/home/test/industream-platform/scripts/generate/generate-uifusion-config.sh",
          [
            "--force",
            "--env",
            "prod",
          ],
        ],
        [
          "/home/test/industream-platform/scripts/setup/create-secrets.sh",
          [
            "--env",
            "prod",
          ],
        ],
        [
          "/home/test/industream-platform/scripts/deploy-swarm.sh",
          [
            "--env",
            "prod",
            "--exclude",
            "worker-opc-ua-client,backup-monitor",
            "--skip-memory-check",
          ],
        ],
      ]
    `);
  });

  it("tls mode != selfsigned skips cert regeneration", async () => {
    mockedLoadEnv.mockResolvedValue({
      TLS_MODE: "letsencrypt",
      INDUSTREAM_DOMAIN: "industream.example.com",
    });

    await runDeploy("staging", { withDemo: false });

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "/home/test/industream-platform/scripts/generate/generate-uifusion-config.sh",
          [
            "--force",
            "--env",
            "staging",
          ],
        ],
        [
          "/home/test/industream-platform/scripts/setup/create-secrets.sh",
          [
            "--env",
            "staging",
          ],
        ],
        [
          "/home/test/industream-platform/scripts/deploy-swarm.sh",
          [
            "--env",
            "staging",
            "--community",
            "--skip-memory-check",
          ],
        ],
      ]
    `);
  });

  it("pro plan — no --community flag, no excluded services", async () => {
    mockedGetFlags.mockResolvedValue({
      plan: "pro",
      customer: "Pro Corp",
      licensedModuleCount: 10,
      totalModuleCount: 10,
      excludedServices: [],
      entitlements: ["PRODUCT_DATACATALOG"],
      online: true,
      valid: true,
    });

    await runDeploy("prod", { withDemo: false });

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "/home/test/industream-platform/scripts/generate/generate-certs.sh",
          [],
        ],
        [
          "/home/test/industream-platform/scripts/generate/generate-uifusion-config.sh",
          [
            "--force",
            "--env",
            "prod",
          ],
        ],
        [
          "/home/test/industream-platform/scripts/setup/create-secrets.sh",
          [
            "--env",
            "prod",
          ],
        ],
        [
          "/home/test/industream-platform/scripts/deploy-swarm.sh",
          [
            "--env",
            "prod",
            "--skip-memory-check",
          ],
        ],
      ]
    `);
  });

  it("community plan resolves to GHCR (no docker login required)", async () => {
    await runDeploy("prod", { withDemo: false });

    // The runtime still calls ensureRegistryLogin, but with the GHCR host —
    // ensureRegistryLogin itself is responsible for skipping the docker login.
    expect(mockedEnsureLogin).toHaveBeenCalledTimes(1);
    expect(mockedEnsureLogin).toHaveBeenCalledWith(
      "ghcr.io/industream",
      "community",
    );

    // Verify that no docker login execa call was emitted for community.
    const dockerLoginCalls = mockedExeca.mock.calls.filter((call) => {
      const args = call[1] as string[] | undefined;
      return Array.isArray(args) && args.includes("login");
    });
    expect(dockerLoginCalls).toHaveLength(0);
  });

  it("enterprise plan targets the dedicated enterprise Harbor", async () => {
    mockedGetFlags.mockResolvedValue({
      plan: "enterprise",
      customer: "Acme Corp",
      licensedModuleCount: 10,
      totalModuleCount: 10,
      excludedServices: [],
      entitlements: ["PRODUCT_DATACATALOG"],
      online: true,
      valid: true,
    });

    await runDeploy("prod", { withDemo: false });

    expect(mockedEnsureLogin).toHaveBeenCalledTimes(1);
    expect(mockedEnsureLogin).toHaveBeenCalledWith(
      "39t88114.c1.gra9.container-registry.ovh.net",
      "enterprise",
    );
  });
});
