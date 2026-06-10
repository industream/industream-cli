// src/components/ScrollPane.tsx
// A bordered pane that tail-renders a list of lines with a vertical scrollbar
// gutter (█ thumb / ░ track) on the right edge and a "▲ N more above" indicator
// when the content overflows. Auto-tails (thumb pinned to the bottom) — there is
// no interactive scrolling; the goal is to SEE that content is scrolling past and
// how much is hidden, during a streaming deploy.
import React from "react";
import { Box, Text } from "ink";

// Industream brand blue (NOT cyan) — Ink renders hex via truecolor.
const BRAND_BLUE = "#052FAD";

interface ScrollPaneProps {
  title: string;
  lines: string[];
  height: number; // visible content rows
  width: string;
  color?: string;
}

export function ScrollPane({
  title,
  lines,
  height,
  width,
  color = BRAND_BLUE,
}: ScrollPaneProps): React.ReactElement {
  const total = lines.length;
  const overflow = total > height;
  // Reserve the top row for the "▲ N more" indicator when content overflows.
  const bodyRows = overflow ? height - 1 : height;
  const visible = lines.slice(-bodyRows);
  const hidden = total - visible.length;

  // Thumb height ∝ visible/total, pinned to the bottom (auto-tail).
  const thumb = overflow ? Math.max(1, Math.round((bodyRows * bodyRows) / total)) : 0;
  const gutterChar = (rowFromTop: number): string => {
    if (!overflow) return " ";
    return rowFromTop >= bodyRows - thumb ? "█" : "░";
  };

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      width={width}
      height={height + 2}
      paddingX={1}
    >
      <Text bold>
        {title}
        {total > 0 ? <Text dimColor> ({total})</Text> : ""}
      </Text>
      {overflow ? (
        <Box justifyContent="space-between">
          <Text dimColor>▲ {hidden} more above</Text>
          <Text color={color}>░</Text>
        </Box>
      ) : null}
      {visible.map((line, index) => (
        <Box key={index} justifyContent="space-between">
          <Text color="gray" wrap="truncate-end">
            {line.length > 0 ? line : " "}
          </Text>
          <Text color={color}>{gutterChar(index)}</Text>
        </Box>
      ))}
    </Box>
  );
}

// Collapse consecutive duplicate log lines (and the noisy swarm
// "verify: Waiting N seconds to verify that tasks are stable…" spam) into a
// single line with an "(×N)" multiplier, so the log stays readable.
export function collapseLog(lines: string[]): string[] {
  const normalize = (line: string): string =>
    line.replace(
      /^verify: Waiting \d+ seconds? to verify that tasks are stable.*$/i,
      "verify: waiting for tasks to stabilize…",
    );
  const runs: { text: string; count: number }[] = [];
  for (const raw of lines) {
    const text = normalize(raw);
    const last = runs[runs.length - 1];
    if (last && last.text === text) last.count += 1;
    else runs.push({ text, count: 1 });
  }
  return runs.map((run) => (run.count > 1 ? `${run.text} (×${run.count})` : run.text));
}
