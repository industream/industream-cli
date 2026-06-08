import { describe, it, expect } from "vitest";
import { downArgs, logsArgs } from "./unified-ops.js";

describe("downArgs", () => {
  it("swarm → stack rm industream-<env>", () => {
    expect(downArgs("swarm", "prod")).toEqual(["stack", "rm", "industream-prod"]);
  });
  it("compose → compose -p <env> down", () => {
    expect(downArgs("compose", "dev")).toEqual(["compose", "-p", "dev", "down"]);
  });
});

describe("logsArgs", () => {
  it("compose: all services + follow + tail", () => {
    expect(logsArgs("compose", "dev", undefined, { follow: true, tail: 50 })).toEqual([
      "compose", "-p", "dev", "logs", "-f", "--tail", "50",
    ]);
  });
  it("compose: a single service", () => {
    expect(logsArgs("compose", "dev", "datacatalog-api")).toEqual([
      "compose", "-p", "dev", "logs", "datacatalog-api",
    ]);
  });
  it("swarm: prefixes the stack + service", () => {
    expect(logsArgs("swarm", "prod", "grafana", { tail: 10 })).toEqual([
      "service", "logs", "--tail", "10", "industream-prod_grafana",
    ]);
  });
  it("swarm: throws without a service", () => {
    expect(() => logsArgs("swarm", "prod")).toThrow(/service name/);
  });
});
