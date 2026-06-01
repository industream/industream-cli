// src/commands/logs.ts
// Thin router: delegates to the active Runtime.
import { loadConfig } from "../lib/config.js";
import { getRuntime } from "../lib/runtimes/index.js";

export async function runLogs(
  service?: string,
  options?: { follow?: boolean; tail?: number },
): Promise<void> {
  const config = await loadConfig();
  const runtime = await getRuntime(config);
  await runtime.logs(service, options ?? {});
}
