// src/lib/docker.ts
import { execa } from "execa";
import { existsSync } from "node:fs";

// Find docker binary — may not be in PATH (e.g. inside sg session)
function findDocker(): string {
  // Prefer absolute paths so we work even when PATH is stripped
  const absolutePaths = [
    "/usr/bin/docker",
    "/usr/local/bin/docker",
    "/snap/bin/docker",
  ];
  for (const candidate of absolutePaths) {
    if (existsSync(candidate)) return candidate;
  }
  // Fall back to PATH resolution
  return "docker";
}

const DOCKER = findDocker();

export interface SwarmService {
  name: string;
  fullName: string;
  replicas: string;
  image: string;
  imageName: string;
  version: string;
  isRunning: boolean;
  uptime?: string;
  latestVersion?: string;
}

// Extract the image name (last path segment, without tag/digest)
// e.g. "842775dh.c1.gra9.container-registry.ovh.net/flowmaker.core/cdn-cache:2.0.2" → "cdn-cache"
export function parseImageName(image: string): string {
  const withoutTag = image.split("@")[0].split(":")[0];
  const segments = withoutTag.split("/");
  return segments.at(-1) ?? "";
}

// Format a duration in seconds to a human-readable uptime
export function formatUptime(seconds: number): string {
  if (seconds < 0) return "-";
  if (seconds < 60) return `${Math.floor(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`;
  return `${Math.floor(seconds / 86400)}d`;
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
        imageName: parseImageName(image),
        version: parseImageVersion(image),
        isRunning: running > 0 && running === total,
      };
    });
}

export function parseImageVersion(image: string): string {
  const parts = image.split(":");
  return parts.length > 1 ? parts[parts.length - 1] : "latest";
}

// Parse `docker compose ps --format json` (NDJSON or a JSON array) into the
// same SwarmService shape the dashboard consumes. Compose has no replicas, so
// State drives isRunning and a synthetic "1/1"/"0/1".
export function parseComposePs(output: string): SwarmService[] {
  const text = output.trim();
  if (!text) return [];
  let rows: Array<Record<string, unknown>>;
  try {
    const parsed = JSON.parse(text);
    rows = Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    rows = text
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  }
  return rows.map((row) => {
    const image = String(row.Image ?? "");
    const running = String(row.State ?? "").toLowerCase() === "running";
    return {
      name: String(row.Service ?? row.Name ?? ""),
      fullName: String(row.Name ?? ""),
      replicas: running ? "1/1" : "0/1",
      image,
      imageName: parseImageName(image),
      version: parseImageVersion(image),
      isRunning: running,
      uptime: row.Status ? String(row.Status) : undefined,
    };
  });
}

// Compose equivalent of getSwarmServices, keyed by the project name (= env).
export async function getComposeServices(project: string): Promise<SwarmService[]> {
  const { stdout } = await execa(DOCKER, [
    "compose",
    "-p",
    project,
    "ps",
    "--all",
    "--format",
    "json",
  ]);
  return parseComposePs(stdout);
}

export async function getSwarmServices(
  stackName: string,
): Promise<SwarmService[]> {
  const { stdout } = await execa(DOCKER, [
    "stack",
    "services",
    stackName,
    "--format",
    "{{.Name}} {{.Replicas}} {{.Image}}",
  ]);
  const services = parseServiceList(stdout, stackName);

  // Fetch uptime for each running service via docker service ps
  await Promise.all(
    services.map(async (service) => {
      if (!service.isRunning) return;
      try {
        const { stdout: psOutput } = await execa(DOCKER, [
          "service",
          "ps",
          service.fullName,
          "--filter",
          "desired-state=running",
          "--format",
          "{{.CurrentState}}",
          "--no-trunc",
        ]);
        // "Running 2 hours ago" → extract the duration
        const match = psOutput.split("\n")[0]?.match(/Running (.+) ago/);
        if (match) {
          service.uptime = match[1].trim();
        }
      } catch {
        // ignore
      }
    }),
  );

  return services;
}

export async function isSwarmActive(): Promise<boolean> {
  try {
    const { stdout } = await execa(DOCKER, [
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
    await execa(DOCKER, ["version", "--format", "{{.Server.Version}}"]);
    return true;
  } catch (err) {
    if (process.env.INDUSTREAM_DEBUG) {
      console.error(
        `[debug] isDockerAvailable failed with DOCKER=${DOCKER}:`,
        err instanceof Error ? err.message : err,
      );
    }
    return false;
  }
}

export async function getServiceLogs(
  serviceName: string,
  tail = 100,
): Promise<string> {
  const { stdout } = await execa(DOCKER, [
    "service",
    "logs",
    "--tail",
    String(tail),
    "--no-trunc",
    serviceName,
  ]);
  return stdout;
}
