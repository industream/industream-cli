// src/lib/config.ts
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";

export interface IndustreamConfig {
  platformDir: string;
  defaultEnvironment: string;
  domain?: string;
  registryUrl?: string;
}

const DEFAULT_CONFIG: IndustreamConfig = {
  platformDir: "~/industream-platform",
  defaultEnvironment: "prod",
};

const CONFIG_FILE = "config.json";

export function getConfigDir(): string {
  return join(homedir(), ".industream");
}

export async function loadConfig(configDir?: string): Promise<IndustreamConfig> {
  const directory = configDir ?? getConfigDir();
  const filePath = join(directory, CONFIG_FILE);
  try {
    const content = await readFile(filePath, "utf-8");
    return { ...DEFAULT_CONFIG, ...JSON.parse(content) };
  } catch {
    return { ...DEFAULT_CONFIG };
  }
}

export async function saveConfig(
  config: IndustreamConfig,
  configDir?: string,
): Promise<void> {
  const directory = configDir ?? getConfigDir();
  await mkdir(directory, { recursive: true });
  const filePath = join(directory, CONFIG_FILE);
  await writeFile(filePath, JSON.stringify(config, null, 2));
}
