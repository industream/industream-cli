// src/lib/swarm-repo.ts
import { execa } from "execa";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const REPO_URL = "https://github.com/industream/industream-stack.git";

// The compose runtime needs the parallel deployment tree (docker-compose.*.yml
// + instances) from industream-flowmaker. The `fm` scripts in industream-stack
// resolve COMPOSE_ROOT to `<platformDir>/../industream-flowmaker/deployment`, so
// the tree must be cloned as a sibling of the platform dir.
const COMPOSE_REPO_URL = "https://github.com/industream/industream-flowmaker.git";
export const COMPOSE_TREE_DIR = "~/industream-flowmaker";

export function resolvePlatformDir(path: string): string {
  return path.replace(/^~/, homedir());
}

export function parseEnvFile(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const equalsIndex = trimmed.indexOf("=");
    if (equalsIndex === -1) continue;
    const key = trimmed.slice(0, equalsIndex);
    const value = trimmed.slice(equalsIndex + 1);
    result[key] = value;
  }
  return result;
}

export async function isPlatformInstalled(platformDir: string): Promise<boolean> {
  try {
    await access(join(resolvePlatformDir(platformDir), ".git"));
    return true;
  } catch {
    return false;
  }
}

// Shared git clone with progress streaming. --progress forces git to emit
// "Receiving objects: XX%..." even when stderr isn't a TTY; we pipe it so the
// Ink wizard can show it (otherwise Ink's alt-screen swallows it).
async function gitClone(
  url: string,
  resolved: string,
  onProgress?: (line: string) => void,
): Promise<void> {
  const child = execa("git", ["clone", "--progress", url, resolved], {
    stderr: "pipe",
  });
  if (onProgress && child.stderr) {
    let buffer = "";
    child.stderr.on("data", (chunk: Buffer) => {
      // git emits progress with \r between updates and \n on completion.
      buffer = (buffer + chunk.toString("utf8")).replace(/\r/g, "\n");
      const parts = buffer.split("\n");
      buffer = parts.pop() ?? "";
      for (const line of parts) {
        const trimmed = line.trim();
        if (trimmed) onProgress(trimmed);
      }
    });
  }
  await child;
}

export async function cloneSwarmRepo(
  platformDir: string,
  onProgress?: (line: string) => void,
): Promise<void> {
  await gitClone(REPO_URL, resolvePlatformDir(platformDir), onProgress);
}

/** True when the compose deployment tree (industream-flowmaker) is present. */
export async function isComposeTreeInstalled(): Promise<boolean> {
  try {
    await access(join(resolvePlatformDir(COMPOSE_TREE_DIR), ".git"));
    return true;
  } catch {
    return false;
  }
}

// Update a deployment tree to match its remote default branch, DISCARDING any
// local changes. The deploy writes runtime artefacts into tracked files (bundle
// .env.*, generated htpasswd, …), so a plain `git pull --ff-only` fails on the
// next install with "local changes would be overwritten by merge". The tree is a
// deploy artefact whose canonical state is the remote — those local edits are
// regenerated on every deploy — so we fetch + hard-reset. reset --hard only
// touches tracked files, so user custom/ overlays (untracked) are preserved.
async function hardResetToRemote(resolved: string): Promise<string> {
  await execa("git", ["-C", resolved, "fetch", "origin", "--quiet"]);
  const ref = await execa("git", ["-C", resolved, "rev-parse", "--abbrev-ref", "origin/HEAD"])
    .then((r) => r.stdout.trim())
    .catch(() => "origin/main");
  const { stdout } = await execa("git", ["-C", resolved, "reset", "--hard", ref || "origin/main"]);
  return stdout;
}

/** Clone (or update) the compose deployment tree as a sibling of the platform. */
export async function ensureComposeTree(
  onProgress?: (line: string) => void,
): Promise<void> {
  const resolved = resolvePlatformDir(COMPOSE_TREE_DIR);
  if (await isComposeTreeInstalled()) {
    await hardResetToRemote(resolved).catch(() => {
      // best-effort update; a clone already exists
    });
    return;
  }
  await gitClone(COMPOSE_REPO_URL, resolved, onProgress);
}

export async function pullSwarmRepo(platformDir: string): Promise<string> {
  return hardResetToRemote(resolvePlatformDir(platformDir));
}

export async function loadEnvFile(platformDir: string): Promise<Record<string, string>> {
  const resolved = resolvePlatformDir(platformDir);
  const content = await readFile(join(resolved, ".env"), "utf-8");
  return parseEnvFile(content);
}

export async function updateEnvValue(
  platformDir: string,
  key: string,
  value: string,
): Promise<void> {
  const resolved = resolvePlatformDir(platformDir);
  const envPath = join(resolved, ".env");
  const content = await readFile(envPath, "utf-8");
  const lines = content.split("\n");
  const prefix = `${key}=`;
  const index = lines.findIndex((line) => line.startsWith(prefix));
  if (index !== -1) {
    lines[index] = `${key}=${value}`;
  } else {
    lines.push(`${key}=${value}`);
  }
  await writeFile(envPath, lines.join("\n"), "utf-8");
}

export async function getDeployedVersions(
  platformDir: string,
): Promise<Record<string, string>> {
  const env = await loadEnvFile(platformDir);
  const versions: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.endsWith("_VERSION")) {
      versions[key] = value;
    }
  }
  return versions;
}
