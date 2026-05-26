// src/lib/runtimes/swarm.ts
// SwarmRuntime — replicates the existing behavior of
// `commands/deploy.ts`, `commands/stop.ts`, `commands/logs.ts` and the
// Swarm code path of `commands/status.tsx`, extracted verbatim behind the
// Runtime abstraction. No behavioral change is intended here; the existing
// commands can be switched to this runtime in a follow-up.
import { execa } from "execa";
import { createInterface } from "node:readline";
import { join } from "node:path";
import type { IndustreamConfig } from "../config.js";
import {
  resolvePlatformDir,
  isPlatformInstalled,
  loadEnvFile,
} from "../swarm-repo.js";
import { getDeployFlags } from "../stack-filter.js";
import {
  ensureRegistryLogin,
  getRegistryForPlan,
} from "../registry-login.js";
import { SwarmSecrets } from "../secrets/swarm.js";
import type { SecretsBackend } from "../secrets/index.js";
import type {
  DeployOptions,
  Environment,
  LogsOptions,
  Runtime,
  RuntimeName,
  ServiceStatus,
  StackStatus,
} from "./index.js";

const SWARM_ENVIRONMENTS: Environment[] = ["prod", "dev", "staging"];

export class SwarmRuntime implements Runtime {
  public readonly name: RuntimeName = "swarm";
  public readonly secrets: SecretsBackend;

  constructor(private readonly config: IndustreamConfig) {
    this.secrets = new SwarmSecrets(config);
  }

  /**
   * Deploy the Swarm stack for `env`. Mirrors the logic currently in
   * `commands/deploy.ts#runDeploy` (lines 60-141).
   */
  async deploy(
    environment: Environment | undefined,
    options: DeployOptions = {},
  ): Promise<void> {
    const platformDir = resolvePlatformDir(this.config.platformDir);

    if (!(await isPlatformInstalled(this.config.platformDir))) {
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
    const plan = deployFlags.plan as
      | "community"
      | "trial"
      | "pro"
      | "enterprise";

    // Pick the right Harbor per plan: community pulls from the public Harbor
    // (anonymous, no login), everything else authenticates to the premium
    // Harbor with the Keygen-provided credentials.
    const registry = getRegistryForPlan(plan);
    await ensureRegistryLogin(registry, plan);

    // Regenerate domain-dependent configs (self-signed certs + UIFusion JSON).
    // This ensures any change to INDUSTREAM_DOMAIN or TLS_MODE in .env is picked
    // up on the next deploy — otherwise UIFusion keeps pointing to the old URL
    // and self-signed certs stay on the old hostname.
    const envVars = await loadEnvFile(this.config.platformDir);
    const tlsMode = envVars.TLS_MODE ?? "selfsigned";

    if (tlsMode === "selfsigned") {
      console.log(
        `\n  Regenerating self-signed certificates for ${envVars.INDUSTREAM_DOMAIN ?? "default domain"}...`,
      );
      await execa(join(platformDir, "scripts/generate/generate-certs.sh"), [], {
        cwd: platformDir,
        stdio: "inherit",
      }).catch((err) => {
        console.log(
          `  Could not regenerate certs: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    console.log(`\n  Regenerating UIFusion configuration for ${env}...`);
    await execa(
      join(platformDir, "scripts/generate/generate-uifusion-config.sh"),
      ["--force", "--env", env],
      { cwd: platformDir, stdio: "inherit" },
    ).catch((err) => {
      console.log(
        `  Could not regenerate UIFusion config: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    // Create secrets if they don't exist for this environment
    console.log(`\n  Creating secrets for ${env}...`);
    await execa(
      join(platformDir, "scripts/setup/create-secrets.sh"),
      ["--env", env],
      { cwd: platformDir, stdio: "inherit" },
    ).catch(() => {
      console.log(
        "  Secrets may already exist or script not found — continuing.",
      );
    });

    const args = ["--env", env];
    if (options.withDemo) {
      args.push("--with-demo");
    }
    if (deployFlags.excludedServices.length > 0) {
      args.push("--exclude", deployFlags.excludedServices.join(","));
    }
    if (plan === "community") {
      args.push("--community");
    }
    // Skip memory check in non-interactive CLI mode (no TTY for confirmation prompt)
    args.push("--skip-memory-check");

    const scriptPath = join(platformDir, "scripts", "deploy-swarm.sh");

    await execa(scriptPath, args, {
      cwd: platformDir,
      stdio: "inherit",
    });
  }

  /**
   * Bring an environment down — removes all Swarm services in the stack.
   * Mirrors `commands/stop.ts#runDown`. Volumes, secrets and networks are
   * preserved so that a subsequent `deploy` restores the environment with
   * its data intact.
   */
  async down(environment?: Environment): Promise<void> {
    const env = environment ?? this.config.defaultEnvironment;
    const stackName = `industream-${env}`;

    console.log("");
    console.log(
      `  \x1b[1;33m⚠  This will remove all running services in ${stackName}\x1b[0m`,
    );
    console.log("");
    console.log("  The following will be \x1b[31mREMOVED\x1b[0m:");
    console.log("    • All Docker services (containers will stop)");
    console.log("    • Service routing / Traefik labels");
    console.log("");
    console.log("  The following will be \x1b[32mPRESERVED\x1b[0m:");
    console.log("    • Docker volumes (PostgreSQL, InfluxDB, MinIO data)");
    console.log("    • Docker secrets");
    console.log("    • Docker networks");
    console.log("    • Cloned platform files in ~/industream-platform");
    console.log("");
    console.log(
      "  Run \x1b[1mindustream deploy\x1b[0m afterwards to bring the environment back up.",
    );
    console.log("");

    const confirmed = await confirm(`  Stop ${stackName}? [y/N]: `);
    if (!confirmed) {
      console.log("  Aborted.");
      return;
    }

    console.log("");
    console.log(`  Stopping ${stackName}...`);
    await execa("docker", ["stack", "rm", stackName], { stdio: "inherit" });
    console.log(
      `  \x1b[32m✓\x1b[0m ${stackName} stopped (data preserved)`,
    );
  }

  /**
   * Report the current stack status by listing Swarm services filtered by
   * the `com.docker.stack.namespace` label. The TUI dashboard in
   * `commands/status.tsx` keeps its own richer read via `getSwarmServices`
   * — this method exposes the same raw data in the Runtime contract.
   */
  async status(): Promise<StackStatus> {
    const env = this.config.defaultEnvironment;
    const stackName = `industream-${env}`;

    const active = await isStackDeployed(stackName);

    if (!active) {
      return { stackName, active: false, services: [] };
    }

    const services = await listStackServices(stackName);
    return { stackName, active: true, services };
  }

  /**
   * Stream logs for a service. Mirrors `commands/logs.ts#runLogs`. When no
   * service is provided, lists the available services in the current stack.
   */
  async logs(
    service: string | undefined,
    options: LogsOptions = {},
  ): Promise<void> {
    const stackName = `industream-${this.config.defaultEnvironment}`;
    const serviceName = service ? `${stackName}_${service}` : stackName;

    if (!service) {
      // List services and let user pick
      const { stdout } = await execa("docker", [
        "stack",
        "services",
        stackName,
        "--format",
        "{{.Name}}",
      ]);
      console.log("Available services:");
      for (const name of stdout.split("\n").filter(Boolean)) {
        console.log(`  ${name.replace(`${stackName}_`, "")}`);
      }
      console.log("\nUsage: industream logs <service-name>");
      return;
    }

    const args = ["service", "logs"];
    if (options.follow) args.push("-f");
    args.push("--tail", String(options.tail ?? 100));
    args.push(serviceName);

    await execa("docker", args, { stdio: "inherit" });
  }
}

// ---------------------------------------------------------------------------
// Internal helpers (lifted from the original commands unchanged)
// ---------------------------------------------------------------------------

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

async function isStackDeployed(stackName: string): Promise<boolean> {
  const stacks = await listDeployedStacks();
  return stacks.includes(stackName);
}

async function listStackServices(stackName: string): Promise<ServiceStatus[]> {
  const { stdout } = await execa("docker", [
    "service",
    "ls",
    "--filter",
    `label=com.docker.stack.namespace=${stackName}`,
    "--format",
    "{{.Name}} {{.Replicas}} {{.Image}}",
  ]);

  const prefix = `${stackName}_`;
  return stdout
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line): ServiceStatus => {
      const [fullName, replicas, image] = line.split(/\s+/);
      const name = fullName.startsWith(prefix)
        ? fullName.slice(prefix.length)
        : fullName;
      const [running, total] = replicas.split("/").map(Number);
      return {
        name,
        fullName,
        replicas,
        image,
        isRunning: running > 0 && running === total,
      };
    });
}

async function promptEnvironment(deployed: string[]): Promise<Environment> {
  console.log("");
  console.log("  \x1b[1mSelect environment to deploy:\x1b[0m");
  console.log("");
  SWARM_ENVIRONMENTS.forEach((env, index) => {
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
      if (choice >= 1 && choice <= SWARM_ENVIRONMENTS.length) {
        resolve(SWARM_ENVIRONMENTS[choice - 1]);
      } else {
        console.log(`  Invalid choice, defaulting to: prod`);
        resolve("prod");
      }
    });
  });
}

async function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
