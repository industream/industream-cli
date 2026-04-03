// src/commands/secrets.ts
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { execa } from "execa";
import { loadConfig } from "../lib/config.js";
import { resolvePlatformDir } from "../lib/swarm-repo.js";

export async function runSecrets(options?: {
  show?: boolean;
  regenerate?: boolean;
}): Promise<void> {
  const config = await loadConfig();
  const platformDir = resolvePlatformDir(config.platformDir);
  const secretsDir = join(platformDir, "secrets");

  if (options?.regenerate) {
    const scriptPath = join(platformDir, "scripts", "setup", "create-secrets.sh");
    await execa(scriptPath, ["--env", config.defaultEnvironment, "--regenerate"], {
      cwd: platformDir,
      stdio: "inherit",
    });
    return;
  }

  try {
    const files = await readdir(secretsDir);
    const secretFiles = files.filter((f: string) => !f.startsWith("."));

    for (const file of secretFiles.sort()) {
      if (options?.show) {
        const value = await readFile(join(secretsDir, file), "utf-8");
        console.log(`${file}: ${value.trim()}`);
      } else {
        console.log(`  ${file}`);
      }
    }
  } catch {
    console.error("No secrets directory found. Run: industream deploy");
  }
}
