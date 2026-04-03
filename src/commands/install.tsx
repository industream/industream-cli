import React, { useState, useEffect } from "react";
import { render, Text, Box, useApp } from "ink";
import { Spinner } from "../components/Spinner.js";
import { Banner } from "../components/Banner.js";
import { saveConfig } from "../lib/config.js";
import { isDockerAvailable, isSwarmActive } from "../lib/docker.js";
import {
  cloneSwarmRepo,
  isPlatformInstalled,
  resolvePlatformDir,
} from "../lib/swarm-repo.js";
import { execa } from "execa";
import { join } from "node:path";

type Step =
  | "prerequisites"
  | "clone"
  | "setup"
  | "deploy"
  | "done"
  | "error";

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
        if (await isPlatformInstalled(platformDirectory)) {
          setStatusMessage("Platform files already present, updating...");
          const resolved = resolvePlatformDir(platformDirectory);
          await execa("git", ["-C", resolved, "pull", "--ff-only"]);
        } else {
          await cloneSwarmRepo(platformDirectory);
        }

        // Step 3: Setup (.env, secrets)
        setStep("setup");
        const resolved = resolvePlatformDir(platformDirectory);
        setStatusMessage("Running platform setup...");
        await execa(join(resolved, "industream.sh"), [], {
          cwd: resolved,
          stdio: "inherit",
        });

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

  if (step === "error") {
    return (
      <Box flexDirection="column">
        <Banner />
        <Text color="red">Installation failed: {error}</Text>
      </Box>
    );
  }

  if (step === "done") {
    return (
      <Box flexDirection="column">
        <Banner />
        <Text color="green" bold>
          Installation complete!
        </Text>
        <Text dimColor>Run `industream status` to check your platform.</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Banner />
      <Spinner label={statusMessage} />
    </Box>
  );
}

export function runInstall(): void {
  render(<InstallWizard />);
}
