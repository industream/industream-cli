// src/lib/status-services.ts
// Runtime-aware service discovery. Both `industream status` and
// `industream update` need the list of running services regardless of the
// active orchestrator — this helper hides the Swarm-vs-Compose difference
// behind a single shape (`SwarmService`) so the commands stay runtime-agnostic.

import type { IndustreamConfig } from "./config.js";
import {
  getSwarmServices,
  isSwarmActive,
  parseImageName,
  parseImageVersion,
  type SwarmService,
} from "./docker.js";
import { getRuntime } from "./runtimes/index.js";
import type { RuntimeName, ServiceStatus } from "./runtimes/index.js";

export interface RunningServices {
  runtimeName: RuntimeName;
  /** True when the orchestrator is up AND the platform stack is deployed. */
  active: boolean;
  services: SwarmService[];
  /** User-facing hint shown when `active` is false, tailored per runtime. */
  inactiveHint: string;
}

/**
 * Resolve the running platform services for the configured runtime.
 *
 * - Swarm: keeps `getSwarmServices` (richer — it also resolves uptime).
 * - Compose: maps `Runtime.status()` services into the `SwarmService` shape,
 *   deriving `imageName`/`version` from the image reference.
 */
export async function getRunningServices(
  config: IndustreamConfig,
): Promise<RunningServices> {
  const runtime = await getRuntime(config);

  if (runtime.name === "swarm") {
    if (!(await isSwarmActive())) {
      return {
        runtimeName: "swarm",
        active: false,
        services: [],
        inactiveHint: "Docker Swarm is not active. Run: docker swarm init",
      };
    }
    const stackName = `industream-${config.defaultEnvironment}`;
    return {
      runtimeName: "swarm",
      active: true,
      services: await getSwarmServices(stackName),
      inactiveHint: "",
    };
  }

  // Compose runtime — derive the SwarmService shape from `docker compose ps`.
  const stack = await runtime.status();
  if (!stack.active) {
    return {
      runtimeName: "compose",
      active: false,
      services: [],
      inactiveHint:
        "No Compose instance is running. Run: industream deploy --env <instance>",
    };
  }
  return {
    runtimeName: "compose",
    active: true,
    services: stack.services.map(toSwarmService),
    inactiveHint: "",
  };
}

/** Map a runtime-neutral `ServiceStatus` onto the richer `SwarmService`. */
function toSwarmService(service: ServiceStatus): SwarmService {
  const image = service.image ?? "";
  return {
    name: service.name,
    fullName: service.fullName,
    replicas: service.replicas,
    image,
    imageName: parseImageName(image),
    version: parseImageVersion(image),
    isRunning: service.isRunning,
  };
}
