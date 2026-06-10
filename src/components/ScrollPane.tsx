// src/components/ScrollPane.tsx
// A bordered pane that renders a list of lines with a vertical scrollbar gutter
// (█ thumb / ░ track). By default it auto-tails (newest at the bottom). When
// `interactive` is set it captures the keyboard: ↑/↓ scroll a line, PgUp/PgDn a
// page, g/G jump to top/bottom — so the operator can read what scrolled past.
// Scrolling up freezes the view (offset from the bottom); G (or reaching the
// bottom) resumes auto-tail.
import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

// Industream brand blue (NOT cyan) — Ink renders hex via truecolor.
const BRAND_BLUE = "#052FAD";

interface ScrollPaneProps {
  title: string;
  lines: string[];
  height: number; // visible content rows
  width: string;
  color?: string;
  interactive?: boolean;
}

export function ScrollPane({
  title,
  lines,
  height,
  width,
  color = BRAND_BLUE,
  interactive = false,
}: ScrollPaneProps): React.ReactElement {
  // offset = lines scrolled UP from the bottom. 0 = tail (auto-follow newest).
  const [offset, setOffset] = useState(0);

  const total = lines.length;
  // One row is spent on the "▲/▼ more" status line when scrolling is possible.
  const overflow = total > height;
  const bodyRows = overflow ? height - 1 : height;
  const maxOffset = Math.max(0, total - bodyRows);
  const off = Math.min(offset, maxOffset); // clamp (list may have shrunk)

  useInput(
    (input, key) => {
      if (key.upArrow) setOffset((o) => Math.min(maxOffset, o + 1));
      else if (key.downArrow) setOffset((o) => Math.max(0, o - 1));
      else if (key.pageUp) setOffset((o) => Math.min(maxOffset, o + bodyRows));
      else if (key.pageDown) setOffset((o) => Math.max(0, o - bodyRows));
      else if (input === "g") setOffset(maxOffset); // top
      else if (input === "G") setOffset(0); // bottom (resume tail)
    },
    { isActive: interactive },
  );

  const end = total - off; // exclusive
  const start = Math.max(0, end - bodyRows);
  const visible = lines.slice(start, end);
  const above = start;
  const below = total - end;

  // Thumb spans the visible fraction, positioned by `start`.
  const thumbSize = overflow ? Math.max(1, Math.round((bodyRows * bodyRows) / total)) : 0;
  const thumbTop = overflow ? Math.min(bodyRows - thumbSize, Math.round((start / total) * bodyRows)) : 0;
  const gutterChar = (row: number): string => {
    if (!overflow) return " ";
    return row >= thumbTop && row < thumbTop + thumbSize ? "█" : "░";
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
        {interactive && overflow ? <Text dimColor>  ↑/↓ PgUp/PgDn · G=bottom</Text> : ""}
      </Text>
      {overflow ? (
        <Box justifyContent="space-between">
          <Text dimColor>
            {above > 0 ? `▲ ${above} above` : "▼ live"}
            {below > 0 ? `   ▼ ${below} below` : ""}
          </Text>
          <Text color={color}>{off > 0 ? "░" : "█"}</Text>
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
