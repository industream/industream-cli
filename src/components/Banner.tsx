import React from "react";
import { Text, Box } from "ink";

const NETWORK_LINES: { text: string; highlights: number[] }[] = [
  { text: "○     ○     ○     ●", highlights: [18] },
  { text: "                  │", highlights: [18] },
  { text: "○     ●     ○     ●", highlights: [6, 18] },
  { text: "   ╱     ╲     ╱   ", highlights: [3, 9, 15] },
  { text: "●     ○     ●     ○", highlights: [0, 12] },
  { text: "│                  ", highlights: [0] },
  { text: "●     ○     ○     ○", highlights: [0] },
];

const LOGO_LINES = [
  "██╗███╗   ██╗██████╗ ██╗   ██╗███████╗████████╗██████╗ ███████╗ █████╗ ███╗   ███╗",
  "██║████╗  ██║██╔══██╗██║   ██║██╔════╝╚══██╔══╝██╔══██╗██╔════╝██╔══██╗████╗ ████║",
  "██║██╔██╗ ██║██║  ██║██║   ██║███████╗   ██║   ██████╔╝█████╗  ███████║██╔████╔██║",
  "██║██║╚██╗██║██║  ██║██║   ██║╚════██║   ██║   ██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║",
  "██║██║ ╚████║██████╔╝╚██████╔╝███████║   ██║   ██║  ██║███████╗██║  ██║██║ ╚═╝ ██║",
  "╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝",
];

function NetworkLine({
  line,
}: {
  line: { text: string; highlights: number[] };
}): React.ReactElement {
  const chars = Array.from(line.text);
  return (
    <Text>
      {chars.map((char, idx) => {
        const isHighlight = line.highlights.includes(idx) || /[╱╲│]/.test(char);
        return (
          <Text key={idx} color={isHighlight ? "blue" : undefined} dimColor={!isHighlight}>
            {char}
          </Text>
        );
      })}
    </Text>
  );
}

export function Banner({ compact = false }: { compact?: boolean }): React.ReactElement {
  if (compact) {
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
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Box flexDirection="column" marginLeft={32}>
        {NETWORK_LINES.map((line, index) => (
          <NetworkLine key={index} line={line} />
        ))}
      </Box>
      <Box flexDirection="column" marginTop={1}>
        {LOGO_LINES.map((line, index) => (
          <Text key={index}>
            <Text bold>{line.slice(0, 30)}</Text>
            <Text color="blue">{line.slice(30)}</Text>
          </Text>
        ))}
      </Box>
      <Text dimColor>
        {"          Industrial Data Platform"}
      </Text>
    </Box>
  );
}
