// src/lib/secrets/swarm.ts
// Swarm-backed SecretsBackend. Wraps the `docker secret` CLI and the
// shell script `scripts/setup/create-secrets.sh` that already exists in
// the platform repo. Reading back a secret value is unsupported: the
// Swarm raft store only exposes secrets to running containers.
import { execa } from "execa";
import { join } from "node:path";
import type { IndustreamConfig } from "../config.js";
import { resolvePlatformDir } from "../swarm-repo.js";
import type { SecretDescriptor, SecretsBackend } from "./index.js";

const CREATE_SECRETS_SCRIPT = "scripts/setup/create-secrets.sh";

export class SwarmSecrets implements SecretsBackend {
  public readonly name = "swarm" as const;

  constructor(private readonly config: IndustreamConfig) {}

  /**
   * List Swarm secrets whose name starts with `${env}_`. Returns them
   * with the prefix stripped so that callers can address secrets by
   * their short name. A failure of `docker secret ls` (daemon down,
   * not a swarm manager, ...) surfaces as an empty list — individual
   * lookups via `exists()` will still fail loudly.
   */
  async list(env: string): Promise<SecretDescriptor[]> {
    const prefix = `${env}_`;
    let stdout = "";
    try {
      const result = await execa("docker", [
        "secret",
        "ls",
        "--format",
        "{{.Name}}",
      ]);
      stdout = result.stdout;
    } catch {
      return [];
    }

    return stdout
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.startsWith(prefix))
      .map((fullName): SecretDescriptor => ({
        name: fullName.slice(prefix.length),
        env,
        exists: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Regenerate every secret for `env` by delegating to the platform's
   * create-secrets shell script. The script is idempotent and already
   * handles skipping existing secrets when `--regenerate` is absent.
   */
  async regenerate(env: string): Promise<void> {
    const platformDir = resolvePlatformDir(this.config.platformDir);
    const scriptPath = join(platformDir, CREATE_SECRETS_SCRIPT);

    await execa(scriptPath, ["--env", env], {
      cwd: platformDir,
      stdio: "inherit",
    });
  }

  /**
   * Swarm secrets cannot be read back once created: the raft store only
   * mounts them into running containers. Callers that need the value
   * must rotate the secret instead.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async show(_name: string, _env: string): Promise<string> {
    throw new Error("Swarm secrets cannot be read back — rotate instead");
  }

  /**
   * Return true when `docker secret inspect` finds `${env}_${name}`.
   * We use `inspect` (not `ls | grep`) so that name collisions (e.g.
   * "prod_pg" vs "prod_pg_replica") don't produce false positives.
   */
  async exists(name: string, env: string): Promise<boolean> {
    const fullName = `${env}_${name}`;
    try {
      await execa("docker", ["secret", "inspect", fullName], {
        stdio: "ignore",
      });
      return true;
    } catch {
      return false;
    }
  }
}
