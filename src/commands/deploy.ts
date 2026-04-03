// src/commands/deploy.ts
import { execa } from "execa";
import { loadConfig } from "../lib/config.js";
import { resolvePlatformDir, isPlatformInstalled } from "../lib/swarm-repo.js";
import { join } from "node:path";

export type Environment = "prod" | "dev" | "staging";

export async function runDeploy(
  environment?: string,
  options?: { withDemo?: boolean },
): Promise<void> {
  const config = await loadConfig();
  const env = environment ?? config.defaultEnvironment;
  const platformDir = resolvePlatformDir(config.platformDir);

  if (!(await isPlatformInstalled(config.platformDir))) {
    console.error(
      "Platform not installed. Run: industream install",
    );
    process.exit(1);
  }

  const args = ["--env", env];
  if (options?.withDemo) {
    args.push("--with-demo");
  }

  const scriptPath = join(platformDir, "scripts", "deploy-swarm.sh");

  await execa(scriptPath, args, {
    cwd: platformDir,
    stdio: "inherit",
  });
}
