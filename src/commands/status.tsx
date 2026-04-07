// src/commands/status.tsx
import React, { useState, useEffect } from "react";
import { render, Text, Box, useInput, useApp } from "ink";
import { Banner } from "../components/Banner.js";
import { ServiceTable } from "../components/ServiceTable.js";
import { getSwarmServices, isSwarmActive } from "../lib/docker.js";
import { loadConfig } from "../lib/config.js";
import { loadModuleRegistry, type Module } from "../lib/modules.js";
import { getLatestVersions, isLatest } from "../lib/release-tracker.js";
import { validateLicenseWithKeygen, type CachedLicense } from "../lib/keygen.js";

function StatusDashboard(): React.ReactElement {
  const { exit } = useApp();
  const [services, setServices] = useState<Awaited<ReturnType<typeof getSwarmServices>>>([]);
  const [modules, setModules] = useState<Module[]>([]);
  const [licenseCache, setLicenseCache] = useState<CachedLicense | null>(null);
  const [licenseOnline, setLicenseOnline] = useState(false);
  const [licenseValid, setLicenseValid] = useState(false);
  const [updatesAvailable, setUpdatesAvailable] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const config = await loadConfig();
        const stackName = `industream-${config.defaultEnvironment}`;
        const active = await isSwarmActive();
        if (!active) {
          setError("Docker Swarm is not active. Run: docker swarm init");
          setLoading(false);
          return;
        }
        const [result, registry, latestVersions, licenseResult] = await Promise.all([
          getSwarmServices(stackName),
          loadModuleRegistry(),
          getLatestVersions(),
          validateLicenseWithKeygen(),
        ]);
        let updateCount = 0;
        if (latestVersions) {
          for (const service of result) {
            const latest = latestVersions.get(service.imageName);
            if (latest) {
              service.latestVersion = latest;
              if (
                service.version !== "latest" &&
                !isLatest(service.version, latest)
              ) {
                updateCount++;
              }
            }
          }
        }
        setLicenseCache(licenseResult.cache);
        setLicenseOnline(licenseResult.online);
        setLicenseValid(licenseResult.valid);
        setUpdatesAvailable(updateCount);
        setServices(result);
        setModules(registry.modules);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to get status");
      } finally {
        setLoading(false);
      }
    }
    fetchStatus();
  }, []);

  useInput((input) => {
    if (input === "q") exit();
  });

  if (loading) {
    return <Text color="blue">Loading services...</Text>;
  }

  if (error) {
    return <Text color="red">{error}</Text>;
  }

  const running = services.filter((s) => s.isRunning).length;
  const plan = licenseCache?.plan ?? "community";
  const planLabel = plan.charAt(0).toUpperCase() + plan.slice(1);
  const customer = licenseCache?.customer;
  const expiry = licenseCache?.response.data?.attributes.expiry;
  const daysRemaining = expiry
    ? Math.floor((new Date(expiry).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : undefined;
  const planColor =
    plan === "community" ? "gray" : licenseValid ? "green" : "red";
  const entitlementCount = licenseCache?.entitlements.length ?? 0;

  return (
    <Box flexDirection="column">
      <Banner />
      <Box flexDirection="column" marginBottom={1}>
        <Box>
          <Text bold>License: </Text>
          <Text color={planColor} bold>
            {planLabel}
          </Text>
          <Text dimColor>
            {plan === "community" ? " · BSL 1.1 (free)" : " · Commercial"}
          </Text>
          {customer && customer !== "Community" && (
            <Text dimColor> · {customer}</Text>
          )}
          {daysRemaining !== undefined && Number.isFinite(daysRemaining) && plan !== "community" && (
            <Text dimColor> · {daysRemaining} day{daysRemaining > 1 ? "s" : ""} remaining</Text>
          )}
          {!licenseValid && plan !== "community" && (
            <Text color="red"> · INVALID</Text>
          )}
          {!licenseOnline && plan !== "community" && (
            <Text color="yellow"> · OFFLINE</Text>
          )}
        </Box>
        {updatesAvailable > 0 && (
          <Box>
            <Text bold>Updates: </Text>
            <Text color="yellow" bold>
              {updatesAvailable}
            </Text>
            <Text dimColor> service{updatesAvailable > 1 ? "s" : ""} have a new version available</Text>
          </Box>
        )}
        {updatesAvailable === 0 && (
          <Box>
            <Text bold>Updates: </Text>
            <Text color="green">All services up to date</Text>
          </Box>
        )}
      </Box>
      <ServiceTable services={services} modules={modules} />
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          {running}/{services.length} services running — press q to quit
        </Text>
        <Text dimColor>
          BSL 1.1 — commercial use requires a license · https://industream.com/license
        </Text>
      </Box>
    </Box>
  );
}

async function runFallbackStatus(): Promise<void> {
  console.log("");
  console.log("  \x1b[1mINDUSTREAM PLATFORM - STATUS\x1b[0m");
  console.log("");

  try {
    const config = await loadConfig();
    const stackName = `industream-${config.defaultEnvironment}`;
    const active = await isSwarmActive();

    if (!active) {
      console.log("  \x1b[31mDocker Swarm is not active. Run: docker swarm init\x1b[0m");
      console.log("");
      return;
    }

    const services = await getSwarmServices(stackName);
    const running = services.filter((s) => s.isRunning).length;

    console.log("  \x1b[1mServices\x1b[0m");
    for (const service of services) {
      const statusIcon = service.isRunning ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m";
      console.log(
        `    ${statusIcon} ${service.name.padEnd(30)} ${service.replicas.padEnd(10)} ${service.version}`,
      );
    }

    console.log("");
    console.log(`  \x1b[2m${running}/${services.length} services running\x1b[0m`);
    console.log("");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to get status";
    console.log(`  \x1b[31m${message}\x1b[0m`);
    console.log("");
  }
}

export function runStatus(): void {
  // Check if raw mode is supported (TTY with interactive terminal)
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === "function") {
    render(<StatusDashboard />);
  } else {
    // Fallback to simple console output (works in non-interactive environments)
    runFallbackStatus();
  }
}
