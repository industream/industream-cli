// src/commands/logs.ts
// Router: unified deployment (compose/stack logs) when the install carries the
// unified tree, else the legacy Runtime.
import { loadConfig } from "../lib/config.js";
import { getRuntime } from "../lib/runtimes/index.js";
import { unifiedTreeExists } from "../lib/unified-deploy.js";
import { resolveRuntime, unifiedLogs } from "../lib/unified-ops.js";

export async function runLogs(
  service?: string,
  options?: { follow?: boolean; tail?: number; env?: string; runtime?: string },
): Promise<void> {
  const config = await loadConfig();
  if (await unifiedTreeExists(config.platformDir)) {
    const env = options?.env ?? config.defaultEnvironment;
    await unifiedLogs(
      await resolveRuntime(config.platformDir, options?.runtime),
      env,
      service,
      { follow: options?.follow, tail: options?.tail },
    );
    return;
  }
  const runtime = await getRuntime(config);
  await runtime.logs(service, { follow: options?.follow, tail: options?.tail });
}
