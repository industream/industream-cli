import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

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

let cachedRegistry: ModuleRegistry | null = null;

// Resolve modules.json location across dev (src/lib/), bundled (dist/), and npm-linked installs
function findModulesJson(): string {
  const currentFile = fileURLToPath(import.meta.url);
  const currentDir = dirname(currentFile);
  const candidates = [
    join(currentDir, "..", "..", "modules.json"), // src/lib → root
    join(currentDir, "..", "modules.json"), // dist → root
    join(currentDir, "modules.json"), // same dir
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`modules.json not found. Tried: ${candidates.join(", ")}`);
}

export function loadModuleRegistry(): ModuleRegistry {
  if (cachedRegistry) return cachedRegistry;
  const path = findModulesJson();
  cachedRegistry = JSON.parse(readFileSync(path, "utf-8")) as ModuleRegistry;
  return cachedRegistry;
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
