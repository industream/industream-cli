// src/commands/stop.ts
// Router: unified deployment (docker stack rm / compose down) when the install
// carries the unified tree, else the legacy Runtime.
import { loadConfig } from "../lib/config.js";
import { getRuntime } from "../lib/runtimes/index.js";
import { unifiedTreeExists } from "../lib/unified-deploy.js";
import { resolveRuntime, unifiedDown } from "../lib/unified-ops.js";

export async function runDown(environment?: string, runtimeOverride?: string): Promise<void> {
  const config = await loadConfig();
  const env = environment ?? config.defaultEnvironment;
  if (await unifiedTreeExists(config.platformDir)) {
    await unifiedDown(await resolveRuntime(config.platformDir, runtimeOverride), env);
    return;
  }
  const runtime = await getRuntime(config);
  await runtime.down(env);
}

// Backward-compat alias: old `stop` command still works
export const runStop = runDown;
