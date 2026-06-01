// src/commands/stop.ts
// Thin router: delegates to the active Runtime.
import { loadConfig } from "../lib/config.js";
import { getRuntime } from "../lib/runtimes/index.js";

export async function runDown(environment?: string): Promise<void> {
  const config = await loadConfig();
  const env = environment ?? config.defaultEnvironment;
  const runtime = await getRuntime(config);
  await runtime.down(env);
}

// Backward-compat alias: old `stop` command still works
export const runStop = runDown;
