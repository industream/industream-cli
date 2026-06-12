import { describe, it, expect } from "vitest";
import { buildStateArgs, isStateSubcommand, STATE_SUBCOMMANDS } from "./deploy-state.js";

describe("buildStateArgs", () => {
  it("bare subcommand → just the subcommand", () => {
    expect(buildStateArgs("init")).toEqual(["init"]);
    expect(buildStateArgs("snapshot", {})).toEqual(["snapshot"]);
  });

  it("env + edition → flags in order after the subcommand", () => {
    expect(buildStateArgs("render", { env: "prod", edition: "ee" })).toEqual([
      "render", "--env", "prod", "--edition", "ee",
    ]);
  });

  it("baked flag → appended last, value-less", () => {
    expect(buildStateArgs("render", { env: "dev", baked: true })).toEqual([
      "render", "--env", "dev", "--baked",
    ]);
  });

  it("omits --env/--edition/--baked when absent or false", () => {
    const args = buildStateArgs("diff", { baked: false });
    expect(args).toEqual(["diff"]);
    expect(args).not.toContain("--env");
    expect(args).not.toContain("--edition");
    expect(args).not.toContain("--baked");
  });
});

describe("isStateSubcommand", () => {
  it("accepts every allowlisted subcommand", () => {
    for (const subcommand of STATE_SUBCOMMANDS) {
      expect(isStateSubcommand(subcommand)).toBe(true);
    }
  });

  it("rejects unknown subcommands", () => {
    expect(isStateSubcommand("destroy")).toBe(false);
    expect(isStateSubcommand("")).toBe(false);
  });
});
