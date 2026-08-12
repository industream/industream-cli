// src/components/BundleSelector.tsx
// Single-select for the release bundle when the unified tree carries more than
// one. deploy.sh refuses to guess in that case ("multiple bundles in releases/ —
// pass --bundle"); this is the interactive way out, so the operator never has to
// read that error and hunt for a flag `industream install` did not expose.
import React, { useState } from "react";
import { Text, Box, useInput } from "ink";
import type { BundleInfo } from "../lib/bundles.js";

// Industream brand blue (NOT cyan) — Ink renders hex via truecolor.
const BRAND_BLUE = "#052FAD";

interface BundleSelectorProps {
  bundles: BundleInfo[];
  onComplete: (version: string) => void;
}

export function BundleSelector({ bundles, onComplete }: BundleSelectorProps): React.ReactElement {
  const [cursor, setCursor] = useState<number>(0);

  useInput((_input, key) => {
    if (key.upArrow) {
      setCursor((index) => Math.max(0, index - 1));
      return;
    }
    if (key.downArrow) {
      setCursor((index) => Math.min(bundles.length - 1, index + 1));
      return;
    }
    if (key.return) {
      const chosen = bundles[cursor];
      if (chosen) onComplete(chosen.version);
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Select the release bundle to deploy</Text>
      <Box marginTop={1}>
        <Text dimColor>
          Several bundles live in releases/ — the deploy needs exactly one. ↑/↓ · Enter confirm
        </Text>
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {bundles.map((bundle, index) => {
          const atCursor = index === cursor;
          return (
            <Text key={bundle.dirName} color={atCursor ? BRAND_BLUE : undefined}>
              {atCursor ? "❯ " : "  "}
              {bundle.version}
              {bundle.source === "forge" ? <Text dimColor> (from Forge)</Text> : ""}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}
