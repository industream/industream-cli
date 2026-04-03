// src/components/ServiceTable.tsx
import React from "react";
import { Text, Box } from "ink";
import type { SwarmService } from "../lib/docker.js";

interface ServiceTableProps {
  services: SwarmService[];
  lockedModuleIds?: string[];
}

export function ServiceTable({
  services,
  lockedModuleIds = [],
}: ServiceTableProps): React.ReactElement {
  return (
    <Box flexDirection="column">
      <Box>
        <Box width={28}>
          <Text bold>SERVICE</Text>
        </Box>
        <Box width={12}>
          <Text bold>STATUS</Text>
        </Box>
        <Box width={15}>
          <Text bold>VERSION</Text>
        </Box>
      </Box>
      {services.map((service) => {
        const isLocked = lockedModuleIds.includes(service.name);
        const statusIcon = isLocked ? "🔒" : service.isRunning ? "●" : "○";
        const statusColor = isLocked
          ? "gray"
          : service.isRunning
            ? "green"
            : "red";
        const statusText = isLocked
          ? "premium"
          : service.isRunning
            ? "running"
            : "stopped";

        return (
          <Box key={service.name}>
            <Box width={28}>
              <Text>
                <Text color={statusColor}>{statusIcon}</Text> {service.name}
              </Text>
            </Box>
            <Box width={12}>
              <Text color={statusColor}>{statusText}</Text>
            </Box>
            <Box width={15}>
              <Text dimColor={isLocked}>{isLocked ? "—" : service.version}</Text>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
