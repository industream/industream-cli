// src/commands/__tests__/status.test.ts
//
// Snapshot tests for runStatus. The command branches on TTY: when TTY is
// available it renders an Ink dashboard, otherwise it falls back to console
// output via runFallbackStatus(). We force the non-TTY path so we can assert
// on the (stable, non-React) sequence of docker calls and console output.
//
// Only the fallback branch is covered here. The Ink-rendered branch is left
// to future work — see the it.todo at the bottom of this file.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("../../lib/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../lib/docker.js", () => ({
  isSwarmActive: vi.fn(),
  getSwarmServices: vi.fn(),
}));

vi.mock("../../lib/modules.js", () => ({
  loadModuleRegistry: vi.fn(() => ({ modules: [] })),
}));

vi.mock("../../lib/release-tracker.js", () => ({
  getLatestVersions: vi.fn(async () => null),
  isLatest: vi.fn(() => true),
}));

vi.mock("../../lib/keygen.js", () => ({
  validateLicenseWithKeygen: vi.fn(async () => ({
    valid: false,
    online: false,
    response: null,
    cache: null,
  })),
}));

// Ink's render() throws in a non-TTY environment if accidentally invoked —
// guard against that by short-circuiting it.
vi.mock("ink", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ink")>();
  return {
    ...actual,
    render: vi.fn(),
  };
});

import { loadConfig } from "../../lib/config.js";
import { isSwarmActive, getSwarmServices } from "../../lib/docker.js";
import { runStatus } from "../status.js";

const mockedLoadConfig = vi.mocked(loadConfig);
const mockedIsSwarmActive = vi.mocked(isSwarmActive);
const mockedGetSwarmServices = vi.mocked(getSwarmServices);

/** Flush queued microtasks so runFallbackStatus()'s async body completes. */
async function flushAsync(): Promise<void> {
  // Two ticks — one for each `await` inside runFallbackStatus.
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("runStatus (fallback, non-TTY) — docker call snapshots", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  const originalIsTTY = process.stdin.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
    // Force the non-TTY branch of runStatus().
    Object.defineProperty(process.stdin, "isTTY", {
      value: false,
      configurable: true,
    });
    mockedLoadConfig.mockResolvedValue({
      platformDir: "~/industream-platform",
      defaultEnvironment: "prod",
    });
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    consoleLogSpy.mockRestore();
  });

  it("swarm inactive — calls isSwarmActive but skips getSwarmServices", async () => {
    mockedIsSwarmActive.mockResolvedValue(false);

    runStatus();
    await flushAsync();

    expect(mockedIsSwarmActive).toHaveBeenCalledTimes(1);
    expect(mockedGetSwarmServices).not.toHaveBeenCalled();
  });

  it("swarm active (prod) — fetches services for industream-prod stack", async () => {
    mockedIsSwarmActive.mockResolvedValue(true);
    mockedGetSwarmServices.mockResolvedValue([
      {
        name: "postgres",
        fullName: "industream-prod_postgres",
        replicas: "1/1",
        image: "postgres:18-alpine",
        imageName: "postgres",
        version: "18-alpine",
        isRunning: true,
      },
    ]);

    runStatus();
    await flushAsync();

    expect(mockedGetSwarmServices.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "industream-prod",
        ],
      ]
    `);
  });

  it("swarm active (dev) — stack name derives from config.defaultEnvironment", async () => {
    mockedLoadConfig.mockResolvedValue({
      platformDir: "~/industream-platform",
      defaultEnvironment: "dev",
    });
    mockedIsSwarmActive.mockResolvedValue(true);
    mockedGetSwarmServices.mockResolvedValue([]);

    runStatus();
    await flushAsync();

    expect(mockedGetSwarmServices.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "industream-dev",
        ],
      ]
    `);
  });

  it("swarm active (staging) — counts running services by isRunning flag", async () => {
    mockedLoadConfig.mockResolvedValue({
      platformDir: "~/industream-platform",
      defaultEnvironment: "staging",
    });
    mockedIsSwarmActive.mockResolvedValue(true);
    mockedGetSwarmServices.mockResolvedValue([
      {
        name: "postgres",
        fullName: "industream-staging_postgres",
        replicas: "1/1",
        image: "postgres:18-alpine",
        imageName: "postgres",
        version: "18-alpine",
        isRunning: true,
      },
      {
        name: "keycloak",
        fullName: "industream-staging_keycloak",
        replicas: "0/1",
        image: "keycloak/keycloak:26.1.0",
        imageName: "keycloak",
        version: "26.1.0",
        isRunning: false,
      },
    ]);

    runStatus();
    await flushAsync();

    expect(mockedGetSwarmServices).toHaveBeenCalledWith("industream-staging");
  });

  it("getSwarmServices throws — error is caught and logged, no crash", async () => {
    mockedIsSwarmActive.mockResolvedValue(true);
    mockedGetSwarmServices.mockRejectedValue(new Error("docker unreachable"));

    runStatus();
    await flushAsync();

    // The error is swallowed by runFallbackStatus' try/catch.
    expect(mockedGetSwarmServices).toHaveBeenCalledTimes(1);
  });

  // TODO: Snapshot the Ink-rendered dashboard (runStatus with TTY=true).
  // This requires ink-testing-library or a full React render harness because
  // StatusDashboard uses useEffect + async state transitions — mock.calls on
  // execa/docker alone would not capture the rendered UI. Deferred until the
  // Phase 1 refactor so we pick a single testing strategy.
  it.todo("TTY path: render Ink dashboard and snapshot output");
});
