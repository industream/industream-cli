// src/lib/external-workers.ts
import { readFile, writeFile, mkdir, readdir, rm, access } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import yaml from "js-yaml";
import { execa } from "execa";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkerManifest {
  apiVersion: string;
  kind: "Worker";
  metadata: {
    name: string;
    version: string;
    author: string;
    description?: string;
  };
  spec: {
    image: {
      ref?: string;
      file?: string;
      dockerfile?: string;
    };
    resources?: {
      limits?: {
        cpus?: string;
        memory?: string;
      };
    };
    environment?: Record<string, string>;
    replicas?: number;
  };
}

export interface InstalledWorker {
  name: string;
  version: string;
  author: string;
  description: string;
  status: "running" | "stopped" | "unknown";
}

// ---------------------------------------------------------------------------
// Docker binary resolution (mirrors docker.ts)
// ---------------------------------------------------------------------------

function findDocker(): string {
  const candidates = ["/usr/bin/docker", "/usr/local/bin/docker", "/snap/bin/docker"];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return "docker";
}

const DOCKER = findDocker();

// ---------------------------------------------------------------------------
// Manifest loading & validation
// ---------------------------------------------------------------------------

export function validateManifest(data: unknown): WorkerManifest {
  if (typeof data !== "object" || data === null) {
    throw new Error("Manifest must be a YAML object");
  }

  const manifest = data as Record<string, unknown>;

  if (manifest.apiVersion !== "industream.com/v1") {
    throw new Error(`Unsupported apiVersion: ${String(manifest.apiVersion)}`);
  }

  if (manifest.kind !== "Worker") {
    throw new Error(`Expected kind 'Worker', got: ${String(manifest.kind)}`);
  }

  const metadata = manifest.metadata as Record<string, unknown> | undefined;
  if (!metadata || typeof metadata !== "object") {
    throw new Error("Missing 'metadata' section");
  }

  if (!metadata.name || typeof metadata.name !== "string") {
    throw new Error("Missing required field: metadata.name");
  }
  if (!metadata.version || typeof metadata.version !== "string") {
    throw new Error("Missing required field: metadata.version");
  }
  if (!metadata.author || typeof metadata.author !== "string") {
    throw new Error("Missing required field: metadata.author");
  }

  const spec = manifest.spec as Record<string, unknown> | undefined;
  if (!spec || typeof spec !== "object") {
    throw new Error("Missing 'spec' section");
  }

  const image = spec.image as Record<string, unknown> | undefined;
  if (!image || typeof image !== "object") {
    throw new Error("Missing 'spec.image' section");
  }

  const hasStrategy = image.ref || image.file || image.dockerfile;
  if (!hasStrategy) {
    throw new Error("spec.image must have one of: ref, file, dockerfile");
  }

  return data as WorkerManifest;
}

export async function loadWorkerManifest(workerPath: string): Promise<WorkerManifest> {
  const manifestPath = join(resolve(workerPath), "industream.yaml");
  const content = await readFile(manifestPath, "utf-8");
  const data = yaml.load(content);
  return validateManifest(data);
}

// ---------------------------------------------------------------------------
// Image import
// ---------------------------------------------------------------------------

export async function importWorkerImage(
  manifest: WorkerManifest,
  workerDir: string,
): Promise<string> {
  const { image } = manifest.spec;

  if (image.ref) {
    // Pre-existing registry image — just pull it
    await execa(DOCKER, ["pull", image.ref]);
    return image.ref;
  }

  if (image.file) {
    // Load from tar.gz archive
    const archivePath = join(workerDir, image.file);
    const { stdout } = await execa(DOCKER, ["load", "-i", archivePath]);
    // docker load outputs "Loaded image: <name:tag>"
    const match = stdout.match(/Loaded image:\s*(.+)/);
    if (!match) {
      throw new Error(`Failed to parse loaded image name from: ${stdout}`);
    }
    return match[1].trim();
  }

  if (image.dockerfile) {
    // Build from Dockerfile
    const tag = `industream-worker/${manifest.metadata.name}:${manifest.metadata.version}`;
    const dockerfilePath = join(workerDir, image.dockerfile);
    await execa(DOCKER, ["build", "-t", tag, "-f", dockerfilePath, workerDir]);
    return tag;
  }

  throw new Error("No valid image strategy found in manifest");
}

// ---------------------------------------------------------------------------
// Stack YAML generation
// ---------------------------------------------------------------------------

export function generateStackYaml(manifest: WorkerManifest, imageName: string): string {
  const { metadata, spec } = manifest;

  const service: Record<string, unknown> = {
    image: imageName,
    networks: ["${ENV}-platform"],
    environment: {
      WORKER_NAME: metadata.name,
      CONFIGHUB_URL: "http://flowmaker-confighub:4000",
      ...(spec.environment ?? {}),
    },
    deploy: {
      replicas: spec.replicas ?? 1,
      labels: [
        "industream.external=true",
        `industream.worker.name=${metadata.name}`,
        `industream.worker.version=${metadata.version}`,
        `industream.worker.author=${metadata.author}`,
      ],
      restart_policy: {
        condition: "any",
      },
    } as Record<string, unknown>,
  };

  if (spec.resources?.limits) {
    const deploy = service.deploy as Record<string, unknown>;
    deploy.resources = { limits: { ...spec.resources.limits } };
  }

  const stack = {
    services: {
      [metadata.name]: service,
    },
  };

  return yaml.dump(stack, {
    lineWidth: 120,
    noRefs: true,
    quotingType: "'",
    forceQuotes: false,
  });
}

// ---------------------------------------------------------------------------
// Install flow
// ---------------------------------------------------------------------------

export async function installWorker(
  workerPath: string,
  platformDir: string,
): Promise<WorkerManifest> {
  const resolvedPath = resolve(workerPath);
  const manifest = await loadWorkerManifest(resolvedPath);

  const externalWorkersDir = join(platformDir, "external-workers");
  const workerInstallDir = join(externalWorkersDir, manifest.metadata.name);

  // Create directory
  await mkdir(workerInstallDir, { recursive: true });

  // Import image
  const resolvedImage = await importWorkerImage(manifest, resolvedPath);

  // Generate stack YAML
  const stackYaml = generateStackYaml(manifest, resolvedImage);
  await writeFile(
    join(workerInstallDir, "docker-stack.external.yml"),
    stackYaml,
  );

  // Copy manifest for reference
  const manifestContent = await readFile(join(resolvedPath, "industream.yaml"), "utf-8");
  await writeFile(join(workerInstallDir, "industream.yaml"), manifestContent);

  return manifest;
}

// ---------------------------------------------------------------------------
// List installed workers
// ---------------------------------------------------------------------------

export async function listInstalledWorkers(platformDir: string): Promise<InstalledWorker[]> {
  const externalWorkersDir = join(platformDir, "external-workers");

  try {
    await access(externalWorkersDir);
  } catch {
    return [];
  }

  const entries = await readdir(externalWorkersDir, { withFileTypes: true });
  const workers: InstalledWorker[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifestPath = join(externalWorkersDir, entry.name, "industream.yaml");
    try {
      const content = await readFile(manifestPath, "utf-8");
      const data = yaml.load(content) as WorkerManifest;
      const status = await getWorkerStatus(data.metadata.name);
      workers.push({
        name: data.metadata.name,
        version: data.metadata.version,
        author: data.metadata.author,
        description: data.metadata.description ?? "",
        status,
      });
    } catch {
      workers.push({
        name: entry.name,
        version: "unknown",
        author: "unknown",
        description: "",
        status: "unknown",
      });
    }
  }

  return workers;
}

async function getWorkerStatus(name: string): Promise<"running" | "stopped" | "unknown"> {
  try {
    const { stdout } = await execa(DOCKER, [
      "service",
      "ls",
      "--filter",
      `label=industream.worker.name=${name}`,
      "--format",
      "{{.Replicas}}",
    ]);
    if (!stdout.trim()) return "stopped";
    const [running] = stdout.trim().split("/").map(Number);
    return running > 0 ? "running" : "stopped";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Remove worker
// ---------------------------------------------------------------------------

export async function removeWorker(name: string, platformDir: string): Promise<void> {
  const workerDir = join(platformDir, "external-workers", name);

  try {
    await access(workerDir);
  } catch {
    throw new Error(`Worker '${name}' is not installed`);
  }

  await rm(workerDir, { recursive: true, force: true });
}
