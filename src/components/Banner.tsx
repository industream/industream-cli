import React from "react";
import { Text, Box } from "ink";

export function Banner({ compact = false }: { compact?: boolean }): React.ReactElement {
  if (compact) {
    return (
      <Box marginBottom={1}>
        <Text bold>INDUSTREAM</Text>
        <Text dimColor> — Industrial Data Platform</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box>
        <Text dimColor>{"  ○──●──○  "}</Text>
        <Text bold>INDUSTREAM </Text>
        <Text color="blue" bold>PLATFORM</Text>
      </Box>
      <Box>
        <Text dimColor>{"  │  │  │  "}</Text>
        <Text dimColor>Industrial Data Platform</Text>
      </Box>
      <Box>
        <Text dimColor>{"  ●──○──●  "}</Text>
        <Text dimColor>BSL 1.1 — industream.com</Text>
      </Box>
    </Box>
  );
}
