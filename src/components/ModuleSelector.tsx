// src/components/ModuleSelector.tsx
import React from "react";
import { Text, Box } from "ink";
import type { Module } from "../lib/modules.js";
import type { Plan } from "../lib/modules.js";
import { isModuleLicensed, loadModuleRegistry } from "../lib/modules.js";

interface ModuleSelectorProps {
  modules: Module[];
  plan: Plan;
  licensedModuleIds?: string[];
}

interface CategoryGroup {
  category: string;
  modules: Module[];
  isFullyLicensed: boolean;
}

const MODULES_PER_ROW = 3;
const MODULE_COLUMN_WIDTH = 22;

function groupModulesByCategory(
  modules: Module[],
  plan: Plan,
  licensedModuleIds?: string[],
): CategoryGroup[] {
  const categoryMap = new Map<string, Module[]>();

  for (const module of modules) {
    const existing = categoryMap.get(module.category) ?? [];
    existing.push(module);
    categoryMap.set(module.category, existing);
  }

  const registry = loadModuleRegistry();

  return Array.from(categoryMap.entries()).map(([category, categoryModules]) => {
    const isFullyLicensed = categoryModules.every((module) =>
      isModuleLicensed(registry, module.id, plan, licensedModuleIds),
    );

    return { category, modules: categoryModules, isFullyLicensed };
  });
}

function chunkArray<T>(array: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < array.length; index += size) {
    chunks.push(array.slice(index, index + size));
  }
  return chunks;
}

function CategoryHeader({
  group,
}: {
  group: CategoryGroup;
}): React.ReactElement {
  if (group.isFullyLicensed) {
    return (
      <Text>
        <Text color="green" bold>{"  \u2713 "}</Text>
        <Text bold>{group.category}</Text>
        <Text dimColor>{" (included)"}</Text>
      </Text>
    );
  }

  return (
    <Text>
      <Text color="yellow" bold>{"  \uD83D\uDD12 "}</Text>
      <Text bold>{group.category}</Text>
      <Text dimColor>{" (license required)"}</Text>
    </Text>
  );
}

function ModuleRow({
  modules,
  plan,
  licensedModuleIds,
}: {
  modules: Module[];
  plan: Plan;
  licensedModuleIds?: string[];
}): React.ReactElement {
  const registry = loadModuleRegistry();

  return (
    <Box>
      <Text>{"    "}</Text>
      {modules.map((module, index) => {
        const isLicensed = isModuleLicensed(
          registry,
          module.id,
          plan,
          licensedModuleIds,
        );
        const icon = isLicensed ? "\u25CF" : "\u25CB";
        const iconColor = isLicensed ? "green" : "gray";

        return (
          <Box key={module.id} width={MODULE_COLUMN_WIDTH}>
            <Text>
              <Text color={iconColor}>{icon}</Text>
              <Text dimColor={!isLicensed}>{` ${module.name}`}</Text>
              {index < modules.length - 1 ? <Text>{"  "}</Text> : null}
            </Text>
          </Box>
        );
      })}
    </Box>
  );
}

function CategorySection({
  group,
  plan,
  licensedModuleIds,
}: {
  group: CategoryGroup;
  plan: Plan;
  licensedModuleIds?: string[];
}): React.ReactElement {
  const rows = chunkArray(group.modules, MODULES_PER_ROW);

  return (
    <Box flexDirection="column" marginBottom={1}>
      <CategoryHeader group={group} />
      {rows.map((rowModules, index) => (
        <ModuleRow
          key={index}
          modules={rowModules}
          plan={plan}
          licensedModuleIds={licensedModuleIds}
        />
      ))}
    </Box>
  );
}

export function ModuleSelector({
  modules,
  plan,
  licensedModuleIds,
}: ModuleSelectorProps): React.ReactElement {
  const groups = groupModulesByCategory(modules, plan, licensedModuleIds);

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="blue"
      paddingX={1}
      paddingY={1}
    >
      <Text bold color="blue">
        {" Platform Modules"}
      </Text>
      <Text>{""}</Text>
      {groups.map((group) => (
        <CategorySection
          key={group.category}
          group={group}
          plan={plan}
          licensedModuleIds={licensedModuleIds}
        />
      ))}
    </Box>
  );
}
