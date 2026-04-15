import React, { useState } from "react";
import { Text, Box, useInput } from "ink";

type TlsMode = "selfsigned" | "letsencrypt";

interface InstallConfigPromptProps {
  defaultDomain: string;
  defaultTls: TlsMode;
  onComplete: (config: { domain: string; tls: TlsMode }) => void;
}

export function InstallConfigPrompt({
  defaultDomain,
  defaultTls,
  onComplete,
}: InstallConfigPromptProps): React.ReactElement {
  const [phase, setPhase] = useState<"domain" | "tls">("domain");
  const [domainInput, setDomainInput] = useState(defaultDomain);
  const [tlsIndex, setTlsIndex] = useState<number>(defaultTls === "letsencrypt" ? 1 : 0);

  useInput((input, key) => {
    if (phase === "domain") {
      if (key.return) {
        setPhase("tls");
        return;
      }
      if (key.backspace || key.delete) {
        setDomainInput((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setDomainInput((value) => value + input);
      }
      return;
    }

    if (phase === "tls") {
      if (key.upArrow || key.downArrow) {
        setTlsIndex((index) => (index === 0 ? 1 : 0));
        return;
      }
      if (key.return) {
        const tls: TlsMode = tlsIndex === 0 ? "selfsigned" : "letsencrypt";
        onComplete({ domain: domainInput.trim() || defaultDomain, tls });
      }
    }
  });

  return (
    <Box flexDirection="column" marginY={1}>
      <Box>
        <Text color="cyan">? </Text>
        <Text bold>Domain name: </Text>
        {phase === "domain" ? (
          <Text>
            {domainInput}
            <Text color="gray">█</Text>
          </Text>
        ) : (
          <Text color="green">{domainInput}</Text>
        )}
      </Box>
      {phase === "tls" && (
        <Box flexDirection="column" marginTop={1}>
          <Box>
            <Text color="cyan">? </Text>
            <Text bold>TLS mode:</Text>
          </Box>
          <Box flexDirection="column" marginLeft={2}>
            <Text color={tlsIndex === 0 ? "cyan" : undefined}>
              {tlsIndex === 0 ? "❯ " : "  "}Self-signed{" "}
              <Text dimColor>(local development, no public domain needed)</Text>
            </Text>
            <Text color={tlsIndex === 1 ? "cyan" : undefined}>
              {tlsIndex === 1 ? "❯ " : "  "}Let's Encrypt{" "}
              <Text dimColor>(public domain with DNS access required)</Text>
            </Text>
          </Box>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>
          {phase === "domain"
            ? "Type domain then press Enter (Backspace to edit)"
            : "↑/↓ to select, Enter to confirm"}
        </Text>
      </Box>
    </Box>
  );
}
