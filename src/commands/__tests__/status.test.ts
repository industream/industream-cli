// src/commands/__tests__/status.test.ts
//
// Snapshot tests for runStatus. The command branches on TTY: when TTY is
// available it renders an Ink dashboard, otherwise it falls back to console
// output via runFallbackStatus(). We force the non-TTY path so we can assert
// on the (stable, non-React) sequence of calls and console output.
//
// Service discovery is now runtime-aware via `getRunningServices()` (Swarm or
// Compose), so the tests mock that single helper rather than the raw docker
// calls. Only the fallback branch is covered here — see the it.todo below.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("../../lib/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../../lib/status-services.js", () => ({
  getRunningServices: vi.fn(),
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
import { getRunningServices } from "../../lib/status-services.js";
import { runStatus } from "../status.js";

const mockedLoadConfig = vi.mocked(loadConfig);
const mockedGetRunningServices = vi.mocked(getRunningServices);

/** Flush queued microtasks so runFallbackStatus()'s async body completes. */
async function flushAsync(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("runStatus (fallback, non-TTY) — service call snapshots", () => {
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

  it("stack inactive — prints the runtime-specific hint, lists no services", async () => {
    mockedGetRunningServices.mockResolvedValue({
      runtimeName: "swarm",
      active: false,
      services: [],
      inactiveHint: "Docker Swarm is not active. Run: docker swarm init",
    });

    runStatus();
    await flushAsync();

    expect(mockedGetRunningServices).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("Docker Swarm is not active");
  });

  it("compose inactive — prints the compose hint", async () => {
    mockedGetRunningServices.mockResolvedValue({
      runtimeName: "compose",
      active: false,
      services: [],
      inactiveHint:
        "No Compose instance is running. Run: industream deploy --env <instance>",
    });

    runStatus();
    await flushAsync();

    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("No Compose instance is running");
  });

  it("stack active — lists running services with their version", async () => {
    mockedGetRunningServices.mockResolvedValue({
      runtimeName: "swarm",
      active: true,
      services: [
        {
          name: "postgres",
          fullName: "industream-prod_postgres",
          replicas: "1/1",
          image: "postgres:18-alpine",
          imageName: "postgres",
          version: "18-alpine",
          isRunning: true,
        },
      ],
      inactiveHint: "",
    });

    runStatus();
    await flushAsync();

    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("postgres");
    expect(output).toContain("1/1 services running");
  });

  it("compose active — counts running services by isRunning flag", async () => {
    mockedGetRunningServices.mockResolvedValue({
      runtimeName: "compose",
      active: true,
      services: [
        {
          name: "flowmaker-frontend",
          fullName: "fm-ce-flowmaker-frontend-1",
          replicas: "running",
          image: "ghcr.io/industream/flowmaker.core/frontend:2.1.2",
          imageName: "frontend",
          version: "2.1.2",
          isRunning: true,
        },
        {
          name: "datacatalog-api",
          fullName: "fm-ce-datacatalog-api-1",
          replicas: "exited",
          image: "ghcr.io/industream/datacatalog/api:1.9.0",
          imageName: "api",
          version: "1.9.0",
          isRunning: false,
        },
      ],
      inactiveHint: "",
    });

    runStatus();
    await flushAsync();

    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("1/2 services running");
  });

  it("getRunningServices throws — error is caught and logged, no crash", async () => {
    mockedGetRunningServices.mockRejectedValue(new Error("docker unreachable"));

    runStatus();
    await flushAsync();

    expect(mockedGetRunningServices).toHaveBeenCalledTimes(1);
    const output = consoleLogSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(output).toContain("docker unreachable");
  });

  // TODO: Snapshot the Ink-rendered dashboard (runStatus with TTY=true).
  it.todo("TTY path: render Ink dashboard and snapshot output");
});
