// src/commands/stop.ts
import { execa } from "execa";
import { loadConfig } from "../lib/config.js";

export async function runStop(environment?: string): Promise<void> {
  const config = await loadConfig();
  const env = environment ?? config.defaultEnvironment;
  const stackName = `industream-${env}`;

  console.log(`Stopping ${stackName}...`);

  await execa("docker", ["stack", "rm", stackName], {
    stdio: "inherit",
  });

  console.log(`${stackName} stopped.`);
}
