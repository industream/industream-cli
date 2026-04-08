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
import { loadModuleRegistry, type Module } from "../lib/modules.js";

interface VersionComparison {
  service: string;
  deployed: string;
  available: string;
  hasUpdate: boolean;
  category: string;
}

const CATEGORY_ORDER = [
  "Platform",
  "Workers",
  "DataBridge",
  "DataCatalog",
  "Monitoring",
  "Backup",
  "Ecosystem",
  "Other",
];

function getCategoryFor(serviceName: string, modules: Module[]): string {
  const m =
    modules.find((mod) => mod.serviceName === serviceName) ??
    modules.find(
      (mod) =>
        mod.serviceName?.includes(serviceName) ||
        serviceName.includes(mod.serviceName ?? ""),
    );
  return m?.category ?? "Other";
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
  modules: Module[],
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
      category: getCategoryFor(normalized, modules),
    });
  }

  return comparisons;
}

function groupByCategory(
  comparisons: VersionComparison[],
): Map<string, VersionComparison[]> {
  const groups = new Map<string, VersionComparison[]>();
  for (const c of comparisons) {
    const list = groups.get(c.category) ?? [];
    list.push(c);
    groups.set(c.category, list);
  }
  // Sort items within each group alphabetically
  for (const [cat, list] of groups) {
    list.sort((a, b) => a.service.localeCompare(b.service));
    groups.set(cat, list);
  }
  return groups;
}

function sortCategories(categories: string[]): string[] {
  return categories.sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a);
    const ib = CATEGORY_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
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

        const registry = loadModuleRegistry();
        const table = buildVersionTable(envVersions, services, registry.modules);
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

  const groups = groupByCategory(comparisons);
  const sortedCategories = sortCategories(Array.from(groups.keys()));

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
        {sortedCategories.map((category) => {
          const items = groups.get(category) ?? [];
          const updates = items.filter((c) => c.hasUpdate).length;
          return (
            <Box key={category} flexDirection="column" marginTop={1}>
              <Text bold color="blue">
                ── {category} ({updates > 0 ? `${updates} update${updates > 1 ? "s" : ""}` : "up to date"}) ──
              </Text>
              {items.map((comparison) => (
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
          );
        })}
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
