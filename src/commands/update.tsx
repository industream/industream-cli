// src/commands/update.tsx
import React, { useState, useEffect } from "react";
import { render, Text, Box, useInput, useApp } from "ink";
import { Banner } from "../components/Banner.js";
import { loadConfig } from "../lib/config.js";
import {
  pullSwarmRepo,
  getDeployedVersions,
  isPlatformInstalled,
} from "../lib/swarm-repo.js";
import { getSwarmServices, isSwarmActive } from "../lib/docker.js";
import type { SwarmService } from "../lib/docker.js";

interface VersionComparison {
  service: string;
  deployed: string;
  available: string;
  hasUpdate: boolean;
}

function normalizeServiceName(envKey: string): string {
  return envKey
    .replace(/_VERSION$/, "")
    .toLowerCase()
    .replace(/_/g, "-");
}

function buildVersionTable(
  envVersions: Record<string, string>,
  runningServices: SwarmService[],
): VersionComparison[] {
  const comparisons: VersionComparison[] = [];

  for (const [key, available] of Object.entries(envVersions)) {
    const normalized = normalizeServiceName(key);
    const running = runningServices.find(
      (service) =>
        service.name === normalized ||
        service.name.includes(normalized) ||
        normalized.includes(service.name),
    );
    const deployed = running?.version ?? "not running";
    comparisons.push({
      service: normalized,
      deployed,
      available,
      hasUpdate: deployed !== available && deployed !== "not running",
    });
  }

  return comparisons;
}

function UpdateDashboard(): React.ReactElement {
  const { exit } = useApp();
  const [pullOutput, setPullOutput] = useState<string | null>(null);
  const [comparisons, setComparisons] = useState<VersionComparison[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function checkUpdates() {
      try {
        const config = await loadConfig();
        const { platformDir } = config;

        const installed = await isPlatformInstalled(platformDir);
        if (!installed) {
          setError(
            "Platform not installed. Run: industream install",
          );
          setLoading(false);
          return;
        }

        const output = await pullSwarmRepo(platformDir);
        setPullOutput(output);

        const envVersions = await getDeployedVersions(platformDir);

        const swarmActive = await isSwarmActive();
        let services: SwarmService[] = [];
        if (swarmActive) {
          const stackName = `industream-${config.defaultEnvironment}`;
          services = await getSwarmServices(stackName);
        }

        const table = buildVersionTable(envVersions, services);
        setComparisons(table);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to check updates",
        );
      } finally {
        setLoading(false);
      }
    }
    checkUpdates();
  }, []);

  useInput((input) => {
    if (input === "q") exit();
  });

  if (loading) {
    return <Text color="blue">Pulling latest changes and checking versions...</Text>;
  }

  if (error) {
    return <Text color="red">{error}</Text>;
  }

  const updatesAvailable = comparisons.filter((c) => c.hasUpdate).length;
  const maxServiceLength = Math.max(
    "Service".length,
    ...comparisons.map((c) => c.service.length),
  );
  const maxDeployedLength = Math.max(
    "Deployed".length,
    ...comparisons.map((c) => c.deployed.length),
  );
  const maxAvailableLength = Math.max(
    "Available".length,
    ...comparisons.map((c) => c.available.length),
  );

  return (
    <Box flexDirection="column">
      <Banner />
      <Box marginLeft={2} marginBottom={1}>
        <Text dimColor>git pull: {pullOutput ?? "done"}</Text>
      </Box>
      <Box marginLeft={2} flexDirection="column">
        <Box>
          <Text bold>
            {"  "}
            {"Service".padEnd(maxServiceLength)}
            {"  "}
            {"Deployed".padEnd(maxDeployedLength)}
            {"  "}
            {"Available".padEnd(maxAvailableLength)}
            {"  "}
            Status
          </Text>
        </Box>
        <Box>
          <Text dimColor>
            {"  "}
            {"─".repeat(maxServiceLength)}
            {"  "}
            {"─".repeat(maxDeployedLength)}
            {"  "}
            {"─".repeat(maxAvailableLength)}
            {"  "}
            {"─".repeat(10)}
          </Text>
        </Box>
        {comparisons.map((comparison) => (
          <Box key={comparison.service}>
            <Text>
              {"  "}
              {comparison.service.padEnd(maxServiceLength)}
              {"  "}
            </Text>
            <Text color={comparison.deployed === "not running" ? "yellow" : undefined}>
              {comparison.deployed.padEnd(maxDeployedLength)}
            </Text>
            <Text>{"  "}{comparison.available.padEnd(maxAvailableLength)}{"  "}</Text>
            <Text color={comparison.hasUpdate ? "yellow" : "green"}>
              {comparison.hasUpdate ? "⬆ update" : "✓ latest"}
            </Text>
          </Box>
        ))}
      </Box>
      <Box marginTop={1} marginLeft={2}>
        <Text>
          {updatesAvailable > 0 ? (
            <Text color="yellow">
              {updatesAvailable} update{updatesAvailable > 1 ? "s" : ""} available — run{" "}
              <Text bold>industream deploy</Text> to apply
            </Text>
          ) : (
            <Text color="green">All services are up to date</Text>
          )}
        </Text>
      </Box>
      <Box marginTop={1} marginLeft={2}>
        <Text dimColor>Press q to quit</Text>
      </Box>
    </Box>
  );
}

export function runUpdate(): void {
  render(<UpdateDashboard />);
}
