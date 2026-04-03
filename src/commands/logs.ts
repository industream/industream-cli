// src/commands/logs.ts
import { execa } from "execa";
import { loadConfig } from "../lib/config.js";

export async function runLogs(
  service?: string,
  options?: { follow?: boolean; tail?: number },
): Promise<void> {
  const config = await loadConfig();
  const stackName = `industream-${config.defaultEnvironment}`;
  const serviceName = service
    ? `${stackName}_${service}`
    : stackName;

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
  if (options?.follow) args.push("-f");
  args.push("--tail", String(options?.tail ?? 100));
  args.push(serviceName);

  await execa("docker", args, { stdio: "inherit" });
}
