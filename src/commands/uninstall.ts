// src/commands/uninstall.ts
import { createInterface } from "node:readline";
import { execa } from "execa";
import { loadConfig } from "../lib/config.js";

export async function runUninstall(environment?: string): Promise<void> {
  const config = await loadConfig();
  const env = environment ?? config.defaultEnvironment;
  const stackName = `industream-${env}`;

  console.log("");
  console.log("  \x1b[1mUninstall Industream\x1b[0m");
  console.log("");
  console.log(`  Stack:          ${stackName}`);
  console.log(`  Environment:    ${env}`);
  console.log("  Docker secrets: will be removed for this environment");
  console.log("");

  const confirmed = await askConfirmation(
    `  Remove "${stackName}" and its secrets? (y/N) `,
  );

  if (!confirmed) {
    console.log("  Aborted.");
    return;
  }

  await removeStack(stackName);
  await removeSecrets(stackName);

  console.log("");
  console.log(`  ${stackName} has been removed.`);
  console.log("");
}

function askConfirmation(prompt: string): Promise<boolean> {
  return new Promise((resolve) => {
    const readline = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    readline.question(prompt, (answer) => {
      readline.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function removeStack(stackName: string): Promise<void> {
  console.log(`  Removing stack ${stackName}...`);
  try {
    await execa("docker", ["stack", "rm", stackName], { stdio: "inherit" });
  } catch {
    console.warn(`  Warning: could not remove stack ${stackName}.`);
  }
}

async function removeSecrets(stackName: string): Promise<void> {
  console.log("  Removing Docker secrets...");
  try {
    const { stdout } = await execa("docker", ["secret", "ls", "--format", "{{.Name}}"]);
    const secrets = stdout
      .split("\n")
      .filter((name) => name.startsWith(`${stackName}_`));

    if (secrets.length === 0) {
      console.log("  No secrets found for this environment.");
      return;
    }

    await execa("docker", ["secret", "rm", ...secrets]);
    console.log(`  Removed ${secrets.length} secret(s).`);
  } catch {
    console.warn("  Warning: could not remove secrets.");
  }
}
