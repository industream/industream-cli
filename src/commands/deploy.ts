// src/commands/deploy.ts
import { execa } from "execa";
import { createInterface } from "node:readline";
import { loadConfig } from "../lib/config.js";
import { resolvePlatformDir, isPlatformInstalled } from "../lib/swarm-repo.js";
import { getDeployFlags } from "../lib/stack-filter.js";
import { ensureRegistryLogin } from "../lib/registry-login.js";
import { join } from "node:path";

export type Environment = "prod" | "dev" | "staging";

const ENVIRONMENTS: Environment[] = ["prod", "dev", "staging"];

async function listDeployedStacks(): Promise<string[]> {
  try {
    const { stdout } = await execa("docker", [
      "stack",
      "ls",
      "--format",
      "{{.Name}}",
    ]);
    return stdout.split("\n").filter((s) => s.startsWith("industream-"));
  } catch {
    return [];
  }
}

async function promptEnvironment(deployed: string[]): Promise<Environment> {
  console.log("");
  console.log("  \x1b[1mSelect environment to deploy:\x1b[0m");
  console.log("");
  ENVIRONMENTS.forEach((env, index) => {
    const stackName = `industream-${env}`;
    const status = deployed.includes(stackName)
      ? "\x1b[33m(redeploy)\x1b[0m"
      : "\x1b[32m(new)\x1b[0m";
    console.log(`    ${index + 1}) ${env.padEnd(10)} ${status}`);
  });
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("  Your choice [1-3]: ", (answer) => {
      rl.close();
      const choice = parseInt(answer.trim(), 10);
      if (choice >= 1 && choice <= ENVIRONMENTS.length) {
        resolve(ENVIRONMENTS[choice - 1]);
      } else {
        console.log(`  Invalid choice, defaulting to: prod`);
        resolve("prod");
      }
    });
  });
}

export async function runDeploy(
  environment?: string,
  options?: { withDemo?: boolean; yes?: boolean },
): Promise<void> {
  const config = await loadConfig();
  const platformDir = resolvePlatformDir(config.platformDir);

  if (!(await isPlatformInstalled(config.platformDir))) {
    console.error("Platform not installed. Run: industream install");
    process.exit(1);
  }

  // Choose environment: explicit arg > interactive prompt
  let env = environment;
  if (!env) {
    const deployed = await listDeployedStacks();
    env = await promptEnvironment(deployed);
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
