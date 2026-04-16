// src/commands/config.tsx
import React, { useState, useEffect } from "react";
import { render, Text, Box, useInput, useApp } from "ink";
import { Banner } from "../components/Banner.js";
import { loadConfig } from "../lib/config.js";
import {
  loadEnvFile,
  updateEnvValue,
  isPlatformInstalled,
  resolvePlatformDir,
} from "../lib/swarm-repo.js";

type Phase = "list" | "edit" | "saving" | "saved";

interface EnvVar {
  key: string;
  originalValue: string;
  currentValue: string;
}

const SECRET_PATTERN = /PASSWORD|SECRET|TOKEN|KEY|PRIVATE|CREDENTIAL/i;
const VIEWPORT_SIZE = 15;

function isSecretKey(key: string): boolean {
  return SECRET_PATTERN.test(key);
}

function mask(value: string): string {
  if (value.length === 0) return "";
  return "•".repeat(Math.min(value.length, 12));
}

function ConfigEditor(): React.ReactElement {
  const { exit } = useApp();
  const [phase, setPhase] = useState<Phase>("list");
  const [vars, setVars] = useState<EnvVar[]>([]);
  const [selected, setSelected] = useState(0);
  const [offset, setOffset] = useState(0);
  const [buffer, setBuffer] = useState("");
  const [showSecrets, setShowSecrets] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [platformPath, setPlatformPath] = useState<string>("");

  useEffect(() => {
    async function load() {
      try {
        const config = await loadConfig();
        if (!(await isPlatformInstalled(config.platformDir))) {
          setError("Platform not installed. Run: industream install");
          setLoading(false);
          return;
        }
        setPlatformPath(resolvePlatformDir(config.platformDir));
        const env = await loadEnvFile(config.platformDir);
        const entries: EnvVar[] = Object.entries(env).map(([key, value]) => ({
          key,
          originalValue: value,
          currentValue: value,
        }));
        setVars(entries);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  useInput(async (input, key) => {
    if (loading || error) {
      if (input === "q") exit();
      return;
    }

    if (phase === "list") {
      if (input === "q") {
        const dirty = vars.some((v) => v.currentValue !== v.originalValue);
        if (dirty) {
          setMessage("Unsaved changes. Press 's' to save or 'Q' to discard.");
          return;
        }
        exit();
        return;
      }
      if (input === "Q") {
        exit();
        return;
      }
      if (input === "r") {
        setShowSecrets((prev) => !prev);
        return;
      }
      if (input === "s") {
        const dirty = vars.filter((v) => v.currentValue !== v.originalValue);
        if (dirty.length === 0) {
          setMessage("No changes to save.");
          return;
        }
        setPhase("saving");
        try {
          const config = await loadConfig();
          for (const v of dirty) {
            await updateEnvValue(config.platformDir, v.key, v.currentValue);
          }
          setVars((prev) =>
            prev.map((v) => ({ ...v, originalValue: v.currentValue })),
          );
          setMessage(
            `Saved ${dirty.length} change${dirty.length > 1 ? "s" : ""}. Run 'industream deploy' to apply.`,
          );
          setPhase("saved");
          setTimeout(() => setPhase("list"), 100);
        } catch (err) {
          setError(err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (key.upArrow) {
        setSelected((prev) => {
          const next = Math.max(0, prev - 1);
          if (next < offset) setOffset(next);
          return next;
        });
        return;
      }
      if (key.downArrow) {
        setSelected((prev) => {
          const next = Math.min(vars.length - 1, prev + 1);
          if (next >= offset + VIEWPORT_SIZE) setOffset(next - VIEWPORT_SIZE + 1);
          return next;
        });
        return;
      }
      if (key.return) {
        const current = vars[selected];
        if (!current) return;
        setBuffer(current.currentValue);
        setMessage(null);
        setPhase("edit");
      }
      return;
    }

    if (phase === "edit") {
      if (key.escape) {
        setPhase("list");
        return;
      }
      if (key.return) {
        setVars((prev) =>
          prev.map((v, i) => (i === selected ? { ...v, currentValue: buffer } : v)),
        );
        setPhase("list");
        return;
      }
      if (key.backspace || key.delete) {
        setBuffer((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setBuffer((value) => value + input);
      }
    }
  });

  if (loading) {
    return <Text color="blue">Loading .env from platform repo...</Text>;
  }

  if (error) {
    return (
      <Box flexDirection="column">
        <Text color="red">{error}</Text>
        <Text dimColor>Press q to quit</Text>
      </Box>
    );
  }

  const dirtyCount = vars.filter((v) => v.currentValue !== v.originalValue).length;
  const visible = vars.slice(offset, offset + VIEWPORT_SIZE);
  const maxKeyLength = Math.max(...vars.map((v) => v.key.length), 20);

  if (phase === "edit") {
    const current = vars[selected];
    return (
      <Box flexDirection="column">
        <Banner />
        <Box marginLeft={2} marginY={1}>
          <Text bold>Edit {current.key}</Text>
        </Box>
        <Box marginLeft={2}>
          <Text color="blue">? </Text>
          <Text bold>Value: </Text>
          <Text>
            {isSecretKey(current.key) && !showSecrets ? mask(buffer) : buffer}
            <Text color="gray">█</Text>
          </Text>
        </Box>
        <Box marginLeft={2} marginTop={1}>
          <Text dimColor>Enter to confirm, Esc to cancel, Backspace to delete</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Banner />
      <Box marginLeft={2} marginBottom={1}>
        <Text dimColor>File: {platformPath}/.env</Text>
      </Box>
      <Box marginLeft={2} flexDirection="column">
        {visible.map((v, i) => {
          const index = offset + i;
          const isSelected = index === selected;
          const isDirty = v.currentValue !== v.originalValue;
          const displayValue =
            isSecretKey(v.key) && !showSecrets ? mask(v.currentValue) : v.currentValue;
          return (
            <Box key={v.key}>
              <Text color={isSelected ? "blue" : undefined} bold={isSelected}>
                {isSelected ? "▸ " : "  "}
                {v.key.padEnd(maxKeyLength)}
              </Text>
              <Text>{"  "}</Text>
              <Text color={isDirty ? "yellow" : undefined}>
                {isDirty ? "* " : "  "}
                {displayValue}
              </Text>
            </Box>
          );
        })}
      </Box>
      <Box marginLeft={2} marginTop={1} flexDirection="column">
        <Text dimColor>
          {selected + 1}/{vars.length}
          {dirtyCount > 0 ? ` — ${dirtyCount} unsaved` : ""}
          {showSecrets ? " — secrets visible" : ""}
        </Text>
        {message && (
          <Text color={message.startsWith("Saved") ? "green" : "yellow"}>{message}</Text>
        )}
        <Text dimColor>
          ↑/↓ navigate · Enter edit · s save · r reveal secrets · q quit · Q force quit
        </Text>
      </Box>
    </Box>
  );
}

export function runConfig(): void {
  render(<ConfigEditor />);
}
