// src/components/DeployDashboard.tsx
// Structured 4-pane deploy view (Ink). Subscribes to a DeployReporter and
// renders: Steps · Service health · Log · Result. Orchestrator-agnostic.

import React, { useEffect, useState } from "react";
import { Box, Text } from "ink";
import type {
  DeployReporter,
  DeploySnapshot,
  StepStatus,
} from "../lib/deploy-reporter.js";

const STEP_ICON: Record<StepStatus, { icon: string; color: string }> = {
  pending: { icon: "○", color: "gray" },
  running: { icon: "⚙", color: "blueBright" },
  done: { icon: "✓", color: "green" },
  failed: { icon: "✗", color: "red" },
  skipped: { icon: "–", color: "gray" },
};

const LOG_LINES = 12;

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

      {/* Top row: Steps + Service health */}
      <Box>
        <Pane title="Steps" color="cyan" width="55%">
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
          color="cyan"
          width="45%"
        >
          {snap.services.length === 0 ? (
            <Text color="gray">(waiting for services…)</Text>
          ) : (
            snap.services.map((s) => (
              <Text key={s.name} color={s.converged ? "green" : "yellow"}>
                {s.converged ? "✓" : "…"} {s.name} {s.ready}/{s.total}
              </Text>
            ))
          )}
        </Pane>
      </Box>

      {/* Bottom row: Log + Result */}
      <Box>
        <Pane title="Log" color="blue" width="55%" height={LOG_LINES + 2}>
          {snap.logs.slice(-LOG_LINES).map((line, i) => (
            <Text key={i} color="gray" wrap="truncate-end">
              {line}
            </Text>
          ))}
        </Pane>
        <Pane title="Result" color={resultColor} width="45%" height={LOG_LINES + 2}>
          {!snap.result ? (
            <Text color="gray">(deployment in progress)</Text>
          ) : (
            <>
              <Text color={snap.result.ok ? "green" : "red"} bold>
                {snap.result.ok ? "✓ Deployment complete" : "✗ Deployment failed"}
              </Text>
              <Text color="gray">{snap.result.summary}</Text>
              <Box marginTop={1} flexDirection="column">
                {snap.result.urls.map((u) => (
                  <Box key={u.label} flexDirection="column">
                    <Text color="cyan">{u.label}</Text>
                    <Text wrap="truncate-end">{u.url}</Text>
                  </Box>
                ))}
              </Box>
            </>
          )}
        </Pane>
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
