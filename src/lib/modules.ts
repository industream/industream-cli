import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export interface Module {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  license: "bsl" | "proprietary" | "apache";
  status: "ready" | "coming-soon" | "under-test" | "on-request";
  type?: "service" | "cronjob";
  serviceName?: string;
  stackFile?: string;
  imagePattern?: string;
  /**
   * Optional image path of the enterprise (`-ee`) variant of this worker.
   * Present only on dual-variant modules where a community image (`imagePattern`)
   * is published on GHCR alongside a feature-enhanced enterprise image on the
   * dedicated Harbor (`ENTERPRISE_REGISTRY`). The dispatcher pipeline uses
   * this field to route the enterprise build to the right registry.
   * Example: `"flowmaker.boxes/flow-box-data-logger-ee"`.
   */
  enterpriseVariant?: string;
  /** Keygen entitlement code required to enable this module (proprietary only) */
  entitlement?: string;
  /**
   * Mandatory worker: always deployed and non-deselectable in the install
   * selector (platform-plumbing flow-boxes the minimum viable stack needs).
   */
  required?: boolean;
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
