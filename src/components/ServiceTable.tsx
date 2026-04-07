import React from "react";
import { Text, Box } from "ink";
import type { SwarmService } from "../lib/docker.js";
import type { Module } from "../lib/modules.js";
import { isLatest } from "../lib/release-tracker.js";

interface ServiceTableProps {
  services: SwarmService[];
  modules?: Module[];
  lockedModuleIds?: string[];
}

const CATEGORY_ORDER = [
  "FlowMaker",
  "Workers",
  "Platform",
  "DataBridge",
  "DataCatalog",
  "Monitoring",
  "Backup",
  "Ecosystem",
];

function getModuleForService(
  serviceName: string,
  modules: Module[],
): Module | undefined {
  return modules.find((m) => m.serviceName === serviceName);
}

function isCronjob(serviceName: string, modules: Module[]): boolean {
  return getModuleForService(serviceName, modules)?.type === "cronjob";
}

function getCategoryForService(
  serviceName: string,
  modules: Module[],
): string {
  return getModuleForService(serviceName, modules)?.category ?? "Other";
}

function groupServicesByCategory(
  services: SwarmService[],
  modules: Module[],
): Map<string, SwarmService[]> {
  const groups = new Map<string, SwarmService[]>();
  for (const service of services) {
    const category = getCategoryForService(service.name, modules);
    const existing = groups.get(category) ?? [];
    existing.push(service);
    groups.set(category, existing);
  }
  // Within each group, sort: services first, cronjobs last
  for (const [category, list] of groups) {
    list.sort((a, b) => {
      const aCron = isCronjob(a.name, modules);
      const bCron = isCronjob(b.name, modules);
      if (aCron === bCron) return a.name.localeCompare(b.name);
      return aCron ? 1 : -1;
    });
    groups.set(category, list);
  }
  return groups;
}

function sortCategories(categories: string[]): string[] {
  return categories.sort((a, b) => {
    const indexA = CATEGORY_ORDER.indexOf(a);
    const indexB = CATEGORY_ORDER.indexOf(b);
    if (indexA === -1 && indexB === -1) return a.localeCompare(b);
    if (indexA === -1) return 1;
    if (indexB === -1) return -1;
    return indexA - indexB;
  });
}

export function ServiceTable({
  services,
  modules = [],
  lockedModuleIds = [],
}: ServiceTableProps): React.ReactElement {
  if (modules.length === 0) {
    return <FlatServiceTable services={services} lockedModuleIds={lockedModuleIds} />;
  }

  const groups = groupServicesByCategory(services, modules);
  const sortedCategories = sortCategories(Array.from(groups.keys()));

  return (
    <Box flexDirection="column">
      <Box>
        <Box width={32}>
          <Text bold>SERVICE</Text>
        </Box>
        <Box width={10}>
          <Text bold>STATUS</Text>
        </Box>
        <Box width={22}>
          <Text bold>VERSION</Text>
        </Box>
        <Box width={14}>
          <Text bold>UPTIME</Text>
        </Box>
      </Box>
      {sortedCategories.map((category) => {
        const categoryServices = groups.get(category) ?? [];
        // Count only non-cronjob services in the running tally
        const realServices = categoryServices.filter(
          (s) => !isCronjob(s.name, modules),
        );
        const runningCount = realServices.filter((s) => s.isRunning).length;
        return (
          <Box key={category} flexDirection="column" marginTop={1}>
            <Text bold color="blue">
              ── {category} ({runningCount}/{realServices.length}) ──
            </Text>
            {categoryServices.map((service) => (
              <ServiceRow
                key={service.name}
                service={service}
                isLocked={lockedModuleIds.includes(service.name)}
                isCronjob={isCronjob(service.name, modules)}
              />
            ))}
          </Box>
        );
      })}
    </Box>
  );
}

function ServiceRow({
  service,
  isLocked,
  isCronjob = false,
}: {
  service: SwarmService;
  isLocked: boolean;
  isCronjob?: boolean;
}): React.ReactElement {
  const statusIcon = isLocked
    ? "🔒"
    : isCronjob
      ? "◷"
      : service.isRunning
        ? "●"
        : "○";
  const statusColor = isLocked
    ? "gray"
    : isCronjob
      ? "gray"
      : service.isRunning
        ? "green"
        : "red";
  const statusText = isLocked
    ? "premium"
    : isCronjob
      ? "scheduled"
      : service.isRunning
        ? "running"
        : "stopped";

  const hasUpdate =
    service.latestVersion &&
    service.version !== "latest" &&
    !isLatest(service.version, service.latestVersion);
  const versionDisplay = isLocked
    ? "—"
    : hasUpdate
      ? `${service.version} → ${service.latestVersion}`
      : service.version;
  const versionColor = hasUpdate ? "yellow" : undefined;

  return (
    <Box>
      <Box width={32}>
        <Text>
          <Text color={statusColor}>{statusIcon}</Text> {service.name}
        </Text>
      </Box>
      <Box width={10}>
        <Text color={statusColor}>{statusText}</Text>
      </Box>
      <Box width={22}>
        <Text color={versionColor} dimColor={isLocked}>
          {versionDisplay}
        </Text>
      </Box>
      <Box width={14}>
        <Text dimColor>{service.uptime ?? "—"}</Text>
      </Box>
    </Box>
  );
}

function FlatServiceTable({
  services,
  lockedModuleIds,
}: {
  services: SwarmService[];
  lockedModuleIds: string[];
}): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={32}>
          <Text bold>SERVICE</Text>
        </Box>
        <Box width={10}>
          <Text bold>STATUS</Text>
        </Box>
        <Box width={22}>
          <Text bold>VERSION</Text>
        </Box>
        <Box width={14}>
          <Text bold>UPTIME</Text>
        </Box>
      </Box>
      {services.map((service) => (
        <ServiceRow
          key={service.name}
          service={service}
          isLocked={lockedModuleIds.includes(service.name)}
        />
      ))}
    </Box>
  );
}
