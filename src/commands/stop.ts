// src/commands/stop.ts
import { execa } from "execa";
import { createInterface } from "node:readline";
import { loadConfig } from "../lib/config.js";

/**
 * Bring an environment down — removes all Swarm services in the stack.
 * Volumes, secrets, and networks are preserved so that a subsequent
 * `industream deploy` restores the environment with its data intact.
 */
export async function runDown(environment?: string): Promise<void> {
  const config = await loadConfig();
  const env = environment ?? config.defaultEnvironment;
  const stackName = `industream-${env}`;

  console.log("");
  console.log(`  \x1b[1;33m⚠  This will remove all running services in ${stackName}\x1b[0m`);
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
  console.log("  Run \x1b[1mindustream deploy\x1b[0m afterwards to bring the environment back up.");
  console.log("");

  const confirmed = await confirm(`  Stop ${stackName}? [y/N]: `);
  if (!confirmed) {
    console.log("  Aborted.");
    return;
  }

  console.log("");
  console.log(`  Stopping ${stackName}...`);
  await execa("docker", ["stack", "rm", stackName], { stdio: "inherit" });
  console.log(`  \x1b[32m✓\x1b[0m ${stackName} stopped (data preserved)`);
}

// Backward-compat alias: old `stop` command still works
export const runStop = runDown;

async function confirm(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
