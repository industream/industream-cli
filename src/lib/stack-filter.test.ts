import { describe, it, expect, vi, beforeEach } from "vitest";
import { getDeployFlags } from "./stack-filter.js";

vi.mock("./keygen.js", () => ({
  validateLicenseWithKeygen: vi.fn(),
}));

import { validateLicenseWithKeygen, type CachedLicense } from "./keygen.js";
import { loadModuleRegistry } from "./modules.js";

const PROPRIETARY_SERVICE_NAMES = loadModuleRegistry()
  .modules.filter((m) => m.license === "proprietary" && m.serviceName)
  .map((m) => m.serviceName!);

function mockLicense(opts: {
  plan: string;
  entitlements: string[];
  customer?: string | null;
}): void {
  const cache: CachedLicense | null =
    opts.plan === "community"
      ? null
      : ({
          key: "MOCK-KEY",
          fingerprint: "00:00:00:00:00:00",
          validatedAt: new Date().toISOString(),
          response: {
            data: {
              id: "mock-id",
              type: "licenses",
              attributes: {
                key: "MOCK-KEY",
                name: opts.customer ?? "Mock Customer",
                expiry: null,
                status: "ACTIVE",
                uses: 0,
                maxMachines: 1,
                metadata: { plan: opts.plan },
                created: new Date().toISOString(),
                updated: new Date().toISOString(),
              },
            },
            meta: {
              ts: new Date().toISOString(),
              valid: true,
              detail: "is valid",
              code: "VALID",
              scope: { product: "x", policy: "y", fingerprint: "00" },
            },
          },
          entitlements: opts.entitlements,
          plan: opts.plan,
          customer: opts.customer ?? "Mock Customer",
        } as CachedLicense);

  vi.mocked(validateLicenseWithKeygen).mockResolvedValue({
    valid: opts.plan !== "community",
    online: true,
    response: cache?.response ?? null,
    cache,
  });
}

describe("getDeployFlags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes proprietary services when no license is present", async () => {
    mockLicense({ plan: "community", entitlements: [] });

    const flags = await getDeployFlags("/tmp/platform");

    expect(flags.plan).toBe("community");
    expect(flags.excludedServices.length).toBeGreaterThan(0);
    expect(flags.licensedModuleCount).toBeLessThan(flags.totalModuleCount);

    for (const serviceName of PROPRIETARY_SERVICE_NAMES) {
      expect(flags.excludedServices).toContain(serviceName);
    }
  });

  it("includes all services when enterprise license has all entitlements", async () => {
    const allEntitlements = loadModuleRegistry()
      .modules.filter((m) => m.license === "proprietary" && m.entitlement)
      .map((m) => m.entitlement!);

    mockLicense({
      plan: "enterprise",
      entitlements: allEntitlements,
      customer: "Test Corp",
    });

    const flags = await getDeployFlags("/tmp/platform");

    expect(flags.plan).toBe("enterprise");
    expect(flags.excludedServices).toEqual([]);
  });

  it("includes only modules whose entitlement is granted", async () => {
    mockLicense({
      plan: "pro",
      entitlements: ["MODULE_OPC_UA"],
      customer: "Pro Corp",
    });

    const flags = await getDeployFlags("/tmp/platform");

    expect(flags.plan).toBe("pro");
    expect(flags.excludedServices).not.toContain("worker-opc-ua-client");

    // Other proprietary services without entitlement should be excluded
    expect(flags.excludedServices).toContain("worker-rtsp-client");
  });

  it("allows trial plan when all entitlements are attached", async () => {
    // Trial policy should have all entitlements attached in Keygen
    const allEntitlements = loadModuleRegistry()
      .modules.filter((m) => m.license === "proprietary" && m.entitlement)
      .map((m) => m.entitlement!);

    mockLicense({
      plan: "trial",
      entitlements: allEntitlements,
      customer: "Trial Corp",
    });

    const flags = await getDeployFlags("/tmp/platform");

    expect(flags.plan).toBe("trial");
    expect(flags.excludedServices).toEqual([]);
  });
});
