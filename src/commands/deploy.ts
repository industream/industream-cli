// src/commands/deploy.ts
import { execa } from "execa";
import { loadConfig } from "../lib/config.js";
import { resolvePlatformDir, isPlatformInstalled } from "../lib/swarm-repo.js";
import { getDeployFlags } from "../lib/stack-filter.js";
import { ensureRegistryLogin } from "../lib/registry-login.js";
import { join } from "node:path";

export type Environment = "prod" | "dev" | "staging";

export async function runDeploy(
  environment?: string,
  options?: { withDemo?: boolean; yes?: boolean },
): Promise<void> {
  const config = await loadConfig();
  const env = environment ?? config.defaultEnvironment;
  const platformDir = resolvePlatformDir(config.platformDir);

  if (!(await isPlatformInstalled(config.platformDir))) {
    console.error("Platform not installed. Run: industream install");
    process.exit(1);
  }

  // Resolve license-based filters (same logic as install)
  const deployFlags = await getDeployFlags(platformDir);
  const plan = deployFlags.plan as "community" | "trial" | "pro" | "enterprise";

  // Ensure registry login (community = embedded robot, premium = license creds)
  const dockerRegistry = "842775dh.c1.gra9.container-registry.ovh.net";
  await ensureRegistryLogin(dockerRegistry, plan);

  const args = ["--env", env];
  if (options?.withDemo) {
    args.push("--with-demo");
  }
  if (deployFlags.excludedServices.length > 0) {
    args.push("--exclude", deployFlags.excludedServices.join(","));
  }
  if (plan === "community") {
    args.push("--community");
  }

  const scriptPath = join(platformDir, "scripts", "deploy-swarm.sh");

  await execa(scriptPath, args, {
    cwd: platformDir,
    stdio: "inherit",
  });
}
