import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";

// Final state of the network nodes logo
const NETWORK_LINES = [
  "○     ○     ○     ●",
  "                  │",
  "○     ●     ○     ●",
  "   ╱     ╲     ╱   ",
  "●     ○     ●     ○",
  "│                  ",
  "●     ○     ○     ○",
];

// Final ASCII logo lines
const LOGO_LINES = [
  "██╗███╗   ██╗██████╗ ██╗   ██╗███████╗████████╗██████╗ ███████╗ █████╗ ███╗   ███╗",
  "██║████╗  ██║██╔══██╗██║   ██║██╔════╝╚══██╔══╝██╔══██╗██╔════╝██╔══██╗████╗ ████║",
  "██║██╔██╗ ██║██║  ██║██║   ██║███████╗   ██║   ██████╔╝█████╗  ███████║██╔████╔██║",
  "██║██║╚██╗██║██║  ██║██║   ██║╚════██║   ██║   ██╔══██╗██╔══╝  ██╔══██║██║╚██╔╝██║",
  "██║██║ ╚████║██████╔╝╚██████╔╝███████║   ██║   ██║  ██║███████╗██║  ██║██║ ╚═╝ ██║",
  "╚═╝╚═╝  ╚═══╝╚═════╝  ╚═════╝ ╚══════╝   ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝╚═╝     ╚═╝",
];

interface BoltBuilderProps {
  /** Called once the build animation completes */
  onComplete?: () => void;
  /** Total animation duration in ms (default 4000ms) */
  duration?: number;
}

export function BoltBuilder({
  onComplete,
  duration = 4000,
}: BoltBuilderProps): React.ReactElement {
  const [progress, setProgress] = useState(0); // 0..1
  const totalSteps = 30;

  useEffect(() => {
    const stepDelay = duration / totalSteps;
    let currentStep = 0;
    const timer = setInterval(() => {
      currentStep++;
      setProgress(currentStep / totalSteps);
      if (currentStep >= totalSteps) {
        clearInterval(timer);
        onComplete?.();
      }
    }, stepDelay);
    return () => clearInterval(timer);
  }, [duration, onComplete]);

  // Reveal logic: split between network (first half) and ASCII (second half)
  const networkProgress = Math.min(progress * 2, 1);
  const logoProgress = Math.max(progress * 2 - 1, 0);

  // Reveal network character by character (left to right, top to bottom)
  const totalNetworkChars = NETWORK_LINES.reduce((sum, line) => sum + line.length, 0);
  const charsToRevealNetwork = Math.floor(networkProgress * totalNetworkChars);

  // Reveal ASCII column by column
  const totalLogoCols = LOGO_LINES[0].length;
  const colsToRevealLogo = Math.floor(logoProgress * totalLogoCols);

  let charsCount = 0;
  const revealedNetwork = NETWORK_LINES.map((line) => {
    const result = Array.from(line).map((char) => {
      const reveal = charsCount < charsToRevealNetwork;
      charsCount++;
      return reveal ? char : " ";
    });
    return result.join("");
  });

  const revealedLogo = LOGO_LINES.map((line) =>
    line.slice(0, colsToRevealLogo).padEnd(line.length, " "),
  );

  return (
    <Box flexDirection="column" alignItems="center">
      {/* Network being built */}
      <Box flexDirection="column">
        {revealedNetwork.map((line, idx) => (
          <Text key={idx} color="blue">
            {line}
          </Text>
        ))}
      </Box>
      {/* ASCII logo being built */}
      <Box flexDirection="column" marginTop={1}>
        {revealedLogo.map((line, idx) => (
          <Text key={idx}>
            <Text bold>{line.slice(0, 30)}</Text>
            <Text color="blue">{line.slice(30)}</Text>
          </Text>
        ))}
      </Box>
    </Box>
  );
}
