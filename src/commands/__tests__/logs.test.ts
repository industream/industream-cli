// src/commands/__tests__/logs.test.ts
//
// Snapshot tests for runLogs — locks down the docker CLI arguments the
// command produces for each mode (list services vs. follow a specific one).
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("../../lib/config.js", () => ({
  loadConfig: vi.fn(),
}));

import { execa } from "execa";
import { loadConfig } from "../../lib/config.js";
import { runLogs } from "../logs.js";

const mockedExeca = vi.mocked(execa);
const mockedLoadConfig = vi.mocked(loadConfig);

function callSignatures(): Array<[string, unknown]> {
  return mockedExeca.mock.calls.map(
    (call) => [call[0] as string, call[1]] as [string, unknown],
  );
}

describe("runLogs — execa call sequence snapshots", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedLoadConfig.mockResolvedValue({
      platformDir: "~/industream-platform",
      defaultEnvironment: "prod",
    });
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("no service — lists services via docker stack services", async () => {
    mockedExeca.mockResolvedValue({
      stdout: "industream-prod_postgres\nindustream-prod_keycloak",
      stderr: "",
    } as never);

    await runLogs(undefined);

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "docker",
          [
            "stack",
            "services",
            "industream-prod",
            "--format",
            "{{.Name}}",
          ],
        ],
      ]
    `);
  });

  it("service name — default tail 100, no follow", async () => {
    mockedExeca.mockResolvedValue({ stdout: "", stderr: "" } as never);

    await runLogs("postgres");

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "docker",
          [
            "service",
            "logs",
            "--tail",
            "100",
            "industream-prod_postgres",
          ],
        ],
      ]
    `);
  });

  it("service name with --follow enabled", async () => {
    mockedExeca.mockResolvedValue({ stdout: "", stderr: "" } as never);

    await runLogs("postgres", { follow: true });

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "docker",
          [
            "service",
            "logs",
            "-f",
            "--tail",
            "100",
            "industream-prod_postgres",
          ],
        ],
      ]
    `);
  });

  it("service name with custom tail count", async () => {
    mockedExeca.mockResolvedValue({ stdout: "", stderr: "" } as never);

    await runLogs("keycloak", { tail: 500 });

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "docker",
          [
            "service",
            "logs",
            "--tail",
            "500",
            "industream-prod_keycloak",
          ],
        ],
      ]
    `);
  });

  it("service name, follow + tail combined, non-default env", async () => {
    mockedLoadConfig.mockResolvedValue({
      platformDir: "~/industream-platform",
      defaultEnvironment: "dev",
    });
    mockedExeca.mockResolvedValue({ stdout: "", stderr: "" } as never);

    await runLogs("flowmaker-scheduler", { follow: true, tail: 50 });

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "docker",
          [
            "service",
            "logs",
            "-f",
            "--tail",
            "50",
            "industream-dev_flowmaker-scheduler",
          ],
        ],
      ]
    `);
  });
});
