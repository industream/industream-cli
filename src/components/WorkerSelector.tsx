// src/components/WorkerSelector.tsx
// Interactive multi-select for the flow-box worker fleet. Lets the operator pick
// which workers to deploy (CE: community workers; premium shown locked unless
// licensed). The selected serviceNames feed deploy.sh's --workers allowlist.
import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import type { Module, Plan } from "../lib/modules.js";

// Industream brand blue (NOT cyan) — Ink renders hex via truecolor.
const BRAND_BLUE = "#052FAD";

interface WorkerSelectorProps {
  workers: Module[]; // modules with category === "Workers"
  plan: Plan;
  onComplete: (selectedServiceNames: string[]) => void;
}

export function WorkerSelector({
  workers,
  plan,
  onComplete,
}: WorkerSelectorProps): React.ReactElement {
  const isLicensed = plan !== "community";

  // A worker is togglable when it is ready AND either community (bsl/apache) or a
  // proprietary one the current license entitles. Locked ones are shown but inert.
  const isUnlocked = (module: Module): boolean =>
    module.status === "ready" &&
    (module.license === "bsl" ||
      module.license === "apache" ||
      (module.license === "proprietary" && isLicensed));

  const items = workers.filter((module) => Boolean(module.serviceName));
  const unlockedServices = items
    .filter(isUnlocked)
    .map((module) => module.serviceName as string);

  // Default selection = every unlocked worker (so the default deploy is unchanged).
  const [selected, setSelected] = useState<Set<string>>(() => new Set(unlockedServices));
  const [cursor, setCursor] = useState<number>(0);

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((index) => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((index) => Math.min(items.length - 1, index + 1));
      return;
    }
    if (input === " ") {
      const module = items[cursor];
      if (!module?.serviceName || !isUnlocked(module)) return;
      const service = module.serviceName;
      setSelected((previous) => {
        const next = new Set(previous);
        if (next.has(service)) next.delete(service);
        else next.add(service);
        return next;
      });
      return;
    }
    if (input === "a") {
      setSelected((previous) =>
        previous.size === unlockedServices.length ? new Set() : new Set(unlockedServices),
      );
      return;
    }
    if (key.return) {
      onComplete(Array.from(selected));
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Select workers to deploy</Text>
      <Box marginTop={1}>
        <Text dimColor>Space toggle · &apos;a&apos; all/none · Enter confirm · default = all included</Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {items.map((module, index) => {
          const service = module.serviceName as string;
          const unlocked = isUnlocked(module);
          const checked = selected.has(service);
          const atCursor = index === cursor;
          const box = !unlocked ? "🔒" : checked ? "[x]" : "[ ]";
          return (
            <Text key={module.id} color={atCursor ? BRAND_BLUE : undefined} dimColor={!unlocked}>
              {atCursor ? "❯ " : "  "}
              {box} {module.name}
              {module.license === "proprietary" ? <Text dimColor> (premium)</Text> : ""}
              {module.status !== "ready" ? <Text dimColor> — {module.status}</Text> : ""}
            </Text>
          );
        })}
      </Box>
      <Box marginTop={1}>
        <Text color={BRAND_BLUE}>{selected.size}</Text>
        <Text dimColor> / {unlockedServices.length} workers selected</Text>
      </Box>
    </Box>
  );
}
