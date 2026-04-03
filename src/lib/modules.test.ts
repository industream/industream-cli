import { describe, it, expect } from "vitest";
import {
  loadModuleRegistry,
  getModulesByLicense,
  isModuleLicensed,
  type Module,
} from "./modules.js";

describe("modules", () => {
  it("loads module registry", () => {
    const registry = loadModuleRegistry();
    expect(registry.modules.length).toBeGreaterThan(0);
  });

  it("every module has required fields", () => {
    const registry = loadModuleRegistry();
    for (const module of registry.modules) {
      expect(module.id).toBeTruthy();
      expect(module.name).toBeTruthy();
      expect(module.category).toBeTruthy();
      expect(["bsl", "proprietary", "apache"]).toContain(module.license);
      expect(["ready", "coming-soon", "under-test", "on-request"]).toContain(module.status);
    }
  });

  it("filters modules by license type", () => {
    const registry = loadModuleRegistry();
    const bslModules = getModulesByLicense(registry, "bsl");
    const proprietaryModules = getModulesByLicense(registry, "proprietary");
    expect(bslModules.length).toBeGreaterThan(0);
    expect(proprietaryModules.length).toBeGreaterThan(0);
    expect(bslModules.every((m) => m.license === "bsl")).toBe(true);
    expect(proprietaryModules.every((m) => m.license === "proprietary")).toBe(true);
  });

  it("checks if a module is licensed for community plan", () => {
    const registry = loadModuleRegistry();
    expect(isModuleLicensed(registry, "industream-core", "community")).toBe(true);
    expect(isModuleLicensed(registry, "opc-ua-connector", "community")).toBe(false);
  });

  it("checks if a module is licensed for enterprise plan", () => {
    const registry = loadModuleRegistry();
    expect(isModuleLicensed(registry, "opc-ua-connector", "enterprise")).toBe(true);
  });

  it("checks pro plan with explicit module list", () => {
    const registry = loadModuleRegistry();
    expect(isModuleLicensed(registry, "opc-ua-connector", "pro", ["opc-ua-connector"])).toBe(true);
    expect(isModuleLicensed(registry, "opc-ua-connector", "pro", [])).toBe(false);
    expect(isModuleLicensed(registry, "opc-ua-connector", "pro")).toBe(false);
  });

  it("returns false for unknown module id", () => {
    const registry = loadModuleRegistry();
    expect(isModuleLicensed(registry, "nonexistent-module", "enterprise")).toBe(false);
  });

  it("apache licensed modules are available to all plans", () => {
    const registry = loadModuleRegistry();
    expect(isModuleLicensed(registry, "grafana-databridge", "community")).toBe(true);
    expect(isModuleLicensed(registry, "grafana-databridge", "pro")).toBe(true);
  });

  it("contains platform-deployable modules with serviceName", () => {
    const registry = loadModuleRegistry();
    const deployable = registry.modules.filter((m) => m.serviceName);
    expect(deployable.length).toBeGreaterThan(20);
    for (const module of deployable) {
      expect(module.stackFile).toBeTruthy();
    }
  });
});
