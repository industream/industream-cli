// src/commands/secrets.ts
import { execa } from "execa";
import { join } from "node:path";
import { loadConfig } from "../lib/config.js";
import { resolvePlatformDir } from "../lib/swarm-repo.js";

export async function runSecrets(options?: {
  show?: boolean;
  regenerate?: boolean;
}): Promise<void> {
  const config = await loadConfig();
  const platformDir = resolvePlatformDir(config.platformDir);
  const env = config.defaultEnvironment;

  if (options?.regenerate) {
    const scriptPath = join(platformDir, "scripts", "setup", "create-secrets.sh");
    await execa(scriptPath, ["--env", env, "--regenerate"], {
      cwd: platformDir,
      stdio: "inherit",
    });
    return;
  }

  // List secrets for this environment from Docker Swarm
  let secrets: string[] = [];
  try {
    const { stdout } = await execa("docker", [
      "secret",
      "ls",
      "--format",
      "{{.Name}}",
    ]);
    const prefix = `${env}_`;
    secrets = stdout
      .split("\n")
      .filter((s) => s.startsWith(prefix))
      .map((s) => s.slice(prefix.length))
      .sort();
  } catch (err) {
    console.error(
      `\n  \x1b[31m✗ Could not list Docker secrets: ${err instanceof Error ? err.message : err}\x1b[0m`,
    );
    console.error(
      "  \x1b[2mMake sure Docker Swarm is active.\x1b[0m\n",
    );
    return;
  }

  if (secrets.length === 0) {
    console.log("");
    console.log(`  No secrets found for environment: ${env}`);
    console.log(
      "  Run \x1b[1mindustream install\x1b[0m or \x1b[1mindustream secrets --regenerate\x1b[0m to create them.",
    );
    console.log("");
    return;
  }

  console.log("");
  console.log(`  \x1b[1mSecrets for '${env}' environment (${secrets.length}):\x1b[0m`);
  console.log("");

  if (options?.show) {
    console.log(
      "  \x1b[33m⚠ Docker secrets cannot be read back after creation (by design).\x1b[0m",
    );
    console.log(
      "  \x1b[2m  Use `industream secrets --regenerate` to rotate them.\x1b[0m",
    );
    console.log("");
  }

  for (const secret of secrets) {
    console.log(`    \x1b[32m✓\x1b[0m ${secret}`);
  }
  console.log("");
}
