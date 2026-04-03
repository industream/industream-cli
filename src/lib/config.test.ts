// src/lib/config.test.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadConfig, saveConfig, getConfigDir, type IndustreamConfig } from "./config.js";

describe("config", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "industream-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("returns default config when no file exists", async () => {
    const config = await loadConfig(tempDir);
    expect(config.platformDir).toBe("~/industream-platform");
    expect(config.defaultEnvironment).toBe("prod");
  });

  it("saves and loads config", async () => {
    const config: IndustreamConfig = {
      platformDir: "/opt/industream",
      defaultEnvironment: "dev",
      domain: "test.industream.lan",
    };
    await saveConfig(config, tempDir);
    const loaded = await loadConfig(tempDir);
    expect(loaded.domain).toBe("test.industream.lan");
    expect(loaded.defaultEnvironment).toBe("dev");
  });

  it("creates config directory if missing", async () => {
    const nested = join(tempDir, "nested", ".industream");
    await saveConfig({ platformDir: "~/industream-platform", defaultEnvironment: "prod" }, nested);
    const loaded = await loadConfig(nested);
    expect(loaded.platformDir).toBe("~/industream-platform");
  });
});
