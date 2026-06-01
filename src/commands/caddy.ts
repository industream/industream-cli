// src/commands/caddy.ts
// Thin router: delegates caddy:* sub-commands to fm-caddy.sh.
import { execa } from "execa";
import { join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { getComposeScriptsDir } from "../lib/runtimes/compose.js";

async function execFmCaddy(args: string[]): Promise<void> {
  const config = await loadConfig();
  const dir = await getComposeScriptsDir(config);
  await execa(join(dir, "fm-caddy.sh"), args, { stdio: "inherit" });
}

export async function runCaddyRebuild(): Promise<void> {
  await execFmCaddy(["rebuild"]);
}

export async function runCaddyStop(): Promise<void> {
  await execFmCaddy(["stop"]);
}

export async function runCaddyDelete(): Promise<void> {
  await execFmCaddy(["delete"]);
}

export async function runCaddyLogs(): Promise<void> {
  await execFmCaddy(["logs"]);
}

export async function runCaddyCa(dest?: string): Promise<void> {
  const args = ["ca"];
  if (dest) args.push(dest);
  await execFmCaddy(args);
}
