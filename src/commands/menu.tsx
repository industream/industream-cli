import React, { useState } from "react";
import { render, Text, Box, useInput, useApp } from "ink";
import { Banner } from "../components/Banner.js";
import { execa } from "execa";

interface MenuItem {
  key: string;
  label: string;
  description: string;
  command: string[];
}

const MENU_ITEMS: MenuItem[] = [
  { key: "1", label: "Install", description: "Set up the platform", command: ["install"] },
  { key: "2", label: "Status", description: "View platform health", command: ["status"] },
  { key: "3", label: "Deploy", description: "Deploy an environment", command: ["deploy"] },
  { key: "4", label: "Stop", description: "Stop an environment", command: ["stop"] },
  { key: "5", label: "Logs", description: "View service logs", command: ["logs"] },
  { key: "6", label: "Secrets", description: "Manage secrets", command: ["secrets"] },
];

function MainMenu(): React.ReactElement {
  const { exit } = useApp();
  const [selected, setSelected] = useState(0);
  const [launching, setLaunching] = useState<string | null>(null);

  useInput(async (input, key) => {
    if (input === "q" || input === "0") {
      exit();
      return;
    }

    // Number key shortcut
    const item = MENU_ITEMS.find((m) => m.key === input);
    if (item) {
      setLaunching(item.label);
      exit();
      setTimeout(() => launchCommand(item.command), 100);
      return;
    }

    // Arrow navigation
    if (key.upArrow) {
      setSelected((prev) => (prev > 0 ? prev - 1 : MENU_ITEMS.length - 1));
    } else if (key.downArrow) {
      setSelected((prev) => (prev < MENU_ITEMS.length - 1 ? prev + 1 : 0));
    } else if (key.return) {
      const selectedItem = MENU_ITEMS[selected];
      setLaunching(selectedItem.label);
      exit();
      setTimeout(() => launchCommand(selectedItem.command), 100);
    }
  });

  if (launching) {
    return (
      <Box>
        <Text color="blue">Launching {launching}...</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Banner />
      <Box flexDirection="column" marginLeft={2}>
        {MENU_ITEMS.map((item, index) => {
          const isSelected = index === selected;
          return (
            <Box key={item.key}>
              <Text color={isSelected ? "blue" : undefined} bold={isSelected}>
                {isSelected ? "▸ " : "  "}
                {item.key}) {item.label}
              </Text>
              <Text dimColor>{"  " + item.description}</Text>
            </Box>
          );
        })}
        <Box marginTop={1}>
          <Text dimColor>  0) Exit</Text>
        </Box>
      </Box>
      <Box marginTop={1} marginLeft={2}>
        <Text dimColor>Use arrow keys or number keys to select</Text>
      </Box>
    </Box>
  );
}

function launchCommand(args: string[]): void {
  const scriptPath = process.argv[1];
  execa("node", [scriptPath, ...args], { stdio: "inherit" })
    .then(() => {
      // Re-launch menu after command completes
      runMenu();
    })
    .catch(() => {
      runMenu();
    });
}

export function runMenu(): void {
  render(<MainMenu />);
}
