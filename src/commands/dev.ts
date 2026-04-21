// src/commands/dev.ts
// Thin router: delegates Compose-instance sub-commands to the thematic bash
// scripts under industream-stack/scripts/compose/ (fm-instance.sh,
// fm-worker.sh, fm-hosts.sh, fm-sync.sh). Keeps the TS layer stateless —
// the bash side is the source of truth for `fm` semantics.
import { execa } from "execa";
import { join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { getComposeScriptsDir } from "../lib/runtimes/compose.js";

interface UpOptions {
  workers?: boolean;
  uimaker?: boolean;
  community?: boolean;
  local?: boolean;
}

async function execFmInstance(args: string[]): Promise<void> {
  const config = await loadConfig();
  const dir = await getComposeScriptsDir(config);
  await execa(join(dir, "fm-instance.sh"), args, { stdio: "inherit" });
}

async function execFmWorker(args: string[]): Promise<void> {
  const config = await loadConfig();
  const dir = await getComposeScriptsDir(config);
  await execa(join(dir, "fm-worker.sh"), args, { stdio: "inherit" });
}

async function execFmHosts(): Promise<void> {
  const config = await loadConfig();
  const dir = await getComposeScriptsDir(config);
  await execa(join(dir, "fm-hosts.sh"), [], { stdio: "inherit" });
}

async function execFmSync(args: string[]): Promise<void> {
  const config = await loadConfig();
  const dir = await getComposeScriptsDir(config);
  await execa(join(dir, "fm-sync.sh"), args, { stdio: "inherit" });
}

export async function runDevCreate(name: string): Promise<void> {
  await execFmInstance(["create", name]);
}

export async function runDevUp(name: string, opts: UpOptions): Promise<void> {
  const args = ["up", name];
  if (opts.workers) args.push("--workers");
  if (opts.uimaker) args.push("--uimaker");
  if (opts.community) args.push("--community");
  if (opts.local) args.push("--local");
  await execFmInstance(args);
}

export async function runDevDown(name: string): Promise<void> {
  await execFmInstance(["down", name]);
}

export async function runDevList(): Promise<void> {
  await execFmInstance(["list"]);
}

export async function runDevPs(name: string): Promise<void> {
  await execFmInstance(["ps", name]);
}

export async function runDevLogs(name: string, service?: string): Promise<void> {
  const args = ["logs", name];
  if (service) args.push(service);
  await execFmInstance(args);
}

export async function runDevDelete(name: string): Promise<void> {
  await execFmInstance(["delete", name]);
}

export async function runDevLaunchWorker(
  instance: string,
  workerName: string,
  processArgs: string[],
  opts: { id?: string; port?: string; workersPath?: string },
): Promise<void> {
  const args: string[] = ["launch-worker", instance];
  if (opts.id) args.push("--id", opts.id);
  if (opts.port) args.push("--port", opts.port);
  if (opts.workersPath) args.push(`--flowmaker-workers-path=${opts.workersPath}`);
  args.push(workerName, ...processArgs);
  await execFmWorker(args);
}

export async function runDevCdnReset(name: string, worker?: string): Promise<void> {
  const args = ["cdn-reset", name];
  if (worker) args.push(worker);
  await execFmWorker(args);
}

export async function runDevHosts(): Promise<void> {
  await execFmHosts();
}

export async function runDevInit(name: string): Promise<void> {
  await execFmSync(["init", name]);
}

export async function runDevSync(name: string): Promise<void> {
  await execFmSync(["sync", name]);
}
