import React, { useState, useEffect } from "react";
import { render, Text, Box, useApp, useInput } from "ink";
import { BoltAnimated } from "../components/BoltAnimated.js";
import { BoltBuilder } from "../components/BoltBuilder.js";
import { Banner } from "../components/Banner.js";
import { ModuleSelector } from "../components/ModuleSelector.js";
import { saveConfig } from "../lib/config.js";
import { isDockerAvailable, isSwarmActive } from "../lib/docker.js";
import {
  cloneSwarmRepo,
  isPlatformInstalled,
  resolvePlatformDir,
  updateEnvValue,
} from "../lib/swarm-repo.js";
import { validateLicenseWithKeygen } from "../lib/keygen.js";
import { loadModuleRegistry, getModulesByLicense } from "../lib/modules.js";
import type { Module, Plan } from "../lib/modules.js";
import { execa } from "execa";
import { join } from "node:path";

type Step =
  | "prerequisites"
  | "clone"
  | "modules"
  | "setup"
  | "done"
  | "error";

const BOLT_MESSAGES: Record<Step, string[]> = {
  prerequisites: [
    "Let me check your system...",
    "Hmm, let me see what we're working with...",
    "Just making sure everything's in order...",
  ],
  clone: [
    "Downloading the good stuff...",
    "Grabbing the latest recipes from HQ...",
    "Almost there, just fetching a few things...",
  ],
  modules: [
    "Checking your module lineup...",
    "Let's see what you've got...",
  ],
  setup: [
    "Setting everything up, hang tight!",
    "Wiring all the things together...",
    "This is the fun part!",
    "Pulling images... this might take a minute.",
    "Still working... good things take time!",
    "Making your factory smarter, one container at a time...",
    "If I had fingers, I'd be crossing them...",
    "Almost there... I think.",
    "Did you know? Industream can monitor a blast furnace!",
    "Loading industrial awesomeness...",
  ],
  done: [
    "Welcome to Industream! You're all set!",
  ],
  error: [
    "Oops, something went sideways...",
  ],
};

// Run a script and stream last meaningful line to a callback
async function runScript(
  scriptPath: string,
  args: string[],
  cwd: string,
  onProgress: (line: string) => void,
): Promise<void> {
  const subprocess = execa(scriptPath, args, {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });

  subprocess.stdout?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((line) => line.trim().length > 0);
    const lastLine = lines.at(-1);
    if (lastLine) {
      // Strip ANSI color codes for clean display
      const clean = lastLine.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (clean.length > 0) {
        onProgress(clean.slice(0, 80));
      }
    }
  });

  subprocess.stderr?.on("data", (data: Buffer) => {
    const lines = data.toString().split("\n").filter((line) => line.trim().length > 0);
    const lastLine = lines.at(-1);
    if (lastLine) {
      const clean = lastLine.replace(/\x1b\[[0-9;]*m/g, "").trim();
      if (clean.length > 0 && !clean.startsWith("WARNING")) {
        onProgress(clean.slice(0, 80));
      }
    }
  });

  await subprocess;
}

function InstallWizard({ environment = "prod", domain = "industream.platform.lan" }: { environment?: string; domain?: string }): React.ReactElement {
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

  useEffect(() => {
    if (!introDone) return;
    async function runInstall() {
      try {
        // Step 1: Prerequisites
        setStep("prerequisites");
        setStatusMessage("Checking Docker...");
        if (!(await isDockerAvailable())) {
          throw new Error(
            "Docker is not installed. Install Docker first: https://docs.docker.com/engine/install/",
          );
        }
        setStatusMessage("Checking Docker Swarm...");
        if (!(await isSwarmActive())) {
          setStatusMessage("Initializing Docker Swarm...");
          await execa("/usr/bin/docker", ["swarm", "init"]);
        }

        // Step 2: Clone repo
        setStep("clone");
        setProgressLine("");
        setStatusMessage("Downloading platform files...");
        const resolved = resolvePlatformDir(platformDirectory);
        if (await isPlatformInstalled(platformDirectory)) {
          setStatusMessage("Platform files already present, updating...");
          await execa("git", ["-C", resolved, "pull", "--ff-only"]);
        } else {
          await cloneSwarmRepo(platformDirectory);
        }

        // Set domain and TLS mode in .env before deploy
        const isLocalDomain = /\.(lan|local|localhost)$/.test(domain);
        const tlsMode = isLocalDomain ? "selfsigned" : "letsencrypt";
        setStatusMessage(`Configuring domain: ${domain} (TLS: ${tlsMode})`);
        await updateEnvValue(platformDirectory, "INDUSTREAM_DOMAIN", domain);
        await updateEnvValue(platformDirectory, "TLS_MODE", tlsMode);
        if (!isLocalDomain) {
          await updateEnvValue(platformDirectory, "ACME_EMAIL", "admin@industream.com");
        }

        // Step 3: Modules
        setStep("modules");
        setProgressLine("");
        setStatusMessage("Analyzing modules...");

        const licenseResult = await validateLicenseWithKeygen();
        const moduleRegistry = loadModuleRegistry();
        const bslModules = getModulesByLicense(moduleRegistry, "bsl");
        const apacheModules = getModulesByLicense(moduleRegistry, "apache");
        const proprietaryModules = getModulesByLicense(moduleRegistry, "proprietary");
        const communityCount = bslModules.length + apacheModules.length;
        const premiumCount = proprietaryModules.length;
        const totalCount = communityCount + premiumCount;

        const plan = (licenseResult.cache?.plan ?? "community") as Plan;
        setAllModules(moduleRegistry.modules);
        setCurrentPlan(plan);
        const isLicensed = licenseResult.valid && plan !== "community";

        if (isLicensed) {
          const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
          setStatusMessage(`Deploying all ${totalCount} modules (${planLabel} license)`);
          setModulesSummary(`${totalCount} modules deployed.`);
        } else {
          setStatusMessage(
            `Deploying ${communityCount} community modules (${premiumCount} premium modules available with license)`,
          );
          setModulesSummary(
            `${communityCount} modules deployed. ${premiumCount} premium modules available with a license.`,
          );
        }

        // Pause so user can read the module summary and configuration
        await new Promise((resolve) => setTimeout(resolve, 5000));

        // Step 4: Setup
        setStep("setup");

        // Check / setup Docker registry login
        setStatusMessage("Checking registry access...");
        setProgressLine("");
        const dockerRegistry = "842775dh.c1.gra9.container-registry.ovh.net";
        const { ensureRegistryLogin } = await import("../lib/registry-login.js");
        await ensureRegistryLogin(dockerRegistry, plan);

        setStatusMessage("Deploying Traefik...");
        setProgressLine("");
        await runScript(
          join(resolved, "scripts/deploy-traefik.sh"),
          [],
          resolved,
          (line) => setProgressLine(line),
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));

        setStatusMessage("Creating secrets...");
        setProgressLine("");
        await runScript(
          join(resolved, "scripts/setup/create-secrets.sh"),
          ["--env", environment],
          resolved,
          (line) => setProgressLine(line),
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));

        setStatusMessage("Deploying platform stack...");
        setProgressLine("");
        // Build deploy args — exclude premium services if community plan
        const deployArgs = ["--env", environment];
        const { getDeployFlags } = await import("../lib/stack-filter.js");
        const deployFlags = await getDeployFlags(resolved);
        if (deployFlags.excludedServices.length > 0) {
          deployArgs.push("--exclude", deployFlags.excludedServices.join(","));
        }
        if (plan === "community") {
          // Community mode: redirect image paths to the flowmaker.community
          // public project (handled by deploy-swarm.sh --community flag)
          deployArgs.push("--community");
        }
        // Skip memory check in non-interactive CLI mode (no TTY for confirmation prompt)
        deployArgs.push("--skip-memory-check");
        // Pass "y" to stdin for any interactive prompts (registry login, continue, etc.)
        const deployProcess = execa(
          join(resolved, "scripts/deploy-swarm.sh"),
          deployArgs,
          { cwd: resolved, stdout: "pipe", stderr: "pipe", stdin: "pipe" },
        );
        deployProcess.stdin?.write("y\ny\ny\ny\n");
        deployProcess.stdin?.end();
        deployProcess.stdout?.on("data", (data: Buffer) => {
          const lines = data.toString().split("\n").filter((l) => l.trim().length > 0);
          const lastLine = lines.at(-1);
          if (lastLine) {
            const clean = lastLine.replace(/\x1b\[[0-9;]*m/g, "").trim();
            if (clean.length > 0) setProgressLine(clean.slice(0, 80));
          }
        });
        deployProcess.stderr?.on("data", (data: Buffer) => {
          const lines = data.toString().split("\n").filter((l) => l.trim().length > 0);
          const lastLine = lines.at(-1);
          if (lastLine) {
            const clean = lastLine.replace(/\x1b\[[0-9;]*m/g, "").trim();
            if (clean.length > 0 && !clean.startsWith("WARNING")) setProgressLine(clean.slice(0, 80));
          }
        });
        await deployProcess;

        // Wait for ConfigHub to be ready before seeding
        setStatusMessage("Waiting for services to start...");
        setProgressLine("ConfigHub needs to be ready before seeding...");
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
          setProgressLine(`Waiting for ConfigHub... (${attempt + 1}/60)`);
          await new Promise((resolve) => setTimeout(resolve, 5000));
        }

        if (!configHubReady) {
          setProgressLine("ConfigHub not ready after 5 minutes — skipping seed");
        }

        setStatusMessage("Seeding ConfigHub...");
        setProgressLine("");
        // Add a small delay for the service to fully initialize
        if (configHubReady) {
          await new Promise((resolve) => setTimeout(resolve, 10000));
        }
        await runScript(
          join(resolved, "scripts/setup/seed-confighub.sh"),
          ["--stack", stackName, "--domain", domain],
          resolved,
          (line) => setProgressLine(line),
        );

        // Save config
        await saveConfig({
          platformDir: platformDirectory,
          defaultEnvironment: environment,
          domain,
        });

        setStep("done");
        setProgressLine("");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStep("error");
        setTimeout(() => exit(), 3000);
      }
    }
    runInstall();
  }, [introDone]);

  // When done, any key press exits and launches status
  useInput(
    async (_input, _key) => {
      if (step !== "done") return;
      exit();
      const { runStatus } = await import("./status.js");
      setTimeout(() => runStatus(), 200);
    },
    { isActive: step === "done" },
  );

  const isDone = step === "done";
  const isError = step === "error";
  const isDancing = !isError;

  // Show the building intro before the install starts
  if (!introDone) {
    return (
      <Box flexDirection="column">
        <BoltBuilder duration={5000} onComplete={() => setIntroDone(true)} />
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Banner />
      <BoltAnimated dancing={isDancing} message={BOLT_MESSAGES[step]} />
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
            <Text color="blue">Press any key to view platform status...</Text>
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

export function runInstall(environment?: string, domain?: string): void {
  render(<InstallWizard environment={environment ?? "prod"} domain={domain} />);
}
