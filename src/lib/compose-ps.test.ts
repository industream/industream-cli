import { describe, it, expect } from "vitest";
import { parseComposePs } from "./docker.js";

describe("parseComposePs", () => {
  it("maps NDJSON compose ps into the SwarmService shape", () => {
    const out = [
      '{"Name":"uni-ce-datacatalog-api-1","Service":"datacatalog-api","Image":"ghcr.io/industream/datacatalog/api:1.9.1","State":"running","Status":"Up 2 hours"}',
      '{"Name":"uni-ce-grafana-1","Service":"grafana","Image":"grafana/grafana-oss:13.0.1","State":"exited","Status":"Exited (1)"}',
    ].join("\n");
    const svcs = parseComposePs(out);
    expect(svcs).toHaveLength(2);
    expect(svcs[0]).toMatchObject({
      name: "datacatalog-api",
      fullName: "uni-ce-datacatalog-api-1",
      isRunning: true,
      replicas: "1/1",
      imageName: "api",
      version: "1.9.1",
    });
    expect(svcs[1]).toMatchObject({ name: "grafana", isRunning: false, replicas: "0/1", version: "13.0.1" });
  });

  it("also accepts a JSON array form", () => {
    const out = '[{"Name":"p-x-1","Service":"x","Image":"img:2.0","State":"running"}]';
    expect(parseComposePs(out)).toHaveLength(1);
  });

  it("empty output → []", () => {
    expect(parseComposePs("")).toEqual([]);
  });
});
