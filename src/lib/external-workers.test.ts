// src/lib/external-workers.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import yaml from "js-yaml";
import {
  loadWorkerManifest,
  validateManifest,
  generateStackYaml,
  listInstalledWorkers,
  removeWorker,
  type WorkerManifest,
} from "./external-workers.js";

const VALID_MANIFEST: WorkerManifest = {
  apiVersion: "industream.com/v1",
  kind: "Worker",
  metadata: {
    name: "custom-pid-controller",
    version: "1.0.0",
    author: "Bernegger GmbH",
    description: "PID controller for blast furnace",
  },
  spec: {
    image: {
      ref: "registry.example.com/workers/pid:1.0.0",
    },
    resources: {
      limits: {
        cpus: "0.5",
        memory: "256M",
      },
    },
    environment: {
      CUSTOM_VAR: "value",
    },
    replicas: 1,
  },
};

describe("external-workers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "industream-worker-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  describe("validateManifest", () => {
    it("accepts a valid manifest", () => {
      const result = validateManifest(VALID_MANIFEST);
      expect(result.metadata.name).toBe("custom-pid-controller");
      expect(result.metadata.version).toBe("1.0.0");
    });

    it("rejects non-object input", () => {
      expect(() => validateManifest("string")).toThrow("must be a YAML object");
    });

    it("rejects wrong apiVersion", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, apiVersion: "v2" })).toThrow(
        "Unsupported apiVersion",
      );
    });

    it("rejects wrong kind", () => {
      expect(() => validateManifest({ ...VALID_MANIFEST, kind: "Service" })).toThrow(
        "Expected kind 'Worker'",
      );
    });

    it("rejects missing metadata.name", () => {
      const manifest = {
        ...VALID_MANIFEST,
        metadata: { ...VALID_MANIFEST.metadata, name: "" },
      };
      expect(() => validateManifest(manifest)).toThrow("metadata.name");
    });

    it("rejects missing metadata.version", () => {
      const manifest = {
        ...VALID_MANIFEST,
        metadata: { ...VALID_MANIFEST.metadata, version: "" },
      };
      expect(() => validateManifest(manifest)).toThrow("metadata.version");
    });

    it("rejects missing metadata.author", () => {
      const manifest = {
        ...VALID_MANIFEST,
        metadata: { ...VALID_MANIFEST.metadata, author: "" },
      };
      expect(() => validateManifest(manifest)).toThrow("metadata.author");
    });

    it("rejects missing image strategy", () => {
      const manifest = {
        ...VALID_MANIFEST,
        spec: { ...VALID_MANIFEST.spec, image: {} },
      };
      expect(() => validateManifest(manifest)).toThrow("ref, file, dockerfile");
    });

    it("rejects missing spec section", () => {
      const { spec: _, ...noSpec } = VALID_MANIFEST;
      expect(() => validateManifest(noSpec)).toThrow("Missing 'spec' section");
    });

    it("rejects missing metadata section", () => {
      const { metadata: _, ...noMeta } = VALID_MANIFEST;
      expect(() => validateManifest(noMeta)).toThrow("Missing 'metadata' section");
    });
  });

  describe("loadWorkerManifest", () => {
    it("loads a valid manifest from a directory", async () => {
      await writeFile(join(tempDir, "industream.yaml"), yaml.dump(VALID_MANIFEST));
      const manifest = await loadWorkerManifest(tempDir);
      expect(manifest.metadata.name).toBe("custom-pid-controller");
    });

    it("throws when industream.yaml is missing", async () => {
      await expect(loadWorkerManifest(tempDir)).rejects.toThrow();
    });

    it("throws on invalid manifest content", async () => {
      await writeFile(join(tempDir, "industream.yaml"), "apiVersion: v99\nkind: Unknown\n");
      await expect(loadWorkerManifest(tempDir)).rejects.toThrow();
    });
  });

  describe("generateStackYaml", () => {
    it("generates valid stack YAML with all fields", () => {
      const output = generateStackYaml(VALID_MANIFEST, "registry.example.com/workers/pid:1.0.0");
      const parsed = yaml.load(output) as Record<string, unknown>;

      expect(parsed).toHaveProperty("services");
      const services = parsed.services as Record<string, Record<string, unknown>>;
      const service = services["custom-pid-controller"];

      expect(service.image).toBe("registry.example.com/workers/pid:1.0.0");
      expect(service.networks).toEqual(["${ENV}-platform"]);

      const environment = service.environment as Record<string, string>;
      expect(environment.WORKER_NAME).toBe("custom-pid-controller");
      expect(environment.CONFIGHUB_URL).toBe("http://flowmaker-confighub:4000");
      expect(environment.CUSTOM_VAR).toBe("value");

      const deploy = service.deploy as Record<string, unknown>;
      expect(deploy.replicas).toBe(1);

      const labels = deploy.labels as string[];
      expect(labels).toContain("industream.external=true");
      expect(labels).toContain("industream.worker.name=custom-pid-controller");
      expect(labels).toContain("industream.worker.version=1.0.0");
      expect(labels).toContain("industream.worker.author=Bernegger GmbH");

      const resources = deploy.resources as Record<string, Record<string, string>>;
      expect(resources.limits.cpus).toBe("0.5");
      expect(resources.limits.memory).toBe("256M");

      const restartPolicy = deploy.restart_policy as Record<string, string>;
      expect(restartPolicy.condition).toBe("any");
    });

    it("uses default replicas when not specified", () => {
      const manifest: WorkerManifest = {
        ...VALID_MANIFEST,
        spec: {
          ...VALID_MANIFEST.spec,
          replicas: undefined,
        },
      };
      const output = generateStackYaml(manifest, "test:latest");
      const parsed = yaml.load(output) as Record<string, unknown>;
      const services = parsed.services as Record<string, Record<string, unknown>>;
      const deploy = services["custom-pid-controller"].deploy as Record<string, unknown>;
      expect(deploy.replicas).toBe(1);
    });

    it("omits resource limits when not specified", () => {
      const manifest: WorkerManifest = {
        ...VALID_MANIFEST,
        spec: {
          ...VALID_MANIFEST.spec,
          resources: undefined,
        },
      };
      const output = generateStackYaml(manifest, "test:latest");
      const parsed = yaml.load(output) as Record<string, unknown>;
      const services = parsed.services as Record<string, Record<string, unknown>>;
      const deploy = services["custom-pid-controller"].deploy as Record<string, unknown>;
      expect(deploy.resources).toBeUndefined();
    });
  });

  describe("listInstalledWorkers", () => {
    it("returns empty array when external-workers directory does not exist", async () => {
      const workers = await listInstalledWorkers(tempDir);
      expect(workers).toEqual([]);
    });

    it("lists workers from external-workers directory", async () => {
      const workerDir = join(tempDir, "external-workers", "test-worker");
      await mkdir(workerDir, { recursive: true });
      await writeFile(join(workerDir, "industream.yaml"), yaml.dump(VALID_MANIFEST));

      const workers = await listInstalledWorkers(tempDir);
      expect(workers).toHaveLength(1);
      expect(workers[0].name).toBe("custom-pid-controller");
      expect(workers[0].version).toBe("1.0.0");
      expect(workers[0].author).toBe("Bernegger GmbH");
    });

    it("handles corrupted manifest gracefully", async () => {
      const workerDir = join(tempDir, "external-workers", "broken-worker");
      await mkdir(workerDir, { recursive: true });
      await writeFile(join(workerDir, "industream.yaml"), "not valid yaml: [");

      const workers = await listInstalledWorkers(tempDir);
      expect(workers).toHaveLength(1);
      expect(workers[0].name).toBe("broken-worker");
      expect(workers[0].status).toBe("unknown");
    });
  });

  describe("removeWorker", () => {
    it("removes an installed worker directory", async () => {
      const workerDir = join(tempDir, "external-workers", "test-worker");
      await mkdir(workerDir, { recursive: true });
      await writeFile(join(workerDir, "industream.yaml"), yaml.dump(VALID_MANIFEST));

      await removeWorker("test-worker", tempDir);

      await expect(readFile(join(workerDir, "industream.yaml"))).rejects.toThrow();
    });

    it("throws when worker does not exist", async () => {
      await expect(removeWorker("nonexistent", tempDir)).rejects.toThrow(
        "Worker 'nonexistent' is not installed",
      );
    });
  });
});
