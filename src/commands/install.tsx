import React, { useState, useEffect } from "react";
import { render, Text, Box, useApp } from "ink";
import { BoltAnimated } from "../components/BoltAnimated.js";
import { BoltBuilder } from "../components/BoltBuilder.js";
import { Banner } from "../components/Banner.js";
import { ModuleSelector } from "../components/ModuleSelector.js";
import { saveConfig } from "../lib/config.js";
import { isDockerAvailable, isSwarmActive } from "../lib/docker.js";
import {
  cloneSwarmRepo,
  isPlatformInstalled,
  loadEnvFile,
  resolvePlatformDir,
} from "../lib/swarm-repo.js";
import { loadLicenseFromDisk, validateLicense } from "../lib/license.js";
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

function InstallWizard(): React.ReactElement {
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

        // Step 3: Modules
        setStep("modules");
        setProgressLine("");
        setStatusMessage("Analyzing modules...");

        const licenseToken = await loadLicenseFromDisk();
        const licenseResult = await validateLicense(licenseToken);
        const moduleRegistry = loadModuleRegistry();
        const bslModules = getModulesByLicense(moduleRegistry, "bsl");
        const apacheModules = getModulesByLicense(moduleRegistry, "apache");
        const proprietaryModules = getModulesByLicense(moduleRegistry, "proprietary");
        const communityCount = bslModules.length + apacheModules.length;
        const premiumCount = proprietaryModules.length;
        const totalCount = communityCount + premiumCount;

        const plan = licenseResult.payload?.plan ?? "community";
        setAllModules(moduleRegistry.modules);
        setCurrentPlan(plan as Plan);
        const isLicensed = licenseResult.isValid && plan !== "community";

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

        // Check Docker registry login
        setStatusMessage("Checking registry access...");
        setProgressLine("");
        const dockerRegistry = "842775dh.c1.gra9.container-registry.ovh.net";
        const { stdout: authConfig } = await execa("docker", ["system", "info", "--format", "{{json .RegistryConfig}}"]).catch(() => ({ stdout: "" }));
        const isLoggedIn = authConfig.includes(dockerRegistry) ||
          (await execa("cat", [`${process.env.HOME}/.docker/config.json`]).then(
            (r) => r.stdout.includes(dockerRegistry),
          ).catch(() => false));
        if (!isLoggedIn) {
          throw new Error(
            `Not logged in to Docker registry.\nRun first: docker login ${dockerRegistry}\nThen re-run: industream install`,
          );
        }

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
          ["--env", "prod"],
          resolved,
          (line) => setProgressLine(line),
        );
        await new Promise((resolve) => setTimeout(resolve, 1500));

        setStatusMessage("Deploying platform stack...");
        setProgressLine("");
        // Build deploy args — exclude premium services if community plan
        const deployArgs = ["--env", "prod"];
        const { getDeployFlags } = await import("../lib/stack-filter.js");
        const deployFlags = await getDeployFlags(resolved);
        if (deployFlags.excludedServices.length > 0) {
          deployArgs.push("--exclude", deployFlags.excludedServices.join(","));
        }
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

        // Read domain from .env
        const environment = await loadEnvFile(platformDirectory);
        const domain = environment["INDUSTREAM_DOMAIN"] ?? "industream.platform.lan";

        setStatusMessage("Seeding ConfigHub...");
        setProgressLine("");
        await runScript(
          join(resolved, "scripts/setup/seed-confighub.sh"),
          ["--stack", "industream-prod", "--domain", domain],
          resolved,
          (line) => setProgressLine(line),
        );

        // Save config
        await saveConfig({
          platformDir: platformDirectory,
          defaultEnvironment: "prod",
          domain,
        });

        setStep("done");
        setProgressLine("");
        // Let user see the success message, then exit
        setTimeout(() => exit(), 3000);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStep("error");
        setTimeout(() => exit(), 3000);
      }
    }
    runInstall();
  }, [introDone]);

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
          <Text dimColor>Run `industream status` to check your platform.</Text>
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

export function runInstall(): void {
  render(<InstallWizard />);
}
