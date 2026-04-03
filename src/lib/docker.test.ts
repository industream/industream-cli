// src/lib/docker.test.ts
import { describe, it, expect } from "vitest";
import {
  parseServiceList,
  parseImageVersion,
  type SwarmService,
} from "./docker.js";

describe("docker helpers", () => {
  it("parses docker service ls output", () => {
    const output = `industream-prod_postgres 1/1 postgres:18-alpine
industream-prod_keycloak 1/1 keycloak/keycloak:26.1.0
industream-prod_flowmaker-scheduler 0/1 842775dh.c1.gra9.container-registry.ovh.net/flowmaker.core/flowmaker-launcher:2.0.2`;

    const services = parseServiceList(output, "industream-prod");
    expect(services).toHaveLength(3);
    expect(services[0].name).toBe("postgres");
    expect(services[0].replicas).toBe("1/1");
    expect(services[0].image).toBe("postgres:18-alpine");
    expect(services[1].name).toBe("keycloak");
    expect(services[2].name).toBe("flowmaker-scheduler");
  });

  it("extracts version from image tag", () => {
    expect(parseImageVersion("postgres:18-alpine")).toBe("18-alpine");
    expect(parseImageVersion("keycloak/keycloak:26.1.0")).toBe("26.1.0");
    expect(parseImageVersion("registry.example.com/foo/bar:1.2.3")).toBe("1.2.3");
    expect(parseImageVersion("registry.example.com/foo/bar")).toBe("latest");
  });
});
