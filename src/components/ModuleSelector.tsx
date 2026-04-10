import React from "react";
import { Text, Box } from "ink";
import type { Module, Plan } from "../lib/modules.js";

interface ModuleSelectorProps {
  modules: Module[];
  plan: Plan;
  licensedModuleIds?: string[];
}

export function ModuleSelector({
  modules,
  plan,
}: ModuleSelectorProps): React.ReactElement {
  const bslCount = modules.filter(
    (m) => m.license === "bsl" || m.license === "apache",
  ).length;
  const premiumCount = modules.filter((m) => m.license === "proprietary").length;
  const isLicensed = plan !== "community";

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="green" bold>{"  ✓ "}</Text>
        <Text>{bslCount} BSL modules </Text>
        <Text dimColor>(FlowMaker, DataBridge, DataCatalog, Grafana, Workers)</Text>
      </Text>
      <Text>
        <Text color={isLicensed ? "green" : "yellow"} bold>{"  "}{isLicensed ? "✓" : "🔒"}{" "}</Text>
        <Text>{premiumCount} Premium modules </Text>
        <Text dimColor>
          {isLicensed ? "(licensed)" : "(OPC-UA, S7, AI Studio, Backup... → industream license --set)"}
        </Text>
      </Text>
    </Box>
  );
}
