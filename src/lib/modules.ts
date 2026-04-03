import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface Module {
  id: string;
  name: string;
  category: string;
  license: "bsl" | "proprietary" | "apache";
  status: "ready" | "coming-soon" | "under-test" | "on-request";
  serviceName?: string;
  stackFile?: string;
  imagePattern?: string;
}

export interface ModuleRegistry {
  modules: Module[];
}

export function loadModuleRegistry(): ModuleRegistry {
  return require("../../modules.json") as ModuleRegistry;
}

export function getModulesByLicense(
  registry: ModuleRegistry,
  license: Module["license"],
): Module[] {
  return registry.modules.filter((m) => m.license === license);
}

export type Plan = "community" | "trial" | "pro" | "enterprise";

export function isModuleLicensed(
  registry: ModuleRegistry,
  moduleId: string,
  plan: Plan,
  licensedModuleIds?: string[],
): boolean {
  const module = registry.modules.find((m) => m.id === moduleId);
  if (!module) return false;

  if (module.license === "bsl" || module.license === "apache") return true;
  if (plan === "enterprise" || plan === "trial") return true;
  if (plan === "pro" && licensedModuleIds) {
    return licensedModuleIds.includes(moduleId);
  }
  return false;
}
