// src/components/Banner.tsx
import React from "react";
import { Text, Box } from "ink";

export function Banner(): React.ReactElement {
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="blue">
        INDUSTREAM PLATFORM
      </Text>
    </Box>
  );
}
