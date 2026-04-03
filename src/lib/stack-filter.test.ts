import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDeployFlags } from "./stack-filter.js";

vi.mock("./license.js", () => ({
  loadLicenseFromDisk: vi.fn(),
  validateLicense: vi.fn(),
}));

import { loadLicenseFromDisk, validateLicense } from "./license.js";
import type { LicenseResult } from "./license.js";
import { loadModuleRegistry } from "./modules.js";

const PROPRIETARY_SERVICE_NAMES = loadModuleRegistry()
  .modules.filter((m) => m.license === "proprietary" && m.serviceName)
  .map((m) => m.serviceName!);

function mockLicense(result: LicenseResult): void {
  vi.mocked(loadLicenseFromDisk).mockResolvedValue(
    result.payload?.plan === "community" ? undefined : "mock-token",
  );
  vi.mocked(validateLicense).mockResolvedValue(result);
}

describe("getDeployFlags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes proprietary services when no license is present", async () => {
    mockLicense({
      isValid: true,
      isGracePeriod: false,
      daysRemaining: Infinity,
      payload: {
        iss: "industream.com",
        sub: "community",
        customer: "Community",
        plan: "community",
        modules: [],
        seats: Infinity,
        trial: false,
      },
    });

    const flags = await getDeployFlags("/tmp/platform");

    expect(flags.plan).toBe("community");
    expect(flags.excludedServices.length).toBeGreaterThan(0);
    expect(flags.licensedModuleCount).toBeLessThan(flags.totalModuleCount);

    for (const serviceName of PROPRIETARY_SERVICE_NAMES) {
      expect(flags.excludedServices).toContain(serviceName);
    }
  });

  it("includes all services with a valid enterprise license", async () => {
    mockLicense({
      isValid: true,
      isGracePeriod: false,
      daysRemaining: 365,
      payload: {
        iss: "industream.com",
        sub: "test-client",
        customer: "Test Corp",
        plan: "enterprise",
        modules: [],
        seats: 10,
        trial: false,
      },
    });

    const flags = await getDeployFlags("/tmp/platform");

    expect(flags.plan).toBe("enterprise");
    expect(flags.excludedServices).toEqual([]);
    expect(flags.licensedModuleCount).toBe(flags.totalModuleCount);
  });

  it("includes only specified modules for pro plan", async () => {
    mockLicense({
      isValid: true,
      isGracePeriod: false,
      daysRemaining: 365,
      payload: {
        iss: "industream.com",
        sub: "pro-client",
        customer: "Pro Corp",
        plan: "pro",
        modules: ["opc-ua-connector"],
        seats: 5,
        trial: false,
      },
    });

    const flags = await getDeployFlags("/tmp/platform");

    expect(flags.plan).toBe("pro");
    expect(flags.excludedServices).not.toContain("worker-opc-ua-client");

    const otherProprietary = PROPRIETARY_SERVICE_NAMES.filter(
      (s) => s !== "worker-opc-ua-client",
    );
    for (const serviceName of otherProprietary) {
      expect(flags.excludedServices).toContain(serviceName);
    }
  });

  it("includes all services during trial", async () => {
    mockLicense({
      isValid: true,
      isGracePeriod: false,
      daysRemaining: 30,
      payload: {
        iss: "industream.com",
        sub: "trial-client",
        customer: "Trial Corp",
        plan: "trial",
        modules: [],
        seats: 10,
        trial: true,
      },
    });

    const flags = await getDeployFlags("/tmp/platform");

    expect(flags.plan).toBe("trial");
    expect(flags.excludedServices).toEqual([]);
    expect(flags.licensedModuleCount).toBe(flags.totalModuleCount);
  });
});
