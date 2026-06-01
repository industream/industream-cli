// src/lib/runtimes/index.ts
// Runtime abstraction: one TypeScript contract, two implementations.
// The concrete runtime is selected per platform install and stored in
// `platformDir/.env` under the `RUNTIME` key. Default is `swarm` for
// backwards compatibility with existing installs.
import type { IndustreamConfig } from "../config.js";
import type { SecretsBackend } from "../secrets/index.js";
import type { DeployReporter } from "../deploy-reporter.js";
import { loadEnvFile } from "../swarm-repo.js";
import { SwarmRuntime } from "./swarm.js";
import { ComposeRuntime } from "./compose.js";

export type RuntimeName = "swarm" | "compose";

export type Environment = string;

export interface DeployOptions {
  withDemo?: boolean;
  yes?: boolean;
  /**
   * Compose-only: allow `ComposeRuntime.deploy()` to proceed when
   * `NODE_ENV=production`. Swarm ignores this flag. Exposed on the CLI as
   * `--allow-compose-prod` (wired from Commander in a follow-up PR).
   */
  allowComposeProd?: boolean;
  /**
   * Compose-only: bring up the workers alongside the core services.
   * Passed through to `fm-instance.sh up` as `--workers`.
   */
  withWorkers?: boolean;
  /**
   * Compose-only: bring up the UIMaker instance alongside the core services.
   * Passed through to `fm-instance.sh up` as `--uimaker`.
   */
  withUimaker?: boolean;
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
  readonly secrets: SecretsBackend;
  // `reporter` (optional) receives structured progress for the live dashboard.
  // When omitted, runtimes keep their plain stdout behaviour (CI / non-TTY).
  deploy(
    env: Environment | undefined,
    opts: DeployOptions,
    reporter?: DeployReporter,
  ): Promise<void>;
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
