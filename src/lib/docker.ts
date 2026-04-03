// src/lib/docker.ts
import { execa } from "execa";

export interface SwarmService {
  name: string;
  fullName: string;
  replicas: string;
  image: string;
  version: string;
  isRunning: boolean;
}

export function parseServiceList(
  output: string,
  stackName: string,
): SwarmService[] {
  const prefix = `${stackName}_`;
  return output
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => {
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
        version: parseImageVersion(image),
        isRunning: running > 0 && running === total,
      };
    });
}

export function parseImageVersion(image: string): string {
  const parts = image.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : "latest";
}

export async function getSwarmServices(
  stackName: string,
): Promise<SwarmService[]> {
  const { stdout } = await execa("docker", [
    "stack",
    "services",
    stackName,
    "--format",
    "{{.Name}} {{.Replicas}} {{.Image}}",
  ]);
  return parseServiceList(stdout, stackName);
}

export async function isSwarmActive(): Promise<boolean> {
  try {
    const { stdout } = await execa("docker", [
      "info",
      "--format",
      "{{.Swarm.LocalNodeState}}",
    ]);
    return stdout.trim() === "active";
  } catch {
    return false;
  }
}

export async function isDockerAvailable(): Promise<boolean> {
  try {
    await execa("docker", ["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch {
    return false;
  }
}

export async function getServiceLogs(
  serviceName: string,
  tail = 100,
): Promise<string> {
  const { stdout } = await execa("docker", [
    "service",
    "logs",
    "--tail",
    String(tail),
    "--no-trunc",
    serviceName,
  ]);
  return stdout;
}
