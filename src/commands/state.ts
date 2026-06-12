// src/commands/state.ts
// `industream state <subcommand>` — thin non-Ink wrapper around the platform
// script unified/scripts/deploy-state.sh (init | snapshot | render | diff |
// log). The script versions deployments in a local .deploy-state git repo:
// live Portainer snapshots + rendered desired state, secrets scrubbed.
import { join } from "node:path";
import { access } from "node:fs/promises";
import { execa } from "execa";
import { loadConfig } from "../lib/config.js";
import { resolvePlatformDir } from "../lib/swarm-repo.js";
import {
  buildStateArgs,
  isStateSubcommand,
  STATE_SUBCOMMANDS,
  type StateOptions,
} from "../lib/deploy-state.js";

export interface StateCliOptions extends StateOptions {
  /** Platform install path override (default: ~/industream-platform). */
  path?: string;
}

/** deploy-state.sh exits 3 when snapshot is soft-skipped (no Portainer creds). */
const SNAPSHOT_SOFT_SKIP_EXIT_CODE = 3;

export async function runState(
  subcommand: string,
  options: StateCliOptions = {},
): Promise<void> {
  if (!isStateSubcommand(subcommand)) {
    console.error(`Unknown state subcommand: "${subcommand}".`);
    console.error(`Valid subcommands: ${STATE_SUBCOMMANDS.join(", ")}.`);
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig();
  const platformDir = resolvePlatformDir(options.path ?? config.platformDir);
  const unifiedDir = join(platformDir, "unified");
  const script = join(unifiedDir, "scripts", "deploy-state.sh");

  if (!(await fileExists(script))) {
    console.error(`deploy-state.sh not found: ${script}`);
    console.error(
      "The installed platform tree is older than this CLI. " +
        "Re-run `industream install` or `industream update` to refresh it.",
    );
    process.exitCode = 1;
    return;
  }

  // stdio: "inherit" + env passthrough so PORTAINER_PASSWORD /
  // PORTAINER_API_KEY / STATE_DIR reach the script untouched.
  try {
    await execa("bash", [script, ...buildStateArgs(subcommand, options)], {
      cwd: unifiedDir,
      stdio: "inherit",
      env: process.env,
    });
  } catch (error) {
    const exitCode = (error as { exitCode?: number }).exitCode ?? 1;
    if (exitCode === SNAPSHOT_SOFT_SKIP_EXIT_CODE) {
      console.error("");
      console.error("Snapshot skipped: no Portainer credentials available.");
      console.error(
        "Set PORTAINER_API_KEY (or PORTAINER_PASSWORD) and run `industream state snapshot` again.",
      );
    }
    process.exitCode = exitCode;
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
