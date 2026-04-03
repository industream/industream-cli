import React, { useState, useEffect } from "react";
import { Text, Box } from "ink";

const BOLT_FRAMES = [
  // Frame 1: standing
  [
    "    ┌───────┐    ",
    "    │ ◉   ◉ │    ",
    "    │  ───  │    ",
    " ┌──┤       ├──┐ ",
    " │  └───┬───┘  │ ",
    " ◯      │      ◯ ",
    " │   ┌──┴──┐   │ ",
    " └───┤     ├───┘ ",
    "     │     │     ",
    "     ┴─┐ ┌─┴     ",
    "       │ │       ",
    "      ─┘ └─      ",
  ],
  // Frame 2: arms up
  [
    "    ┌───────┐    ",
    "    │ ◉   ◉ │    ",
    "    │  ◡◡◡  │    ",
    " ┌──┤       ├──┐ ",
    " │  └───┬───┘  │ ",
    "\\◯/     │    \\◯/ ",
    " │   ┌──┴──┐   │ ",
    " └───┤     ├───┘ ",
    "     │     │     ",
    "     ┴─┐ ┌─┴     ",
    "       │ │       ",
    "      ─┘ └─      ",
  ],
  // Frame 3: lean right
  [
    "     ┌───────┐   ",
    "     │ ◉   ◉ │   ",
    "     │  ───  │   ",
    "  ┌──┤       ├──┐",
    "  │  └───┬───┘  │",
    "  ◯      │      ◯",
    "  │   ┌──┴──┐   │",
    "  └───┤     ├───┘",
    "      │     │    ",
    "    ┌─┴     ┴─┐  ",
    "    │         │  ",
    "   ─┘         └─ ",
  ],
  // Frame 4: arms up excited
  [
    "    ┌───────┐    ",
    "    │ ★   ★ │    ",
    "    │  ◡◡◡  │    ",
    " ┌──┤       ├──┐ ",
    " │  └───┬───┘  │ ",
    "\\◯/     │    \\◯/ ",
    " │   ┌──┴──┐   │ ",
    " └───┤     ├───┘ ",
    "     │     │     ",
    "     ┴─┐ ┌─┴     ",
    "       │ │       ",
    "      ─┘ └─      ",
  ],
  // Frame 5: lean left
  [
    "   ┌───────┐     ",
    "   │ ◉   ◉ │     ",
    "   │  ───  │     ",
    "┌──┤       ├──┐  ",
    "│  └───┬───┘  │  ",
    "◯      │      ◯  ",
    "│   ┌──┴──┐   │  ",
    "└───┤     ├───┘  ",
    "    │     │      ",
    "  ┌─┴     ┴─┐    ",
    "  │         │    ",
    " ─┘         └─   ",
  ],
  // Frame 6: standing happy
  [
    "    ┌───────┐    ",
    "    │ ◉   ◉ │    ",
    "    │  ◡◡◡  │    ",
    " ┌──┤       ├──┐ ",
    " │  └───┬───┘  │ ",
    " ◯      │      ◯ ",
    " │   ┌──┴──┐   │ ",
    " └───┤     ├───┘ ",
    "     │     │     ",
    "     ┴─┐ ┌─┴     ",
    "       │ │       ",
    "      ─┘ └─      ",
  ],
];

interface BoltAnimatedProps {
  dancing?: boolean;
  message?: string | string[];
}

export function BoltAnimated({
  dancing = true,
  message,
}: BoltAnimatedProps): React.ReactElement {
  const [frame, setFrame] = useState(0);
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    if (!dancing) return;
    const timer = setInterval(() => {
      setFrame((prev) => (prev + 1) % BOLT_FRAMES.length);
    }, 400);
    return () => clearInterval(timer);
  }, [dancing]);

  // Cycle through messages every 8 seconds
  useEffect(() => {
    if (!Array.isArray(message) || message.length <= 1) return;
    setMessageIndex(0);
    const timer = setInterval(() => {
      setMessageIndex((prev) => (prev + 1) % (message as string[]).length);
    }, 8000);
    return () => clearInterval(timer);
  }, [message]);

  const currentFrame = BOLT_FRAMES[dancing ? frame : 0];
  const currentMessage = Array.isArray(message)
    ? message[messageIndex % message.length]
    : message;

  return (
    <Box flexDirection="column" alignItems="center">
      <Box flexDirection="column">
        {currentFrame.map((line, index) => (
          <Text key={index} color="cyan">
            {line}
          </Text>
        ))}
      </Box>
      {currentMessage && (
        <Box marginTop={1}>
          <Text bold>
            {"  "}
            <Text color="cyan">Bolt:</Text> <Text dimColor>"{currentMessage}"</Text>
          </Text>
        </Box>
      )}
    </Box>
  );
}
