// src/lib/unified-deploy.ts
// v2 deploy path: drive the unified `scripts/deploy.sh` assembler instead of the
// legacy per-file docker-stack orchestration. The CLI stays the simple front
// door — it resolves {runtime, edition, env, bundle} and lets deploy.sh assemble
// base/*.yml + runtime overlays + the license-aware bundle.
import { execa } from "execa";
import { join } from "node:path";
import { homedir } from "node:os";
import { stat } from "node:fs/promises";
import { loadEnvFile } from "./swarm-repo.js";

export type RuntimeName = "swarm" | "compose";
export type Edition = "ce" | "ee";

export interface UnifiedDeployParams {
  runtime: RuntimeName;
  edition: Edition;
  env: string;
  /** Release bundle version; omit to let deploy.sh auto-select the only one. */
  bundle?: string;
  /** Optional group footprint (e.g. "core data monitoring"). */
  groups?: string;
}

function expandTilde(p: string): string {
  return p.startsWith("~") ? join(homedir(), p.slice(1)) : p;
}

/** `<platformDir>/unified` — the root of the unified deploy tree. */
export function unifiedDir(platformDir: string): string {
  return join(expandTilde(platformDir), "unified");
}

/** True when the platform install carries the unified tree (deploy.sh present). */
export async function unifiedTreeExists(platformDir: string): Promise<boolean> {
  try {
    await stat(join(unifiedDir(platformDir), "scripts", "deploy.sh"));
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the argv for `unified/scripts/deploy.sh` from resolved params. Pure and
 * deterministic so it can be unit-tested without a platform tree.
 */
export function buildDeployArgs(params: UnifiedDeployParams): string[] {
  const args = ["--runtime", params.runtime, "--edition", params.edition, "--env", params.env];
  if (params.bundle) args.push("--bundle", params.bundle);
  if (params.groups) args.push("--groups", params.groups);
  if (params.runtime === "swarm") args.push("--stack", `industream-${params.env}`);
  else args.push("--project", params.env);
  return args;
}

/**
 * Resolve {runtime, edition, bundle} from the platform `.env` (the install lock).
 * RUNTIME/EDITION default to swarm/ce; BUNDLE is optional (deploy.sh auto-selects).
 */
export async function resolveParamsFromEnv(
  platformDir: string,
  env: string,
): Promise<UnifiedDeployParams> {
  let vars: Record<string, string> = {};
  try {
    vars = await loadEnvFile(platformDir);
  } catch {
    // fresh install / no .env yet — keep defaults
  }
  const runtime: RuntimeName = vars.RUNTIME?.trim().toLowerCase() === "compose" ? "compose" : "swarm";
  const edition: Edition = vars.EDITION?.trim().toLowerCase() === "ee" ? "ee" : "ce";
  const bundle = vars.BUNDLE?.trim() || undefined;
  return { runtime, edition, env, bundle };
}

/** Run the unified assembler for the given params (plain stdio passthrough). */
export async function runUnifiedDeploy(
  platformDir: string,
  params: UnifiedDeployParams,
): Promise<void> {
  const dir = unifiedDir(platformDir);
  await execa("bash", [join(dir, "scripts", "deploy.sh"), ...buildDeployArgs(params)], {
    cwd: dir,
    stdio: "inherit",
  });
}
