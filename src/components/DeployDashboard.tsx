// src/components/DeployDashboard.tsx
// Structured 4-pane deploy view (Ink). Subscribes to a DeployReporter and
// renders: Steps · Service health · Log · Result. Orchestrator-agnostic.
// Log + Result use ScrollPane (scrollbar gutter + "▲ N more"), and the noisy
// swarm "verify: Waiting…" lines are collapsed via collapseLog.

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import { ScrollPane, collapseLog } from "./ScrollPane.js";
import type {
  DeployReporter,
  DeploySnapshot,
  DeployResultInfo,
  StepStatus,
} from "../lib/deploy-reporter.js";

// Industream brand blue (NOT cyan) — Ink renders hex via truecolor.
const BRAND_BLUE = "#052FAD";

const STEP_ICON: Record<StepStatus, { icon: string; color: string }> = {
  pending: { icon: "○", color: "gray" },
  running: { icon: "⚙", color: BRAND_BLUE },
  done: { icon: "✓", color: "green" },
  failed: { icon: "✗", color: "red" },
  skipped: { icon: "–", color: "gray" },
};

// The Log/Result panes are the tall ones (streaming output); the top row
// (Steps + Service health) is kept compact so it doesn't dwarf them.
const LOG_LINES = 16;
const HEALTH_LINES = 9; // max non-converged services listed before "…+N more"

// Flatten the structured result into plain lines for the scrollable Result pane.
function resultLines(result: DeployResultInfo): string[] {
  const lines: string[] = [
    result.ok ? "✓ Deployment complete" : "✗ Deployment failed",
    result.summary,
  ];
  if (result.urls.length > 0) {
    const w = Math.max(...result.urls.map((u) => u.label.length));
    lines.push("", "🔗 Access");
    for (const url of result.urls) lines.push(`  ${url.label.padEnd(w)}  ${url.url}`);
  }
  if (result.credentials && result.credentials.length > 0) {
    const w = Math.max(...result.credentials.map((c) => c.label.length));
    lines.push("", "🔑 Admin credentials (save now)");
    for (const c of result.credentials) lines.push(`  ${c.label.padEnd(w)}  ${c.user} / ${c.pass}`);
    if (result.secretsDir) lines.push(`  ↳ all secrets: ${result.secretsDir}`);
  }
  if (result.tls?.selfSigned) {
    lines.push("", "🔒 Self-signed TLS — trust the CA (stops browser warnings):");
    lines.push("  industream trust-ca");
    if (result.tls.caPath) lines.push(`  CA file: ${result.tls.caPath}`);
  }
  if (result.hostsBlock) {
    lines.push("", "📝 Add to /etc/hosts on your workstation:");
    for (const l of result.hostsBlock.split("\n")) lines.push(`  ${l}`);
  }
  return lines;
}

interface DeployDashboardProps {
  reporter: DeployReporter;
  title: string;
}

export function DeployDashboard({ reporter, title }: DeployDashboardProps): React.ReactElement {
  const [snap, setSnap] = useState<DeploySnapshot>(() => reporter.get());

  useEffect(() => {
    const onUpdate = () => setSnap(reporter.get());
    reporter.on("update", onUpdate);
    return () => {
      reporter.off("update", onUpdate);
    };
  }, [reporter]);

  const converged = snap.services.filter((s) => s.converged).length;
  const resultColor = snap.result ? (snap.result.ok ? "green" : "red") : "gray";

  return (
    <Box flexDirection="column" width="100%">
      <Text bold>{title}</Text>

      {/* Top row: Steps + Service health. alignItems flex-start so the short
          Steps pane is NOT stretched to the height of Service health. */}
      <Box alignItems="flex-start">
        <Pane title="Steps" color={BRAND_BLUE} width="55%">
          {snap.steps.length === 0 ? (
            <Text color="gray">(starting…)</Text>
          ) : (
            snap.steps.map((s) => (
              <Text key={s.id} color={STEP_ICON[s.status].color}>
                {STEP_ICON[s.status].icon} {s.label}
                {s.detail ? <Text color="gray"> — {s.detail}</Text> : ""}
              </Text>
            ))
          )}
        </Pane>
        <Pane
          title={`Service health${snap.services.length ? `  (${converged}/${snap.services.length})` : ""}`}
          color={BRAND_BLUE}
          width="45%"
        >
          {snap.services.length === 0 ? (
            <Text color="gray">(waiting for services…)</Text>
          ) : (() => {
            // Keep the pane compact: list only services still converging (the
            // actionable ones), capped, so 40+ green services don't balloon the
            // row and dwarf the Log pane.
            const pending = snap.services.filter((s) => !s.converged);
            if (pending.length === 0) {
              return <Text color="green">✓ all {snap.services.length} services converged</Text>;
            }
            const shown = pending.slice(0, HEALTH_LINES);
            return (
              <>
                {shown.map((s) => (
                  <Text key={s.name} color="yellow">
                    … {s.name} {s.ready}/{s.total}
                  </Text>
                ))}
                {pending.length > shown.length ? (
                  <Text dimColor>…+{pending.length - shown.length} more converging</Text>
                ) : null}
              </>
            );
          })()}
        </Pane>
      </Box>

      {/* Bottom row: Log + Result — both scrollable */}
      <Box>
        <ScrollPane title="Log" color={BRAND_BLUE} width="55%" height={LOG_LINES} lines={collapseLog(snap.logs)} interactive />
        <ScrollPane
          title="Result"
          color={resultColor}
          width="45%"
          height={LOG_LINES}
          lines={snap.result ? resultLines(snap.result) : ["(deployment in progress)"]}
        />
      </Box>
    </Box>
  );
}

function Pane({
  title,
  color,
  width,
  height,
  children,
}: {
  title: string;
  color: string;
  width: string;
  height?: number;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={color}
      width={width}
      height={height}
      paddingX={1}
    >
      <Text bold>{title}</Text>
      {children}
    </Box>
  );
}
