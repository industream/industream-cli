// src/commands/worker.ts
import { loadConfig } from "../lib/config.js";
import { resolvePlatformDir, isPlatformInstalled } from "../lib/swarm-repo.js";
import {
  installWorker,
  listInstalledWorkers,
  removeWorker,
} from "../lib/external-workers.js";

function ensurePlatformDir(platformDir: string): string {
  return resolvePlatformDir(platformDir);
}

export async function runWorkerAdd(workerPath: string): Promise<void> {
  const config = await loadConfig();

  if (!(await isPlatformInstalled(config.platformDir))) {
    console.error("Platform not installed. Run: industream install");
    process.exit(1);
  }

  const platformDir = ensurePlatformDir(config.platformDir);

  try {
    const manifest = await installWorker(workerPath, platformDir);
    console.log(`Worker '${manifest.metadata.name}' v${manifest.metadata.version} installed.`);
    console.log(`Stack file: external-workers/${manifest.metadata.name}/docker-stack.external.yml`);
    console.log("");
    console.log("Redeploy to activate: industream deploy");
  } catch (error) {
    console.error(`Failed to add worker: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}

export async function runWorkerList(): Promise<void> {
  const config = await loadConfig();

  if (!(await isPlatformInstalled(config.platformDir))) {
    console.error("Platform not installed. Run: industream install");
    process.exit(1);
  }

  const platformDir = ensurePlatformDir(config.platformDir);
  const workers = await listInstalledWorkers(platformDir);

  if (workers.length === 0) {
    console.log("No external workers installed.");
    return;
  }

  console.log("");
  console.log("  \x1b[1mExternal Workers\x1b[0m");
  console.log("");

  const nameWidth = Math.max(10, ...workers.map((w) => w.name.length)) + 2;
  const versionWidth = 10;
  const authorWidth = Math.max(8, ...workers.map((w) => w.author.length)) + 2;

  const header =
    "  " +
    "NAME".padEnd(nameWidth) +
    "VERSION".padEnd(versionWidth) +
    "AUTHOR".padEnd(authorWidth) +
    "STATUS";
  console.log(header);

  for (const worker of workers) {
    const statusColor =
      worker.status === "running" ? "\x1b[32m" : worker.status === "stopped" ? "\x1b[33m" : "\x1b[90m";
    const line =
      "  " +
      worker.name.padEnd(nameWidth) +
      worker.version.padEnd(versionWidth) +
      worker.author.padEnd(authorWidth) +
      `${statusColor}${worker.status}\x1b[0m`;
    console.log(line);
  }

  console.log("");
}

export async function runWorkerRemove(name: string): Promise<void> {
  const config = await loadConfig();

  if (!(await isPlatformInstalled(config.platformDir))) {
    console.error("Platform not installed. Run: industream install");
    process.exit(1);
  }

  const platformDir = ensurePlatformDir(config.platformDir);

  try {
    await removeWorker(name, platformDir);
    console.log(`Worker '${name}' removed.`);
    console.log("");
    console.log("Redeploy to apply: industream deploy");
  } catch (error) {
    console.error(`Failed to remove worker: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
