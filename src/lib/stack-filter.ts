import { loadModuleRegistry, isModuleLicensed, type Plan } from "./modules.js";
import { loadLicenseFromDisk, validateLicense } from "./license.js";

export interface DeployFlags {
  plan: string;
  licensedModuleCount: number;
  totalModuleCount: number;
  excludedServices: string[];
}

export async function getDeployFlags(
  platformDir: string,
): Promise<DeployFlags> {
  const registry = loadModuleRegistry();
  const token = await loadLicenseFromDisk();
  const license = await validateLicense(token);

  const plan: Plan = license.payload?.plan ?? "community";
  const licensedModuleIds = license.payload?.modules ?? [];

  const deployableModules = registry.modules.filter(
    (module) => module.serviceName,
  );

  const excludedServices: string[] = [];
  let licensedModuleCount = 0;

  for (const module of deployableModules) {
    const isLicensed = isModuleLicensed(
      registry,
      module.id,
      plan,
      licensedModuleIds,
    );

    if (isLicensed) {
      licensedModuleCount++;
    } else if (module.serviceName) {
      excludedServices.push(module.serviceName);
    }
  }

  return {
    plan,
    licensedModuleCount,
    totalModuleCount: deployableModules.length,
    excludedServices,
  };
}
