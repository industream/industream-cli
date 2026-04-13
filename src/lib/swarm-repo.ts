// src/lib/swarm-repo.ts
import { execa } from "execa";
import { readFile, writeFile, access } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

const REPO_URL = "https://github.com/industream/industream-stack.git";

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

export async function cloneSwarmRepo(platformDir: string): Promise<void> {
  const resolved = resolvePlatformDir(platformDir);
  await execa("git", ["clone", "--quiet", REPO_URL, resolved]);
}

export async function pullSwarmRepo(platformDir: string): Promise<string> {
  const resolved = resolvePlatformDir(platformDir);
  const { stdout } = await execa("git", ["-C", resolved, "pull", "--ff-only"]);
  return stdout;
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
