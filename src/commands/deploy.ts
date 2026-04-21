// src/commands/deploy.ts
// Thin router: delegates to the active Runtime (Swarm or Compose).
// All deployment logic lives in src/lib/runtimes/{swarm,compose}.ts.
import { loadConfig } from "../lib/config.js";
import { getRuntime } from "../lib/runtimes/index.js";
import type { DeployOptions } from "../lib/runtimes/index.js";

export type Environment = "prod" | "dev" | "staging";

export async function runDeploy(
  environment?: string,
  options?: DeployOptions,
): Promise<void> {
  const config = await loadConfig();
  const runtime = await getRuntime(config);
  await runtime.deploy(environment, options ?? {});
}
