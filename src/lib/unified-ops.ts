// src/lib/unified-ops.ts
// v2 lifecycle ops (down / logs) against a unified deployment. The CLI maps an
// environment to its swarm stack (`industream-<env>`) or compose project
// (`<env>`) — the same mapping `deploy` (lib/unified-deploy.ts) uses.
import { execa } from "execa";
import { loadEnvFile } from "./swarm-repo.js";
import type { RuntimeName } from "./unified-deploy.js";

export interface UnifiedLogsOptions {
  follow?: boolean;
  tail?: number;
}

/** Resolve the runtime: explicit override > platform `.env` RUNTIME > swarm. */
export async function resolveRuntime(platformDir: string, override?: string): Promise<RuntimeName> {
  if (override === "compose" || override === "swarm") return override;
  try {
    const vars = await loadEnvFile(platformDir);
    return vars.RUNTIME?.trim().toLowerCase() === "compose" ? "compose" : "swarm";
  } catch {
    return "swarm";
  }
}

/** `docker` argv to tear an env down (volumes preserved). */
export function downArgs(runtime: RuntimeName, env: string): string[] {
  return runtime === "swarm"
    ? ["stack", "rm", `industream-${env}`]
    : ["compose", "-p", env, "down"];
}

/** `docker` argv to stream logs. swarm needs a service; compose can stream all. */
export function logsArgs(
  runtime: RuntimeName,
  env: string,
  service?: string,
  opts: UnifiedLogsOptions = {},
): string[] {
  if (runtime === "compose") {
    const args = ["compose", "-p", env, "logs"];
    if (opts.follow) args.push("-f");
    if (opts.tail !== undefined) args.push("--tail", String(opts.tail));
    if (service) args.push(service);
    return args;
  }
  if (!service) {
    throw new Error("swarm logs need a service name: `industream logs <service> --env <env>`");
  }
  const args = ["service", "logs"];
  if (opts.follow) args.push("-f");
  if (opts.tail !== undefined) args.push("--tail", String(opts.tail));
  args.push(`industream-${env}_${service}`);
  return args;
}

export async function unifiedDown(runtime: RuntimeName, env: string): Promise<void> {
  await execa("docker", downArgs(runtime, env), { stdio: "inherit" });
}

export async function unifiedLogs(
  runtime: RuntimeName,
  env: string,
  service?: string,
  opts: UnifiedLogsOptions = {},
): Promise<void> {
  await execa("docker", logsArgs(runtime, env, service, opts), { stdio: "inherit" });
}
