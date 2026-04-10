import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";

const LOGO_PARTS = [
  "○──●──○",
  "│  │  │",
  "●──○──●",
];

interface BoltBuilderProps {
  onComplete?: () => void;
  duration?: number;
}

export function BoltBuilder({
  onComplete,
  duration = 3000,
}: BoltBuilderProps): React.ReactElement {
  const [progress, setProgress] = useState(0);
  const totalSteps = 20;

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

  const textToReveal = "INDUSTREAM PLATFORM";
  const charsToShow = Math.floor(progress * textToReveal.length);
  const revealed = textToReveal.slice(0, charsToShow);
  const hidden = textToReveal.slice(charsToShow).replace(/./g, " ");

  const logoProgress = Math.min(progress * 3, 1);
  const logoLines = LOGO_PARTS.map((line) => {
    const chars = Math.floor(logoProgress * line.length);
    return line.slice(0, chars).padEnd(line.length);
  });

  return (
    <Box flexDirection="column" alignItems="center">
      <Box flexDirection="column" marginBottom={1}>
        {logoLines.map((line, idx) => (
          <Text key={idx} color="blue">
            {"  "}{line}
          </Text>
        ))}
      </Box>
      <Text bold>
        {"  "}{revealed}
        <Text dimColor>{hidden}</Text>
      </Text>
      <Text dimColor>{"  Industrial Data Platform"}</Text>
    </Box>
  );
}
