// src/commands/__tests__/stop.test.ts
//
// Snapshot tests for runDown — captures exact docker stack rm invocation and
// confirms the interactive prompt flow short-circuits when the user declines.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------
vi.mock("execa", () => ({
  execa: vi.fn(),
}));

vi.mock("../../lib/config.js", () => ({
  loadConfig: vi.fn(),
}));

// Mock node:readline so we can drive the confirm() prompt deterministically.
vi.mock("node:readline", () => ({
  createInterface: vi.fn(),
}));

import { execa } from "execa";
import { loadConfig } from "../../lib/config.js";
import { createInterface } from "node:readline";
import { runDown } from "../stop.js";

const mockedExeca = vi.mocked(execa);
const mockedLoadConfig = vi.mocked(loadConfig);
const mockedCreateInterface = vi.mocked(createInterface);

function callSignatures(): Array<[string, unknown]> {
  return mockedExeca.mock.calls.map(
    (call) => [call[0] as string, call[1]] as [string, unknown],
  );
}

/** Install a fake readline interface that answers `answer` to every question. */
function stubConfirm(answer: string): void {
  mockedCreateInterface.mockReturnValue({
    question: (_prompt: string, cb: (value: string) => void): void => {
      cb(answer);
    },
    close: (): void => {},
  } as never);
}

describe("runDown — execa call sequence snapshots", () => {
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedLoadConfig.mockResolvedValue({
      platformDir: "~/industream-platform",
      defaultEnvironment: "prod",
    });
    mockedExeca.mockResolvedValue({ stdout: "", stderr: "" } as never);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
  });

  it("confirmed stop on prod env removes the stack", async () => {
    stubConfirm("y");

    await runDown("prod");

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "docker",
          [
            "stack",
            "rm",
            "industream-prod",
          ],
        ],
      ]
    `);
  });

  it("confirmed stop on dev env targets the dev stack", async () => {
    stubConfirm("y");

    await runDown("dev");

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "docker",
          [
            "stack",
            "rm",
            "industream-dev",
          ],
        ],
      ]
    `);
  });

  it("falls back to config.defaultEnvironment when no arg is passed", async () => {
    mockedLoadConfig.mockResolvedValue({
      platformDir: "~/industream-platform",
      defaultEnvironment: "staging",
    });
    stubConfirm("y");

    await runDown();

    expect(callSignatures()).toMatchInlineSnapshot(`
      [
        [
          "docker",
          [
            "stack",
            "rm",
            "industream-staging",
          ],
        ],
      ]
    `);
  });

  it("declined prompt ('N') does not invoke execa", async () => {
    stubConfirm("N");

    await runDown("prod");

    expect(mockedExeca).not.toHaveBeenCalled();
    expect(callSignatures()).toMatchInlineSnapshot(`[]`);
  });

  it("empty answer is treated as a decline", async () => {
    stubConfirm("");

    await runDown("prod");

    expect(mockedExeca).not.toHaveBeenCalled();
  });
});
