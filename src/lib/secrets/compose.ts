// src/lib/secrets/compose.ts
// File-based SecretsBackend for the Compose runtime. Secrets are stored
// one-per-file under `${platformDir}/secrets/`, named `${env}_${shortName}`,
// with strict POSIX permissions (0700 on the directory, 0600 on files).
//
// NOTE (2026-04): the shell script `scripts/setup/create-secrets.sh` does
// not yet accept `--mode compose`. `regenerate()` invokes it with the
// intended flag so that we can land the backend today; a follow-up commit
// will teach the script to handle compose file output. Until then the
// script may fail, which is fine: the error will surface to the caller.
import { execa } from "execa";
import {
  access,
  mkdir,
  readdir,
  readFile,
  stat,
} from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import type { IndustreamConfig } from "../config.js";
import { resolvePlatformDir } from "../swarm-repo.js";
import type { SecretDescriptor, SecretsBackend } from "./index.js";

const SECRETS_SUBDIR = "secrets";
const CREATE_SECRETS_SCRIPT = "scripts/setup/create-secrets.sh";
const DIR_MODE = 0o700;

export class ComposeSecrets implements SecretsBackend {
  public readonly name = "compose" as const;

  constructor(private readonly config: IndustreamConfig) {}

  /**
   * List every secret file named `${env}_*` inside the secrets directory.
   * A missing directory yields an empty list; permission-related errors
   * propagate so the caller sees the real problem.
   */
  async list(env: string): Promise<SecretDescriptor[]> {
    const dir = await this.ensureSecretsDir();
    const prefix = `${env}_`;

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (isNotFound(err)) return [];
      throw err;
    }

    const descriptors: SecretDescriptor[] = [];
    for (const entry of entries) {
      if (!entry.startsWith(prefix)) continue;
      const full = this.resolveSecretPath(dir, entry);
      try {
        const s = await stat(full);
        if (!s.isFile()) continue;
      } catch {
        continue;
      }
      descriptors.push({
        name: entry.slice(prefix.length),
        env,
        exists: true,
      });
    }

    return descriptors.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * Delegate to the platform's create-secrets shell script in compose mode.
   * The script is expected to materialise files under `${platformDir}/secrets/`
   * rather than calling `docker secret create`.
   */
  async regenerate(env: string): Promise<void> {
    const platformDir = resolvePlatformDir(this.config.platformDir);
    const scriptPath = join(platformDir, CREATE_SECRETS_SCRIPT);

    // Make sure the target directory exists with the right permissions
    // before the script writes into it.
    await this.ensureSecretsDir();

    await execa(scriptPath, ["--mode", "compose", "--env", env], {
      cwd: platformDir,
      stdio: "inherit",
    });
  }

  /**
   * Read back the value of `${env}_${name}`. Trailing newlines are
   * preserved verbatim so the caller can distinguish between values
   * that were stored with or without a terminator.
   */
  async show(name: string, env: string): Promise<string> {
    const dir = await this.ensureSecretsDir();
    const fileName = `${env}_${name}`;
    const full = this.resolveSecretPath(dir, fileName);
    return readFile(full, "utf-8");
  }

  /** Whether `${env}_${name}` exists as a file on disk. */
  async exists(name: string, env: string): Promise<boolean> {
    const dir = await this.ensureSecretsDir();
    const fileName = `${env}_${name}`;
    const full = this.resolveSecretPath(dir, fileName);
    try {
      await access(full);
      return true;
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Internal helpers
  // -------------------------------------------------------------------------

  /**
   * Return the absolute path to the secrets directory, creating it with
   * 0700 permissions if it does not exist yet.
   */
  private async ensureSecretsDir(): Promise<string> {
    const platformDir = resolvePlatformDir(this.config.platformDir);
    const dir = resolve(platformDir, SECRETS_SUBDIR);
    await mkdir(dir, { recursive: true, mode: DIR_MODE });
    return dir;
  }

  /**
   * Resolve a secret filename under the secrets directory while
   * guarding against path traversal. Any `..` segment, absolute path,
   * or resulting path outside of `dir` triggers an error.
   */
  private resolveSecretPath(dir: string, fileName: string): string {
    if (
      fileName.length === 0 ||
      fileName.includes("/") ||
      fileName.includes("\\") ||
      fileName.includes("\0") ||
      fileName === "." ||
      fileName === ".."
    ) {
      throw new Error(`Invalid secret name: ${fileName}`);
    }
    const full = resolve(dir, fileName);
    const boundary = dir.endsWith(sep) ? dir : `${dir}${sep}`;
    if (!full.startsWith(boundary)) {
      throw new Error(
        `Refusing to access secret outside of secrets directory: ${fileName}`,
      );
    }
    return full;
  }
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "ENOENT"
  );
}
