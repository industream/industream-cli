// src/lib/runtimes/index.ts
// Runtime abstraction: one TypeScript contract, two implementations.
// The concrete runtime is selected per platform install and stored in
// `platformDir/.env` under the `RUNTIME` key. Default is `swarm` for
// backwards compatibility with existing installs.
import type { IndustreamConfig } from "../config.js";
import { loadEnvFile } from "../swarm-repo.js";
import { SwarmRuntime } from "./swarm.js";
import { ComposeRuntime } from "./compose.js";

export type RuntimeName = "swarm" | "compose";

export type Environment = string;

export interface DeployOptions {
  withDemo?: boolean;
  yes?: boolean;
}

export interface LogsOptions {
  follow?: boolean;
  tail?: number;
}

export interface ServiceStatus {
  name: string;
  fullName: string;
  replicas: string;
  image: string;
  isRunning: boolean;
}

export interface StackStatus {
  stackName: string;
  active: boolean;
  services: ServiceStatus[];
}

export interface Runtime {
  readonly name: RuntimeName;
  deploy(env: Environment, opts: DeployOptions): Promise<void>;
  down(env: Environment): Promise<void>;
  status(): Promise<StackStatus>;
  logs(service: string | undefined, opts: LogsOptions): Promise<void>;
}

/**
 * Resolve the active runtime for the given platform config. Reads the
 * `RUNTIME` key from `platformDir/.env` (default: `swarm`) and returns
 * the matching Runtime implementation.
 */
export async function getRuntime(config: IndustreamConfig): Promise<Runtime> {
  const runtimeName = await readRuntimeName(config.platformDir);
  if (runtimeName === "compose") {
    return new ComposeRuntime(config);
  }
  return new SwarmRuntime(config);
}

async function readRuntimeName(platformDir: string): Promise<RuntimeName> {
  try {
    const env = await loadEnvFile(platformDir);
    const raw = env.RUNTIME?.trim().toLowerCase();
    if (raw === "compose") return "compose";
    if (raw === "swarm") return "swarm";
    return "swarm";
  } catch {
    // No `.env` yet (fresh install) — default to swarm for back-compat.
    return "swarm";
  }
}

export { SwarmRuntime } from "./swarm.js";
export { ComposeRuntime } from "./compose.js";
