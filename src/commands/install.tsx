import React, { useState, useEffect } from "react";
import { render, Text, Box, useApp } from "ink";
import { BoltAnimated } from "../components/BoltAnimated.js";
import { Banner } from "../components/Banner.js";
import { saveConfig } from "../lib/config.js";
import { isDockerAvailable, isSwarmActive } from "../lib/docker.js";
import {
  cloneSwarmRepo,
  isPlatformInstalled,
  loadEnvFile,
  resolvePlatformDir,
} from "../lib/swarm-repo.js";
import { execa } from "execa";
import { join } from "node:path";

type Step =
  | "prerequisites"
  | "clone"
  | "setup"
  | "done"
  | "error";

const BOLT_MESSAGES: Record<Step, string> = {
  prerequisites: "Let me check your system...",
  clone: "Downloading the good stuff...",
  setup: "Setting everything up...",
  done: "Welcome to Industream!",
  error: "Oops, something went wrong...",
};

function InstallWizard(): React.ReactElement {
  const { exit } = useApp();
  const [step, setStep] = useState<Step>("prerequisites");
  const [statusMessage, setStatusMessage] = useState("Checking prerequisites...");
  const [error, setError] = useState<string | null>(null);
  const platformDirectory = "~/industream-platform";

  useEffect(() => {
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
        setStatusMessage("Downloading platform files...");
        const resolved = resolvePlatformDir(platformDirectory);
        if (await isPlatformInstalled(platformDirectory)) {
          setStatusMessage("Platform files already present, updating...");
          await execa("git", ["-C", resolved, "pull", "--ff-only"]);
        } else {
          await cloneSwarmRepo(platformDirectory);
        }

        // Step 3: Setup (Traefik, secrets, swarm deploy, seed)
        setStep("setup");

        setStatusMessage("Deploying Traefik...");
        await execa(join(resolved, "scripts/deploy-traefik.sh"), [], {
          cwd: resolved,
          stdio: "inherit",
        });

        setStatusMessage("Creating secrets...");
        await execa(join(resolved, "scripts/setup/create-secrets.sh"), ["--env", "prod"], {
          cwd: resolved,
          stdio: "inherit",
        });

        setStatusMessage("Deploying swarm stack...");
        await execa(join(resolved, "scripts/deploy-swarm.sh"), ["--env", "prod"], {
          cwd: resolved,
          stdio: "inherit",
        });

        // Read domain from .env
        const environment = await loadEnvFile(platformDirectory);
        const domain = environment["DOMAIN"] ?? "industream.platform.lan";

        setStatusMessage("Seeding ConfigHub...");
        await execa(
          join(resolved, "scripts/setup/seed-confighub.sh"),
          ["--stack", "industream-prod", "--domain", domain],
          {
            cwd: resolved,
            stdio: "inherit",
          },
        );

        // Step 4: Save config
        await saveConfig({
          platformDir: platformDirectory,
          defaultEnvironment: "prod",
        });

        setStep("done");
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStep("error");
      }
    }
    runInstall();
  }, []);

  const isDone = step === "done";
  const isError = step === "error";
  const isDancing = !isError;

  return (
    <Box flexDirection="column">
      <Banner />
      <BoltAnimated dancing={isDancing} message={BOLT_MESSAGES[step]} />
      {isError && (
        <Box marginTop={1}>
          <Text color="red">Installation failed: {error}</Text>
        </Box>
      )}
      {isDone && (
        <Box marginTop={1} flexDirection="column">
          <Text color="green" bold>
            Installation complete!
          </Text>
          <Text dimColor>Run `industream status` to check your platform.</Text>
        </Box>
      )}
      {!isDone && !isError && (
        <Box marginTop={1}>
          <Text dimColor>{statusMessage}</Text>
        </Box>
      )}
    </Box>
  );
}

export function runInstall(): void {
  render(<InstallWizard />);
}
