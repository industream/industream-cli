import React, { useState, useEffect, useRef, useMemo } from "react";
import { render, Text, Box, useApp, useInput } from "ink";
import { BoltBuilder } from "../components/BoltBuilder.js";
import { Banner } from "../components/Banner.js";
import { ModuleSelector } from "../components/ModuleSelector.js";
import { DeployDashboard } from "../components/DeployDashboard.js";
import { DeployReporter } from "../lib/deploy-reporter.js";
import type { DeployStep } from "../lib/deploy-reporter.js";
import { InstallConfigPrompt } from "../components/InstallConfigPrompt.js";
import { WorkerSelector } from "../components/WorkerSelector.js";
import { saveConfig } from "../lib/config.js";
import { isDockerAvailable, isSwarmActive, getSwarmServices } from "../lib/docker.js";
import {
  cloneSwarmRepo,
  ensureComposeTree,
  isPlatformInstalled,
  pullSwarmRepo,
  resolvePlatformDir,
  updateEnvValue,
} from "../lib/swarm-repo.js";
import {
  activateLicense as activateLicenseKeygen,
  loadCachedLicense,
  validateLicenseWithKeygen,
} from "../lib/keygen.js";
import { loadModuleRegistry, getModulesByLicense } from "../lib/modules.js";
import type { Module, Plan } from "../lib/modules.js";
import { execa } from "execa";
import { join } from "node:path";
import { copyFile, access, writeFile, mkdir, readFile } from "node:fs/promises";
import { unifiedTreeExists, unifiedDir } from "../lib/unified-deploy.js";
import { createInterface } from "node:readline";

type Step =
  | "prerequisites"
  | "clone"
  | "modules"
  | "setup"
  | "done"
  | "error";

// Structured install phases (replaces the animated bolt with a clear checklist).
const INSTALL_STEPS: { id: Step; label: string }[] = [
  { id: "prerequisites", label: "Check prerequisites" },
  { id: "clone", label: "Download platform files" },
  { id: "modules", label: "Resolve modules" },
  { id: "setup", label: "Configure & deploy" },
];

function InstallSteps({
  current,
  isError,
}: {
  current: Step;
  isError: boolean;
}): React.ReactElement {
  const currentIndex = INSTALL_STEPS.findIndex((s) => s.id === current);
  return (
    <Box flexDirection="column">
      {INSTALL_STEPS.map((s, i) => {
        let icon = "○";
        let color = "gray";
        if (current === "done" || (currentIndex >= 0 && i < currentIndex)) {
          icon = "✓";
          color = "green";
        } else if (i === currentIndex) {
          icon = isError ? "✗" : "⚙";
          color = isError ? "red" : "blueBright";
        }
        return (
          <Text key={s.id} color={color}>
            {icon} {s.label}
          </Text>
        );
      })}
    </Box>
  );
}

// Run a script and stream last meaningful line to a progress callback.
// When `onLog` is provided every non-empty line is also forwarded so the
// 4-pane dashboard's Log pane can show the full script output.
async function runScript(
  scriptPath: string,
  args: string[],
  cwd: string,
  onProgress: (line: string) => void,
  onLog?: (line: string) => void,
): Promise<void> {
  const subprocess = execa(scriptPath, args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  const handle = (data: Buffer, isStderr: boolean): void => {
    const lines = data.toString().split("\n").filter((line) => line.trim().length > 0);
    for (const line of lines) {
      // Strip ANSI color codes for clean display
      const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (clean.length === 0) continue;
      if (isStderr && clean.startsWith("WARNING")) continue;
      onLog?.(clean);
    }
    const lastLine = lines.at(-1);
    if (lastLine) {
      const clean = lastLine.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (clean.length > 0 && !(isStderr && clean.startsWith("WARNING"))) {
        onProgress(clean.slice(0, 80));
      }
    }
  };

  subprocess.stdout?.on("data", (data: Buffer) => handle(data, false));
  subprocess.stderr?.on("data", (data: Buffer) => handle(data, true));

  await subprocess;
}

// Ensure python3 + argon2-cffi (the `argon2` module) is available — deploy.sh's
// EE Logto seeder hashes the bootstrap user with Argon2i via host python3, and
// silently skips ALL Logto seeding when it's absent. Try the host package
// manager (passwordless sudo); fail fast with the manual command otherwise so the
// operator never ends up with a deployed-but-unseeded Logto (invalid_client).
async function ensureArgon2(log: (line: string) => void): Promise<void> {
  const hasArgon2 = (): Promise<boolean> =>
    execa("python3", ["-c", "import argon2"]).then(() => true).catch(() => false);
  if (await hasArgon2()) return;
  log("python3-argon2 missing (needed for Logto seeding) — installing…");
  const installers: { mgr: string; args: string[] }[] = [
    { mgr: "apt-get", args: ["install", "-y", "python3-argon2"] },
    { mgr: "dnf", args: ["install", "-y", "python3-argon2-cffi"] },
    { mgr: "apk", args: ["add", "py3-argon2-cffi"] },
    { mgr: "pacman", args: ["-S", "--noconfirm", "python-argon2_cffi"] },
  ];
  for (const { mgr, args } of installers) {
    const present = await execa("sh", ["-c", `command -v ${mgr}`]).then(() => true).catch(() => false);
    if (!present) continue;
    await execa("sudo", ["-n", mgr, ...args]).then(
      () => log(`  ran: sudo ${mgr} ${args.join(" ")}`),
      () => log(`  (sudo ${mgr} failed — passwordless sudo unavailable?)`),
    );
    break;
  }
  if (!(await hasArgon2())) {
    throw new Error(
      "EE deploy needs python3-argon2 for Logto seeding, and it could not be " +
        "auto-installed. Install it and re-run `industream install`:\n" +
        "  sudo apt-get install -y python3-argon2     # Debian/Ubuntu\n" +
        "  sudo dnf install -y python3-argon2-cffi    # Fedora/RHEL",
    );
  }
  log("✓ python3-argon2 available");
}

function InstallWizard({ environment = "prod", domain: cliDomain, tls: cliTls, runtime: cliRuntime, withPortainer = false }: { environment?: string; domain?: string; tls?: string; runtime?: string; withPortainer?: boolean }): React.ReactElement {
  const { exit } = useApp();
  const [introDone, setIntroDone] = useState(false);
  const [step, setStep] = useState<Step>("prerequisites");
  const [statusMessage, setStatusMessage] = useState("Checking prerequisites...");
  const [progressLine, setProgressLine] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [modulesSummary, setModulesSummary] = useState("");
  const [allModules, setAllModules] = useState<Module[]>([]);
  const [currentPlan, setCurrentPlan] = useState<Plan>("community");
  const platformDirectory = "~/industream-platform";

  // Show the interactive config menu whenever no CLI args override it.
  // Ink itself needs raw mode on stdin to work, so detect the same capability
  // rather than relying on isTTY (which can be falsy when the child is spawned
  // via execa with stdio: "inherit", even from an interactive parent menu).
  const interactive =
    typeof process.stdin.setRawMode === "function" ||
    Boolean(process.stdout.isTTY) ||
    Boolean(process.stdin.isTTY);
  const needsPrompt = interactive && cliDomain === undefined && cliTls === undefined;
  const [configDone, setConfigDone] = useState(!needsPrompt);
  const [domain, setDomain] = useState(cliDomain ?? "industream.platform.lan");
  const [tls, setTls] = useState<string>(cliTls ?? "selfsigned");
  const [runtimeName, setRuntimeName] = useState<string>(cliRuntime === "compose" ? "compose" : "swarm");
  const [licenseLabel, setLicenseLabel] = useState<string>("Community (no license)");

  // Worker fleet catalog (modules tagged category "Workers") — drives the
  // interactive WorkerSelector and the deploy.sh --workers allowlist (Phase 2).
  const workerModules = useMemo(
    () => loadModuleRegistry().modules.filter((module) => module.category === "Workers"),
    [],
  );
  const communityWorkerServices = useMemo(
    () =>
      workerModules
        .filter(
          (module) =>
            (module.license === "bsl" || module.license === "apache") &&
            module.status === "ready" &&
            module.serviceName &&
            // worker-manager is infra (own group), excluded from the selector too,
            // so it must not count toward the "all selected → omit --workers" check.
            module.serviceName !== "worker-manager",
        )
        .map((module) => module.serviceName as string),
    [workerModules],
  );
  // Headless (no prompt) keeps every worker. `selectedWorkers === null` ⇒ deploy
  // all (omit --workers). Only the swarm path honours the selection (compose uses
  // fm-caddy.sh), so the selector is skipped for compose via an effect below.
  const [workersChosen, setWorkersChosen] = useState<boolean>(!needsPrompt);
  const [selectedWorkers, setSelectedWorkers] = useState<string[] | null>(null);

  // The 4-pane DeployDashboard owns the screen during execution when we have a
  // TTY. In CI / non-TTY we fall back to the plain InstallSteps + status lines
  // (Ink still renders, but the dashboard panes are noise without a terminal).
  const useDashboard = Boolean(process.stdout.isTTY);
  // A single, stable reporter for the whole install run (mirrors deploy.ts).
  const reporterRef = useRef<DeployReporter>(new DeployReporter());
  const reporter = reporterRef.current;

  // The worker selector only applies to the swarm deploy.sh path. For compose
  // (fm-caddy.sh, which deploys every worker) skip it once config is confirmed.
  useEffect(() => {
    if (configDone && runtimeName !== "swarm") setWorkersChosen(true);
  }, [configDone, runtimeName]);

  // Load cached license info once for the interactive menu
  useEffect(() => {
    if (!needsPrompt) return;
    loadCachedLicense()
      .then((cache) => {
        if (cache?.plan) {
          const planLabel = cache.plan.charAt(0).toUpperCase() + cache.plan.slice(1);
          setLicenseLabel(cache.response.meta.valid ? `${planLabel} (active)` : `${planLabel} (invalid)`);
        }
      })
      .catch(() => {
        // keep default label
      });
  }, [needsPrompt]);

  async function handleActivateLicense(
    key: string,
  ): Promise<{ ok: boolean; label: string; error?: string }> {
    try {
      const response = await activateLicenseKeygen(key);
      if (!response.meta.valid) {
        return { ok: false, label: licenseLabel, error: response.meta.detail };
      }
      const cache = await loadCachedLicense();
      const plan = cache?.plan ?? "enterprise";
      const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
      const newLabel = `${planLabel} (active)`;
      setLicenseLabel(newLabel);
      return { ok: true, label: newLabel };
    } catch (err) {
      return {
        ok: false,
        label: licenseLabel,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }

  useEffect(() => {
    if (!introDone || !configDone || !workersChosen) return;
    async function runInstall() {
      // ---- Progress sinks: update both the reporter (4-pane dashboard) and
      // the legacy InstallSteps state (plain non-TTY fallback). The reporter is
      // the single source of truth for the dashboard; the setStep/setStatus*
      // calls keep the non-TTY path identical to before. ----

      /** Mark a reporter step running + set the coarse legacy step/status. */
      const enterStep = (id: string, legacy: Step, message: string): void => {
        reporter.step(id, "running", message);
        reporter.log(`▶ ${message}`);
        setStep(legacy);
        setStatusMessage(message);
        setProgressLine("");
      };
      /** Finish a reporter step. */
      const finishStep = (id: string, status: "done" | "skipped" = "done"): void => {
        reporter.step(id, status);
      };
      /** A short status update within the current step. */
      const status = (message: string): void => {
        setStatusMessage(message);
        reporter.log(message);
      };
      /** A streamed progress line (one-liner) within the current step. Updates
       * the transient legacy status line ONLY — it must NOT push to the
       * dashboard Log pane, otherwise runScript (which fires onProgress for the
       * last line of every chunk AND onLog for every line) double-logs each
       * streamed line. The Log pane is fed exclusively by `logLine` (onLog). */
      const progress = (line: string): void => {
        setProgressLine(line);
      };
      /** Full log line for the dashboard Log pane (no legacy state change). */
      const logLine = (line: string): void => {
        if (line.trim().length > 0) reporter.log(line);
      };

      // Declare the install step list up-front so the dashboard Steps pane
      // shows the whole plan from the start. The "configure" group covers
      // .env + certs + UIFusion; "deploy" covers render+deploy (swarm/unified)
      // or Caddy (compose).
      const steps: DeployStep[] = [
        { id: "prerequisites", label: "Check prerequisites", status: "pending" },
        { id: "clone", label: "Download platform files", status: "pending" },
        { id: "configure", label: "Configure platform", status: "pending" },
        { id: "modules", label: "Resolve modules", status: "pending" },
        ...(runtimeName === "compose"
          ? [{ id: "deploy", label: "Start Caddy reverse proxy", status: "pending" as const }]
          : [
              { id: "secrets", label: "Create secrets", status: "pending" as const },
              { id: "render", label: "Render & deploy stack", status: "pending" as const },
              { id: "deploy", label: "Seed ConfigHub", status: "pending" as const },
              { id: "state", label: "Record deployment state", status: "pending" as const },
            ]),
      ];
      reporter.setSteps(steps);

      try {
        // Step 1: Prerequisites
        enterStep("prerequisites", "prerequisites", "Checking Docker...");
        if (!(await isDockerAvailable())) {
          throw new Error(
            "Docker is not installed. Install Docker first: https://docs.docker.com/engine/install/",
          );
        }
        // Only the Swarm runtime needs a Swarm. Compose runs on plain Docker,
        // so don't initialize Swarm when it isn't required.
        if (runtimeName === "swarm") {
          status("Checking Docker Swarm...");
          if (!(await isSwarmActive())) {
            status("Initializing Docker Swarm...");
            await execa("/usr/bin/docker", ["swarm", "init"]);
          }
        } else {
          status("Compose runtime — skipping Docker Swarm");
        }
        finishStep("prerequisites");

        // Step 2: Clone repo
        enterStep("clone", "clone", "Downloading platform files...");
        const resolved = resolvePlatformDir(platformDirectory);
        if (await isPlatformInstalled(platformDirectory)) {
          status("Platform files already present, updating...");
          // Use the resilient updater (fetch + reset --hard origin), NOT
          // `git pull --ff-only`: the deploy writes runtime artefacts into tracked
          // files (bundle .env.*, generated htpasswd), so a plain ff-only pull
          // aborts with "local changes would be overwritten" on every reinstall.
          await pullSwarmRepo(platformDirectory);
        } else {
          await cloneSwarmRepo(platformDirectory, (line) => { progress(line); logLine(line); });
        }

        // LEGACY compose tree (industream-flowmaker, PRIVATE repo): only the
        // pre-unified `fm` path needs it. The unified tree (industream-stack/
        // unified) renders compose SELF-CONTAINED (deploy.sh --runtime compose,
        // runtime/compose/*.yml — verified: 0 references to industream-flowmaker).
        // Cloning the private repo here was the SOLE clean-machine blocker for a
        // compose install (no git creds → "could not read Username"). Skip it when
        // the unified tree is present (always true after a fresh swarm-repo clone).
        if (runtimeName === "compose" && !(await unifiedTreeExists(platformDirectory))) {
          status("Downloading compose deployment tree (legacy fm path)...");
          await ensureComposeTree((line) => { progress(line); logLine(line); });
        }
        finishStep("clone");

        // Ensure base .env exists (copied from .env.example)
        // The env-specific overrides (.env.<env>) are created by deploy-swarm.sh
        // from .env.<env>.example on first run.
        const envPath = join(resolved, ".env");
        try {
          await access(envPath);
        } catch {
          try {
            await copyFile(join(resolved, ".env.example"), envPath);
          } catch {
            throw new Error("No .env.example found in platform repo");
          }
        }

        // Set domain, TLS mode and runtime in .env before deploy.
        // The runtime is captured either from --runtime CLI flag or via the
        // interactive prompt step; it's persisted in .env so that subsequent
        // `industream deploy` invocations route to the right runtime via
        // getRuntime() in src/lib/runtimes/index.ts.
        const tlsMode = tls === "letsencrypt" ? "letsencrypt" : "selfsigned";
        enterStep(
          "configure",
          "clone",
          `Configuring domain: ${domain} (TLS: ${tlsMode}, runtime: ${runtimeName})`,
        );
        await updateEnvValue(platformDirectory, "INDUSTREAM_DOMAIN", domain);
        await updateEnvValue(platformDirectory, "TLS_MODE", tlsMode);
        await updateEnvValue(platformDirectory, "RUNTIME", runtimeName);
        if (tlsMode === "letsencrypt") {
          await updateEnvValue(platformDirectory, "ACME_EMAIL", "admin@industream.com");
        }

        // Regenerate certs (selfsigned) and UIFusion config to apply the new domain
        if (tlsMode === "selfsigned") {
          status("Generating self-signed certificates...");
          await runScript(
            join(resolved, "scripts/generate/generate-certs.sh"),
            [],
            resolved,
            (line) => progress(line),
            (line) => logLine(line),
          );
        }
        status("Generating UIFusion configuration...");
        await runScript(
          join(resolved, "scripts/generate/generate-uifusion-config.sh"),
          ["--force", "--env", environment],
          resolved,
          (line) => progress(line),
          (line) => logLine(line),
        );
        finishStep("configure");

        // Step 3: Modules
        enterStep("modules", "modules", "Analyzing modules...");

        const licenseResult = await validateLicenseWithKeygen();
        const moduleRegistry = loadModuleRegistry();
        const bslModules = getModulesByLicense(moduleRegistry, "bsl");
        const apacheModules = getModulesByLicense(moduleRegistry, "apache");
        const proprietaryModules = getModulesByLicense(moduleRegistry, "proprietary");
        const communityCount = bslModules.length + apacheModules.length;
        const premiumCount = proprietaryModules.length;
        const totalCount = communityCount + premiumCount;

        // Reflect the worker selection (Phase 2): the catalog counts above are the
        // FULL set; subtract the workers the operator deselected so the reported
        // numbers match what is actually deployed (the deploy itself already
        // honours the selection via deploy.sh --workers).
        const deselectedWorkers = selectedWorkers
          ? communityWorkerServices.filter((service) => !selectedWorkers.includes(service)).length
          : 0;
        const deployedCommunity = communityCount - deselectedWorkers;
        const deployedTotal = totalCount - deselectedWorkers;

        const plan = (licenseResult.cache?.plan ?? "community") as Plan;
        setAllModules(moduleRegistry.modules);
        setCurrentPlan(plan);
        const isLicensed = licenseResult.valid && plan !== "community";

        if (isLicensed) {
          const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
          status(`Deploying ${deployedTotal} modules (${planLabel} license)`);
          setModulesSummary(`${deployedTotal} modules deployed.`);
        } else {
          status(
            `Deploying ${deployedCommunity} community modules (${premiumCount} premium modules available with license)`,
          );
          setModulesSummary(
            `${deployedCommunity} modules deployed. ${premiumCount} premium modules available with a license.`,
          );
        }

        // Pause so user can read the module summary and configuration
        await new Promise((resolve) => setTimeout(resolve, 5000));
        finishStep("modules");

        // Step 4: Setup
        setStep("setup");

        // Persist both registry hostnames in .env so stack/compose files can
        // resolve image paths per service (community → GHCR, enterprise → Harbor).
        // DOCKER_REGISTRY is kept as a back-compat alias for older stack files
        // that still reference the single-registry variable.
        const {
          ensureRegistryLogin,
          getRegistryForPlan,
          COMMUNITY_REGISTRY,
          ENTERPRISE_REGISTRY,
        } = await import("../lib/registry-login.js");
        await updateEnvValue(
          platformDirectory,
          "COMMUNITY_REGISTRY",
          COMMUNITY_REGISTRY,
        );
        await updateEnvValue(
          platformDirectory,
          "ENTERPRISE_REGISTRY",
          ENTERPRISE_REGISTRY,
        );
        const dockerRegistry = getRegistryForPlan(plan);
        await updateEnvValue(
          platformDirectory,
          "DOCKER_REGISTRY",
          dockerRegistry,
        );
        // v2: persist the edition so the unified `industream deploy` path
        // (lib/unified-deploy.ts) assembles the right CE/EE overlay. EE is
        // driven by entitlements — any non-community plan ⇒ ee.
        await updateEnvValue(
          platformDirectory,
          "EDITION",
          plan === "community" ? "ce" : "ee",
        );
        logLine(
          `  Configured registries: community=${COMMUNITY_REGISTRY}, enterprise=${ENTERPRISE_REGISTRY}`,
        );

        // Check / setup Docker registry login
        status("Checking registry access...");
        await ensureRegistryLogin(dockerRegistry, plan);

        // Compose runtime: no Swarm, no Traefik. Bring up the shared Caddy
        // reverse proxy; per-instance deploys happen via `industream deploy`.
        if (runtimeName === "compose") {
          enterStep("deploy", "setup", "Starting Caddy reverse proxy...");
          // Non-fatal: Caddy is also (re)started on first deploy. But don't
          // swallow the error silently — a failed start used to leave the
          // user with no proxy and no message.
          let caddyOk = true;
          try {
            await runScript(
              join(resolved, "scripts/compose/fm-caddy.sh"),
              ["rebuild"],
              resolved,
              (line) => progress(line),
              (line) => logLine(line),
            );
          } catch (error) {
            caddyOk = false;
            progress(error instanceof Error ? error.message : String(error));
          }
          const summary = caddyOk
            ? "Run 'industream deploy --env <instance>' to bring up an instance."
            : "⚠ Caddy did not start (it will be retried on first deploy). " +
                "Check 'docker ps', then run 'industream deploy --env <instance>'.";
          setModulesSummary(summary);
          finishStep("deploy", caddyOk ? "done" : "skipped");
          reporter.setResult({
            ok: caddyOk,
            summary,
            urls: [],
          });
          setStep("done");
          return;
        }

        // Step 5: Secrets (swarm)
        enterStep("secrets", "setup", "Deploying Traefik...");
        await runScript(
          join(resolved, "scripts/deploy-traefik.sh"),
          [],
          resolved,
          (line) => progress(line),
          (line) => logLine(line),
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));

        status("Creating secrets...");
        await runScript(
          join(resolved, "scripts/setup/create-secrets.sh"),
          ["--env", environment],
          resolved,
          (line) => progress(line),
          (line) => logLine(line),
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));
        // EE additionally needs the Logto DB secrets (logto_db_url /
        // logto_db_password) published as external swarm secrets — without them
        // `docker stack deploy` aborts the WHOLE stack with
        // "secret not found: <env>_logto_db_url" (0 services created). Provision
        // them on swarm EE (idempotent; CE has no Logto).
        if (plan !== "community" && runtimeName === "swarm") {
          status("Creating Enterprise secrets (Logto)...");
          await runScript(
            join(resolved, "scripts/setup/create-secrets-ee.sh"),
            ["--env", environment],
            resolved,
            (line) => progress(line),
            (line) => logLine(line),
          );
          // seed_ee (in deploy.sh) hashes the Logto bootstrap-user password with
          // Argon2i via host python3 + argon2-cffi; without it ALL Logto seeding is
          // skipped → no OIDC app → login fails (invalid_client/400). Ensure it now.
          await ensureArgon2((line) => logLine(line));
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        finishStep("secrets");

        // Step 6: Render & deploy stack (swarm)
        enterStep("render", "setup", "Deploying platform stack...");
        if (await unifiedTreeExists(platformDirectory)) {
          // ---- v2: unified deploy via scripts/deploy.sh (assembler + bundle) ----
          const unified = unifiedDir(platformDirectory);
          // The unified swarm overlay bind-mounts ./certs/<domain>.crt (resolved
          // under base/) so Grafana trusts the proxy for its JWKS fetch.
          // generate-certs.sh writes the platform CA to <platformDir>/certs (the
          // legacy path) — mirror it into unified/base/certs so the mount resolves
          // (otherwise grafana tasks are Rejected: "bind source path does not exist").
          const baseCerts = join(unified, "base", "certs");
          await mkdir(baseCerts, { recursive: true });
          for (const ext of ["crt", "key"]) {
            await copyFile(
              join(resolved, "certs", `${domain}.${ext}`),
              join(baseCerts, `${domain}.${ext}`),
            ).catch(() => {});
          }
          status("Rendering release bundle...");
          // Bundle version label is cosmetic — images resolve from versions.env;
          // deploy.sh auto-selects the single rendered bundle.
          await runScript(
            join(unified, "scripts/render-bundles.sh"),
            ["1.0.1"],
            unified,
            (line) => progress(line),
            (line) => logLine(line),
          );
          // Site env consumed by deploy.sh (.env.<env>): domain/TLS + the
          // env-agnostic config defaults the base/*.yml expect.
          const hubOrigin = `https://${domain}`;
          await writeFile(
            join(unified, `.env.${environment}`),
            [
              `INDUSTREAM_DOMAIN=${domain}`, `DOMAIN=${domain}`,
              `INDUSTREAM_HUB_ORIGIN=${hubOrigin}`, `TLS_MODE=${tlsMode}`,
              `TZ=Europe/Berlin`, `ENV=${environment}`,
              `GRAFANA_ADMIN_USER=admin`, `GRAFANA_DB_USER=dashboard`, `GRAFANA_DB_NAME=industream`,
              `GF_APP_MODE=production`, `GF_LOG_LEVEL=info`, `GF_DATABASE_SSL_MODE=disable`,
              // NB: do NOT write GRAFANA_DATABRIDGE_PLUGIN here — .env.<env> loads
              // LAST and an empty value would override the real default from
              // versions.env (the DataBridge Grafana plugin install spec).
              `INFLUX_ORG=industream`, `INFLUX_BUCKET=industream`,
              `POSTGRES_ADMIN_USER=postgres`, `DATACATALOG_DB_USER=datacatalog`,
            ].join("\n") + "\n",
          );
          status("Deploying platform stack (unified deploy.sh)...");
          // `docker stack deploy` gives the CLI no live pull progress — the node
          // pulls images in the background, so the Log pane looks stuck. Poll the
          // stack so the dashboard's Service health pane fills in live
          // (Preparing → 1/1) while images pull and tasks converge.
          const stackName = `industream-${environment}`;
          let pollingHealth = true;
          const pollHealth = async (): Promise<void> => {
            try {
              const svcs = await getSwarmServices(stackName);
              reporter.setServices(
                svcs.map((s) => {
                  const [r, t] = s.replicas.split("/").map((n) => parseInt(n, 10) || 0);
                  return { name: s.name, ready: r, total: t || 1, converged: r > 0 && r === t };
                }),
              );
            } catch {
              // stack not created yet — ignore
            }
          };
          const healthTimer = setInterval(() => { if (pollingHealth) void pollHealth(); }, 3000);
          try {
            const ee = plan !== "community";
            const premiumWorkerServices = workerModules
              .filter((m) => m.license === "proprietary" && m.serviceName)
              .map((m) => m.serviceName as string);
            // EE (Phase 3a): add the premium worker + TimescaleDB groups so they
            // deploy under any valid EE license. Per-entitlement gating is Phase 3b.
            // --with-portainer appends the optional `portainer` ops-console group
            // (CE *and* EE). CE must then pass an explicit --groups (deploy.sh's CE
            // default omits portainer); plain CE keeps that default (groupArgs=[]).
            const baseGroups = ee
              ? "core flowmaker datacatalog workers workers-premium data monitoring timescale"
              : "core flowmaker datacatalog workers data monitoring";
            const groupSet = withPortainer ? `${baseGroups} portainer` : baseGroups;
            const groupArgs = ee || withPortainer ? ["--groups", groupSet] : [];
            // Persist the selected groups so `industream deploy` reuses them.
            // Without this, deploy falls back to deploy.sh's CE default group set
            // (no workers-premium / timescale / portainer) and silently drops the
            // premium worker boxes on every redeploy.
            if (groupArgs.length > 0) {
              await updateEnvValue(platformDirectory, "GROUPS", groupSet);
            }
            // Worker allowlist: the selector picks community workers; in EE the
            // premium workers are always appended so the workers-premium group is
            // not filtered away. A null selection (headless) deploys everything.
            const workerArgs = ((): string[] => {
              if (!selectedWorkers) return [];
              const list = ee
                ? Array.from(new Set([...selectedWorkers, ...premiumWorkerServices]))
                : selectedWorkers;
              if (list.length === 0) return ["--workers", "__none__"];
              if (!ee && list.length === communityWorkerServices.length) return [];
              return ["--workers", list.join(",")];
            })();
            await runScript(
              join(unified, "scripts/deploy.sh"),
              [
                "--runtime", "swarm", "--edition", ee ? "ee" : "ce",
                "--env", environment, "--stack", stackName,
                ...groupArgs,
                ...workerArgs,
              ],
              unified,
              (line) => progress(line),
              (line) => logLine(line),
            );
          } finally {
            pollingHealth = false;
            clearInterval(healthTimer);
            await pollHealth();
          }
        } else {
          // ---- legacy docker-stack path (installs not yet on the unified tree) ----
          status("Deploying platform stack...");
          const deployArgs = ["--env", environment];
          const { getDeployFlags } = await import("../lib/stack-filter.js");
          const deployFlags = await getDeployFlags(resolved);
          if (deployFlags.excludedServices.length > 0) {
            deployArgs.push("--exclude", deployFlags.excludedServices.join(","));
          }
          if (plan === "community") {
            deployArgs.push("--community");
          }
          deployArgs.push("--skip-memory-check");
          const deployProcess = execa(
            join(resolved, "scripts/deploy-swarm.sh"),
            deployArgs,
            { cwd: resolved, stdout: "pipe", stderr: "pipe", stdin: "pipe" },
          );
          deployProcess.stdin?.write("y\ny\ny\ny\n");
          deployProcess.stdin?.end();
          const pump = (data: Buffer, isStderr: boolean): void => {
            const lines = data.toString().split("\n").filter((l) => l.trim().length > 0);
            for (const line of lines) {
              const clean = line.replace(/\x1b\[[0-9;]*m/g, "").trim();
              if (clean.length === 0) continue;
              if (isStderr && clean.startsWith("WARNING")) continue;
              logLine(clean);
            }
            const lastLine = lines.at(-1);
            if (lastLine) {
              const clean = lastLine.replace(/\x1b\[[0-9;]*m/g, "").trim();
              if (clean.length > 0 && !(isStderr && clean.startsWith("WARNING"))) {
                setProgressLine(clean.slice(0, 80));
              }
            }
          };
          deployProcess.stdout?.on("data", (data: Buffer) => pump(data, false));
          deployProcess.stderr?.on("data", (data: Buffer) => pump(data, true));
          await deployProcess;
        }
        finishStep("render");

        // Step 7: Seed ConfigHub (swarm)
        enterStep("deploy", "setup", "Waiting for services to start...");
        progress("ConfigHub needs to be ready before seeding...");
        const stackName = `industream-${environment}`;
        let configHubReady = false;
        for (let attempt = 0; attempt < 60; attempt++) {
          try {
            const { stdout } = await execa("/usr/bin/docker", [
              "service", "ps", `${stackName}_flowmaker-confighub`,
              "--filter", "desired-state=running",
              "--format", "{{.CurrentState}}",
            ]);
            if (stdout.includes("Running")) {
              configHubReady = true;
              break;
            }
          } catch {
            // service not found yet
          }
          progress(`Waiting for ConfigHub... (${attempt + 1}/60)`);
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        if (!configHubReady) {
          progress("ConfigHub not ready after 5 minutes — skipping seed");
        }

        status("Seeding ConfigHub...");
        // Add a small delay for the service to fully initialize
        if (configHubReady) {
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
        await runScript(
          join(resolved, "scripts/setup/seed-confighub.sh"),
          ["--stack", stackName, "--domain", domain],
          resolved,
          (line) => progress(line),
          (line) => logLine(line),
        );
        finishStep("deploy");

        // Save config
        await saveConfig({
          platformDir: platformDirectory,
          defaultEnvironment: environment,
          domain,
        });

        // Step 8 (swarm/unified only): record the deployment state in a versioned
        // .deploy-state git repo. `init` creates the repo; `render` captures the
        // DESIRED state just deployed (secrets scrubbed) as a baseline, so later
        // `industream state diff` surfaces drift and `state log` is the deploy
        // history. deploy-state.sh + the renderer are swarm-targeted, so we skip it
        // on compose. Strictly BEST-EFFORT: a failure here never fails the install
        // (the deploy already succeeded). The deploy.sh pre-deploy snapshot hook
        // additionally captures live state BEFORE future redeploys overwrite it.
        let deployStateDir: string | undefined;
        if (runtimeName === "swarm" && (await unifiedTreeExists(platformDirectory))) {
          enterStep("state", "setup", "Recording deployment state...");
          const unified = unifiedDir(platformDirectory);
          const stateScript = join(unified, "scripts", "deploy-state.sh");
          const edition = plan === "community" ? "ce" : "ee";
          try {
            await runScript(stateScript, ["init"], unified, (l) => progress(l), (l) => logLine(l));
            await runScript(
              stateScript,
              ["render", "--env", environment, "--edition", edition],
              unified,
              (l) => progress(l),
              (l) => logLine(l),
            );
            deployStateDir = join(resolved, ".deploy-state");
            finishStep("state");
          } catch (stateErr) {
            const m = stateErr instanceof Error ? stateErr.message : String(stateErr);
            logLine(`deploy-state recording skipped (non-fatal): ${m}`);
            finishStep("state", "skipped");
          }
        }

        const prefix = environment === "prod" ? "" : `${environment}.`;
        // Surface the generated admin credentials ONCE — create-secrets persists
        // every secret value to <platformDir>/secrets/<env>/ (chmod 700), but the
        // operator otherwise never sees them (random passwords). Read the handful
        // of user-facing ones for the Result pane.
        const secretsDir = join(resolved, "secrets", environment);
        const readSecret = async (name: string): Promise<string> =>
          (await readFile(join(secretsDir, name), "utf8").catch(() => "")).trim();
        const credentials: { label: string; user: string; pass: string }[] = [];
        const hubPass = await readSecret("hub_backend_admin_password");
        if (hubPass)
          credentials.push({ label: "Hub", user: (await readSecret("hub_backend_admin_user")) || "admin", pass: hubPass });
        const grafanaPass = await readSecret("grafana_admin_password");
        if (grafanaPass) credentials.push({ label: "Grafana", user: "admin", pass: grafanaPass });
        const minioPass = await readSecret("minio_root_password");
        if (minioPass)
          credentials.push({ label: "MinIO", user: (await readSecret("minio_root_user")) || "admin", pass: minioPass });
        const influxPass = await readSecret("influx_admin_password");
        if (influxPass) credentials.push({ label: "InfluxDB", user: "admin", pass: influxPass });
        // Full access map — every routed service subdomain (Traefik Host rules).
        const host = `${prefix}${domain}`;
        const services: { label: string; sub: string }[] = [
          { label: "Hub", sub: "" },
          { label: "FlowMaker", sub: "flowmaker" },
          { label: "Grafana", sub: "dashboard" },
          { label: "DataCatalog", sub: "datacatalog" },
          { label: "DataCatalog API", sub: "datacatalog-api" },
          { label: "DataBridge", sub: "databridge" },
          { label: "Scheduler", sub: "scheduler" },
          { label: "ConfigHub", sub: "confighub" },
          { label: "InfluxDB", sub: "influxdb" },
          { label: "MinIO", sub: "minio" },
          { label: "Prometheus", sub: "prometheus" },
          { label: "Alertmanager", sub: "alertmanager" },
        ];
        const urls = services.map((s) => ({
          label: s.label,
          url: `https://${s.sub ? `${s.sub}.` : ""}${host}`,
        }));
        // Self-signed TLS: where to grab the CA + the /etc/hosts block the operator
        // needs on their workstation (local domain → server IP) so the names resolve.
        const selfSigned = tls === "selfsigned";
        const caPath = join(resolved, "certs", `${domain}.crt`);
        let serverIp = "<server-ip>";
        try {
          const { stdout } = await execa("hostname", ["-I"]);
          serverIp =
            stdout.trim().split(/\s+/).find((ip) => /^\d+\.\d+\.\d+\.\d+$/.test(ip) && !ip.startsWith("127.")) ??
            serverIp;
        } catch {
          /* keep placeholder */
        }
        // One `IP name` line per host so it stays copy-pasteable (the pane
        // truncates long lines) and is valid /etc/hosts as-is.
        const hostsBlock = [host, ...services.filter((s) => s.sub).map((s) => `${s.sub}.${host}`)]
          .map((name) => `${serverIp}  ${name}`)
          .join("\n");
        reporter.setResult({
          ok: true,
          summary: `Platform installed (${environment}, ${plan === "community" ? "Community" : "Enterprise"}).`,
          urls,
          credentials,
          secretsDir,
          ...(selfSigned ? { tls: { selfSigned: true, caPath }, hostsBlock } : {}),
          ...(deployStateDir ? { deployState: { dir: deployStateDir } } : {}),
        });
        setStep("done");
        setProgressLine("");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        reporter.log(message);
        reporter.setResult({ ok: false, summary: message, urls: [] });
        setError(message);
        setStep("error");
        setTimeout(() => exit(), 3000);
      }
    }
    runInstall();
  }, [introDone, configDone, workersChosen]);

  // When done, Enter/q exits and launches status. We deliberately do NOT exit on
  // arrow / PgUp / PgDn / g / G so those keys stay free to scroll the Log pane's
  // ScrollPane (which reads them via its own useInput) even after completion.
  useInput(
    async (input, key) => {
      if (step !== "done") return;
      if (!(key.return || input === "q" || input === " ")) return;
      exit();
      const { runStatus } = await import("./status.js");
      setTimeout(() => runStatus(), 200);
    },
    { isActive: step === "done" },
  );

  const isDone = step === "done";
  const isError = step === "error";

  // Show the building intro before the install starts
  if (!introDone) {
    return (
      <Box flexDirection="column">
        <BoltBuilder duration={5000} onComplete={() => setIntroDone(true)} />
      </Box>
    );
  }

  // Interactive config prompt (runtime + domain + TLS mode)
  if (!configDone) {
    return (
      <Box flexDirection="column">
        <Banner />
        <InstallConfigPrompt
          defaultDomain={domain}
          defaultTls={(tls === "letsencrypt" ? "letsencrypt" : "selfsigned")}
          defaultRuntime={runtimeName === "compose" ? "compose" : "swarm"}
          initialLicenseLabel={licenseLabel}
          activateLicense={handleActivateLicense}
          onComplete={(config) => {
            setDomain(config.domain);
            setTls(config.tls);
            setRuntimeName(config.runtime);
            setConfigDone(true);
          }}
        />
      </Box>
    );
  }

  // Worker fleet selection (swarm + interactive only; compose/headless skip it).
  if (!workersChosen) {
    return (
      <Box flexDirection="column">
        <Banner />
        <WorkerSelector
          workers={workerModules}
          plan={currentPlan}
          onComplete={(services) => {
            setSelectedWorkers(services);
            setWorkersChosen(true);
          }}
        />
      </Box>
    );
  }

  // Execution phase. With a TTY, render the same 4-pane DeployDashboard that
  // `industream deploy` uses, driven by the reporter populated in runInstall().
  // In CI / non-TTY, fall back to the plain InstallSteps + status lines.
  if (useDashboard) {
    return (
      <Box flexDirection="column">
        <DeployDashboard
          reporter={reporter}
          title={`Industream · install · ${environment} · ${runtimeName}`}
        />
        {isDone && (
          <Box marginTop={1}>
            <Text color="blue">Press Enter to view status · ↑/↓ scroll log</Text>
          </Box>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Banner />
      <InstallSteps current={step} isError={isError} />
      {isError && (
        <Box marginTop={1} flexDirection="column">
          <Text color="red">Installation failed: {error}</Text>
        </Box>
      )}
      {isDone && (
        <Box marginTop={1} flexDirection="column">
          <Text color="green" bold>
            Installation complete!
          </Text>
          {modulesSummary.length > 0 && (
            <Text dimColor>{modulesSummary}</Text>
          )}
          <Box marginTop={1}>
            <Text color="blue">Press Enter to view status · ↑/↓ scroll log</Text>
          </Box>
        </Box>
      )}
      {!isDone && !isError && (
        <Box marginTop={1} flexDirection="column">
          <Text color="blue">{statusMessage}</Text>
          {progressLine.length > 0 && (
            <Text dimColor>  {progressLine}</Text>
          )}
          {step === "modules" && allModules.length > 0 && (
            <Box marginTop={1}>
              <ModuleSelector modules={allModules} plan={currentPlan} />
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

async function confirmReinstall(): Promise<boolean> {
  console.log("");
  console.log("  \x1b[1;33m⚠  Platform is already installed\x1b[0m");
  console.log("");
  console.log("  Running \x1b[1minstall\x1b[0m will reconfigure everything from scratch.");
  console.log("  For most cases you should use one of these instead:");
  console.log("");
  console.log("    \x1b[1mindustream config\x1b[0m   — edit platform .env (domain, TLS, ...)");
  console.log("    \x1b[1mindustream update\x1b[0m   — pull latest stack changes");
  console.log("    \x1b[1mindustream deploy\x1b[0m   — re-apply the stack (regenerates certs + UIFusion config)");
  console.log("");
  console.log("  \x1b[32m✓ Your data is safe:\x1b[0m named volumes (PostgreSQL, InfluxDB, MinIO,");
  console.log("    Grafana, TimescaleDB) and existing secrets are \x1b[1mpreserved\x1b[0m. Reinstall");
  console.log("    re-runs the deploy + regenerates configs/certs — it does \x1b[1mNOT\x1b[0m delete");
  console.log("    volumes or wipe data.");
  console.log("");

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question("  Reinstall anyway? [y/N]: ", (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

export async function runInstall(
  environment?: string,
  domain?: string,
  tls?: string,
  runtime?: string,
  withPortainer?: boolean,
): Promise<void> {
  const alreadyInstalled = await isPlatformInstalled("~/industream-platform");
  if (alreadyInstalled) {
    const confirmed = await confirmReinstall();
    if (!confirmed) {
      console.log("  Install cancelled.");
      return;
    }
  }
  render(
    <InstallWizard
      environment={environment ?? "prod"}
      domain={domain}
      tls={tls}
      runtime={runtime}
      withPortainer={withPortainer ?? false}
    />,
  );
}
