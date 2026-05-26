// src/lib/runtimes/compose.ts
// ComposeRuntime — thin TypeScript wrapper around the bash scripts produced
// by the `fm` split (see `scripts/compose/fm-*.sh` in industream-stack).
//
// Design notes (see `docs/INTEGRATION-PLAN.md` §6 and `docs/RUNTIME-STRATEGY.md`):
//   • Bash is the source of truth — this class only dispatches.
//   • `deploy()` refuses to run under `NODE_ENV=production` unless the caller
//     explicitly opts in via `opts.allowComposeProd` (CLI flag
//     `--allow-compose-prod`). This is decision §6.3 of INTEGRATION-PLAN.
//   • `deploy()` polls the ConfigHub readiness endpoint after handing control
//     back from the bash script (decision §6.1: HTTP polling replaces the
//     Swarm-specific `docker service ps` wait).
//   • `status()` walks `instances/*/.env` and asks `docker compose ps --format
//     json` for each detected instance, then returns a single flattened view
//     keyed by project name `fm-<instance>`.
//   • `logs()` routes through `docker compose -p fm-<env> logs`; with no
//     service argument it prints the list of services (parity with Swarm UX).
import { execa } from "execa";
import { access, readdir, readFile, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { IndustreamConfig } from "../config.js";
import { ComposeSecrets } from "../secrets/compose.js";
import type { SecretsBackend } from "../secrets/index.js";
import { getDeployFlags } from "../stack-filter.js";
import { getRegistryForPlan } from "../registry-login.js";
import type { Plan } from "../modules.js";
import { resolvePlatformDir, parseEnvFile } from "../swarm-repo.js";
import type {
  DeployOptions,
  Environment,
  LogsOptions,
  Runtime,
  RuntimeName,
  ServiceStatus,
  StackStatus,
} from "./index.js";

/**
 * Monorepo-relative fallback for the bash scripts. When the CLI runs from
 * inside the `industream-cli` workspace we have no sibling clone of
 * `industream-stack` under `platformDir`, so we walk up to the shared parent
 * directory instead. This path matches the dev layout on the maintainer's
 * machine; install-time deployments rely on `platformDir/scripts/compose/`.
 */
const DEV_MONOREPO_SCRIPTS = resolve(
  "/home/cdm/Projets/industream/platform/industream-stack/scripts/compose",
);

const CONFIGHUB_POLL_ATTEMPTS = 30;
const CONFIGHUB_POLL_INTERVAL_MS = 2_000;
const CONFIGHUB_REQUEST_TIMEOUT_MS = 2_000;
const CONFIGHUB_DEFAULT_PORT = 3_080;

export class ComposeRuntime implements Runtime {
  public readonly name: RuntimeName = "compose";
  public readonly secrets: SecretsBackend;

  constructor(private readonly config: IndustreamConfig) {
    this.secrets = new ComposeSecrets(config);
  }

  /**
   * Bring an instance up via `scripts/compose/fm-instance.sh up <env>`.
   * Refuses to run in production unless `opts.allowComposeProd === true`.
   */
  async deploy(
    environment: Environment,
    options: DeployOptions = {},
  ): Promise<void> {
    assertNotProduction(options);

    const instance = requireEnvironment(environment);
    const scriptsDir = await getComposeScriptsDir(this.config);
    const script = await requireScript(scriptsDir, "fm-instance.sh");

    // Resolve the plan and the matching registry so `fm-instance.sh` pulls
    // from the right Harbor. Community → public Harbor (anonymous pulls);
    // every paid plan → premium Harbor (authenticated pulls handled by the
    // bash script via `docker login`, which we do not do from TS here — the
    // compose flow assumes the user is already logged in when needed).
    const platformDir = resolvePlatformDir(this.config.platformDir);
    const deployFlags = await getDeployFlags(platformDir);
    const plan = deployFlags.plan as Plan;
    const registry = getRegistryForPlan(plan);

    const args: string[] = ["up", instance];
    if (options.withWorkers) args.push("--workers");
    if (options.withUimaker) args.push("--uimaker");

    await execa(script, args, {
      cwd: scriptsDir,
      stdio: "inherit",
      env: {
        ...process.env,
        DOCKER_REGISTRY: registry,
      },
    });

    const configHubUrl = await resolveConfigHubUrl(this.config, instance);
    await waitForConfigHubReady(configHubUrl);
  }

  /**
   * Bring an instance down via `scripts/compose/fm-instance.sh down <env>`.
   * Volumes are preserved by the bash script (parity with SwarmRuntime).
   */
  async down(environment?: Environment): Promise<void> {
    const instance = requireEnvironment(
      environment ?? this.config.defaultEnvironment,
    );
    const scriptsDir = await getComposeScriptsDir(this.config);
    const script = await requireScript(scriptsDir, "fm-instance.sh");

    await execa(script, ["down", instance], {
      cwd: scriptsDir,
      stdio: "inherit",
    });
  }

  /**
   * Aggregate status across every Compose project named `fm-<instance>`. We
   * trust `docker compose ls --format json` as the global source of truth and
   * cross-check against any local `instances/<name>/.env` we can discover.
   *
   * The Runtime contract returns a single `StackStatus`, so we pick the
   * default environment when it maps to a known project, otherwise return an
   * inactive view — parity with SwarmRuntime which also reports one stack at
   * a time.
   */
  async status(): Promise<StackStatus> {
    const defaultInstance = this.config.defaultEnvironment;
    const projectName = composeProjectName(defaultInstance);

    const projects = await listComposeProjects();
    const active = projects.some((project) => project.name === projectName);

    if (!active) {
      return { stackName: projectName, active: false, services: [] };
    }

    const services = await listComposeServices(projectName);
    return { stackName: projectName, active: true, services };
  }

  /**
   * Stream logs for a Compose service. With no service argument we print the
   * list of services for the default instance — same UX as Swarm.
   */
  async logs(
    service: string | undefined,
    options: LogsOptions = {},
  ): Promise<void> {
    const instance = requireEnvironment(this.config.defaultEnvironment);
    const projectName = composeProjectName(instance);

    if (!service) {
      const { stdout } = await execa("docker", [
        "compose",
        "-p",
        projectName,
        "ps",
        "--services",
      ]);
      console.log("Available services:");
      for (const name of stdout.split("\n").filter(Boolean)) {
        console.log(`  ${name}`);
      }
      console.log(`\nUsage: industream logs <service-name>`);
      return;
    }

    const args: string[] = ["compose", "-p", projectName, "logs"];
    if (options.follow) args.push("-f");
    args.push("--tail", String(options.tail ?? 100));
    args.push(service);

    await execa("docker", args, { stdio: "inherit" });
  }
}

// ---------------------------------------------------------------------------
// Guard rails
// ---------------------------------------------------------------------------

function assertNotProduction(options: DeployOptions): void {
  if (process.env.NODE_ENV !== "production") return;
  if (options.allowComposeProd === true) return;
  throw new Error(
    "ComposeRuntime refuses to deploy under NODE_ENV=production. " +
      "Pass --allow-compose-prod (or set DeployOptions.allowComposeProd=true) " +
      "if you really know what you are doing.",
  );
}

function requireEnvironment(environment: Environment | undefined): string {
  if (!environment || environment.trim() === "") {
    throw new Error(
      "ComposeRuntime requires an instance name (got empty string).",
    );
  }
  return environment.trim();
}

function composeProjectName(instance: string): string {
  return `fm-${instance}`;
}

// ---------------------------------------------------------------------------
// Script resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the absolute path to `scripts/compose/` for the active install.
 * In production installs the scripts live at `${platformDir}/scripts/compose/`.
 * In the dev monorepo we fall back to the sibling industream-stack clone so
 * `npm run dev` works without any install step.
 */
export async function getComposeScriptsDir(
  config: IndustreamConfig,
): Promise<string> {
  const platformDir = resolvePlatformDir(config.platformDir);
  const installed = join(platformDir, "scripts", "compose");
  if (await pathExists(installed)) return installed;

  if (await pathExists(DEV_MONOREPO_SCRIPTS)) return DEV_MONOREPO_SCRIPTS;

  throw new Error(
    `Compose scripts not found at ${installed} — ensure industream-stack ` +
      `is installed at ${platformDir}.`,
  );
}

async function requireScript(
  scriptsDir: string,
  name: string,
): Promise<string> {
  const scriptPath = join(scriptsDir, name);
  if (!(await pathExists(scriptPath))) {
    throw new Error(
      `Compose script not found: ${scriptPath}. The fm split may not be ` +
        `complete yet — see docs/INTEGRATION-PLAN.md §2.`,
    );
  }
  return scriptPath;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await access(target);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Compose introspection
// ---------------------------------------------------------------------------

interface ComposeProjectJson {
  Name?: string;
  Status?: string;
  ConfigFiles?: string;
}

interface ComposePsJson {
  Name?: string;
  Service?: string;
  Image?: string;
  State?: string;
  Status?: string;
}

async function listComposeProjects(): Promise<Array<{ name: string }>> {
  try {
    const { stdout } = await execa("docker", [
      "compose",
      "ls",
      "--all",
      "--format",
      "json",
    ]);
    const parsed = safeParseJson<ComposeProjectJson[]>(stdout) ?? [];
    return parsed
      .filter((project): project is ComposeProjectJson =>
        Boolean(project?.Name),
      )
      .map((project) => ({ name: String(project.Name) }))
      .filter((project) => project.name.startsWith("fm-"));
  } catch {
    return [];
  }
}

async function listComposeServices(
  projectName: string,
): Promise<ServiceStatus[]> {
  const { stdout } = await execa("docker", [
    "compose",
    "-p",
    projectName,
    "ps",
    "--all",
    "--format",
    "json",
  ]);

  // `docker compose ps --format json` prints one JSON object per line (NDJSON)
  // rather than a JSON array — parse each line independently so we stay
  // compatible with both Compose v2.23+ (NDJSON) and older `[...]` variants.
  const entries = parseComposePsOutput(stdout);

  return entries.map((entry): ServiceStatus => {
    const fullName = entry.Name ?? "";
    const service = entry.Service ?? fullName;
    const state = (entry.State ?? "").toLowerCase();
    const isRunning = state === "running";
    return {
      name: service,
      fullName,
      // Compose reports textual state rather than Swarm-style replicas — we
      // reuse the field to avoid widening the Runtime contract.
      replicas: entry.Status ?? state ?? "",
      image: entry.Image ?? "",
      isRunning,
    };
  });
}

function parseComposePsOutput(stdout: string): ComposePsJson[] {
  const trimmed = stdout.trim();
  if (!trimmed) return [];

  // NDJSON path — one object per line.
  if (!trimmed.startsWith("[")) {
    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => safeParseJson<ComposePsJson>(line))
      .filter((value): value is ComposePsJson => value !== null);
  }

  // Legacy array path — single JSON document.
  return safeParseJson<ComposePsJson[]>(trimmed) ?? [];
}

function safeParseJson<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Scan the `${platformDir}/instances/` directory for subfolders that contain
 * a `.env` file, and return the matching instance names. Exposed for future
 * `industream dev list` support; not consumed by `status()` today but left
 * here to keep the Compose code path self-contained.
 */
export async function listKnownInstances(
  config: IndustreamConfig,
): Promise<string[]> {
  const platformDir = resolvePlatformDir(config.platformDir);
  const instancesDir = join(platformDir, "instances");
  if (!(await pathExists(instancesDir))) return [];

  try {
    const entries = await readdir(instancesDir, { withFileTypes: true });
    const directories = entries.filter((entry) => entry.isDirectory());
    const instances: string[] = [];
    for (const directory of directories) {
      const envPath = join(instancesDir, directory.name, ".env");
      if (await pathExists(envPath)) {
        instances.push(directory.name);
      }
    }
    return instances;
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// ConfigHub readiness
// ---------------------------------------------------------------------------

/**
 * Resolve the ConfigHub base URL for a given instance. We prefer the value
 * exposed in `${platformDir}/instances/<instance>/.env` (key
 * `CONFIGHUB_URL`), fall back to the top-level `.env`, then to a sensible
 * localhost default.
 */
async function resolveConfigHubUrl(
  config: IndustreamConfig,
  instance: string,
): Promise<string> {
  const platformDir = resolvePlatformDir(config.platformDir);
  const candidateEnvs: string[] = [
    join(platformDir, "instances", instance, ".env"),
    join(platformDir, ".env"),
  ];

  for (const envFile of candidateEnvs) {
    const explicit = await readEnvValue(envFile, "CONFIGHUB_URL");
    if (explicit) return stripTrailingSlash(explicit);
    const port = await readEnvValue(envFile, "CONFIGHUB_PORT");
    if (port) return `http://localhost:${port}`;
  }

  return `http://localhost:${CONFIGHUB_DEFAULT_PORT}`;
}

async function readEnvValue(
  envPath: string,
  key: string,
): Promise<string | null> {
  try {
    const info = await stat(envPath);
    if (!info.isFile()) return null;
    const content = await readFile(envPath, "utf-8");
    const parsed = parseEnvFile(content);
    const value = parsed[key]?.trim();
    return value ? value : null;
  } catch {
    return null;
  }
}

function stripTrailingSlash(url: string): string {
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

/**
 * Poll ConfigHub's `/health` endpoint up to 30 times with a 2s delay (≈60s
 * total). Any HTTP 2xx response is considered ready. Throws with a clear
 * message when the timeout elapses — callers should surface it so users know
 * to inspect the container logs.
 *
 * Exported so other runtimes or tests can reuse the same policy.
 */
export async function waitForConfigHubReady(baseUrl: string): Promise<void> {
  const healthUrl = `${stripTrailingSlash(baseUrl)}/health`;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= CONFIGHUB_POLL_ATTEMPTS; attempt += 1) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        CONFIGHUB_REQUEST_TIMEOUT_MS,
      );

      try {
        const response = await fetch(healthUrl, {
          signal: controller.signal,
        });
        if (response.ok) return;
        lastError = new Error(`HTTP ${response.status} ${response.statusText}`);
      } finally {
        clearTimeout(timer);
      }
    } catch (error) {
      lastError = error;
    }

    if (attempt < CONFIGHUB_POLL_ATTEMPTS) {
      await sleep(CONFIGHUB_POLL_INTERVAL_MS);
    }
  }

  const detail = lastError instanceof Error ? lastError.message : "unknown";
  throw new Error(
    `ConfigHub did not become ready at ${healthUrl} after ` +
      `${CONFIGHUB_POLL_ATTEMPTS} attempts (${detail}).`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => {
    setTimeout(resolvePromise, ms);
  });
}
