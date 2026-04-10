// src/lib/stack-filter.ts
// Determines which services should be excluded from a deploy based on
// the active Keygen license and its entitlements.
import { loadModuleRegistry, type Module } from "./modules.js";
import { validateLicenseWithKeygen } from "./keygen.js";

export interface DeployFlags {
  plan: string;
  customer: string | null;
  licensedModuleCount: number;
  totalModuleCount: number;
  excludedServices: string[];
  entitlements: string[];
  online: boolean;
  valid: boolean;
}

export async function getDeployFlags(
  _platformDir: string,
): Promise<DeployFlags> {
  const registry = loadModuleRegistry();
  const result = await validateLicenseWithKeygen();

  const plan = result.cache?.plan ?? "community";
  const customer = result.cache?.customer ?? null;
  const entitlements = result.cache?.entitlements ?? [];

  const deployableModules = registry.modules.filter((m) => m.serviceName);
  const excludedServices: string[] = [];
  let licensedModuleCount = 0;

  for (const module of deployableModules) {
    if (isModuleAllowed(module, plan, entitlements)) {
      licensedModuleCount++;
    } else if (module.serviceName) {
      excludedServices.push(module.serviceName);
    }
  }

  return {
    plan,
    customer,
    licensedModuleCount,
    totalModuleCount: deployableModules.length,
    excludedServices,
    entitlements,
    online: result.online,
    valid: result.valid,
  };
}

/**
 * Check whether a module is allowed under the current entitlements.
 * BSL and Apache modules are always allowed. Proprietary modules require
 * the module's entitlement code to be present in the license's entitlement
 * list. The plan name is informational only — entitlements are the source
 * of truth.
 */
export function isModuleAllowed(
  module: Module,
  _plan: string,
  entitlements: string[],
): boolean {
  if (module.license === "bsl" || module.license === "apache") return true;
  // Modules without entitlement are managed by stack file inclusion
  // (e.g. docker-stack.workers-premium.yml) — not by the exclude list
  if (!module.entitlement) return true;
  return entitlements.includes(module.entitlement);
}
