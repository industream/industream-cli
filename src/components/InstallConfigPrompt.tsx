import React, { useState } from "react";
import { Text, Box, useInput } from "ink";

type TlsMode = "selfsigned" | "letsencrypt";
type Phase =
  | "menu"
  | "edit-domain"
  | "edit-tls"
  | "edit-license"
  | "activating-license";

interface InstallConfigPromptProps {
  defaultDomain: string;
  defaultTls: TlsMode;
  initialLicenseLabel: string;
  activateLicense: (key: string) => Promise<{ ok: boolean; label: string; error?: string }>;
  onComplete: (config: { domain: string; tls: TlsMode }) => void;
}

export function InstallConfigPrompt({
  defaultDomain,
  defaultTls,
  initialLicenseLabel,
  activateLicense,
  onComplete,
}: InstallConfigPromptProps): React.ReactElement {
  const [phase, setPhase] = useState<Phase>("menu");
  const [menuIndex, setMenuIndex] = useState<number>(0); // 0=env, 1=license, 2=install

  const [domain, setDomain] = useState(defaultDomain);
  const [tls, setTls] = useState<TlsMode>(defaultTls);
  const [licenseLabel, setLicenseLabel] = useState(initialLicenseLabel);
  const [licenseMessage, setLicenseMessage] = useState<string>("");

  const [domainInput, setDomainInput] = useState<string>(defaultDomain);
  const [tlsIndex, setTlsIndex] = useState<number>(defaultTls === "letsencrypt" ? 1 : 0);
  const [licenseInput, setLicenseInput] = useState<string>("");

  useInput((input, key) => {
    if (phase === "menu") {
      if (key.upArrow) setMenuIndex((i) => Math.max(0, i - 1));
      if (key.downArrow) setMenuIndex((i) => Math.min(2, i + 1));
      if (key.return) {
        if (menuIndex === 0) {
          setDomainInput(domain);
          setTlsIndex(tls === "letsencrypt" ? 1 : 0);
          setPhase("edit-domain");
        } else if (menuIndex === 1) {
          setLicenseInput("");
          setLicenseMessage("");
          setPhase("edit-license");
        } else {
          onComplete({ domain, tls });
        }
      }
      return;
    }

    if (phase === "edit-domain") {
      if (key.return) {
        setDomain(domainInput.trim() || defaultDomain);
        setPhase("edit-tls");
        return;
      }
      if (key.escape) {
        setPhase("menu");
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

    if (phase === "edit-tls") {
      if (key.upArrow || key.downArrow) {
        setTlsIndex((index) => (index === 0 ? 1 : 0));
        return;
      }
      if (key.return) {
        const newTls: TlsMode = tlsIndex === 0 ? "selfsigned" : "letsencrypt";
        setTls(newTls);
        setPhase("menu");
        setMenuIndex(2);
        return;
      }
      if (key.escape) {
        setPhase("menu");
      }
      return;
    }

    if (phase === "edit-license") {
      if (key.return) {
        const key = licenseInput.trim();
        if (key.length === 0) {
          setPhase("menu");
          return;
        }
        setPhase("activating-license");
        activateLicense(key)
          .then((result) => {
            if (result.ok) {
              setLicenseLabel(result.label);
              setLicenseMessage(`✓ License activated: ${result.label}`);
            } else {
              setLicenseMessage(`✗ Activation failed: ${result.error ?? "unknown error"}`);
            }
            setPhase("menu");
            setMenuIndex(2);
          })
          .catch((err) => {
            setLicenseMessage(`✗ Error: ${err instanceof Error ? err.message : String(err)}`);
            setPhase("menu");
          });
        return;
      }
      if (key.escape) {
        setPhase("menu");
        return;
      }
      if (key.backspace || key.delete) {
        setLicenseInput((value) => value.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setLicenseInput((value) => value + input);
      }
    }
  });

  if (phase === "edit-domain") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Define your environment — Domain</Text>
        <Box marginTop={1}>
          <Text color="cyan">? </Text>
          <Text bold>Domain name: </Text>
          <Text>
            {domainInput}
            <Text color="gray">█</Text>
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Type domain then Enter (Backspace to edit, Esc to cancel)</Text>
        </Box>
      </Box>
    );
  }

  if (phase === "edit-tls") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Define your environment — TLS mode</Text>
        <Box flexDirection="column" marginLeft={2} marginTop={1}>
          <Text color={tlsIndex === 0 ? "cyan" : undefined}>
            {tlsIndex === 0 ? "❯ " : "  "}Self-signed{" "}
            <Text dimColor>(local development, no public DNS required)</Text>
          </Text>
          <Text color={tlsIndex === 1 ? "cyan" : undefined}>
            {tlsIndex === 1 ? "❯ " : "  "}Let's Encrypt{" "}
            <Text dimColor>(public domain + DNS provider credentials)</Text>
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>↑/↓ to select, Enter to confirm, Esc to cancel</Text>
        </Box>
      </Box>
    );
  }

  if (phase === "edit-license") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Activate license</Text>
        <Box marginTop={1}>
          <Text color="cyan">? </Text>
          <Text bold>License key: </Text>
          <Text>
            {licenseInput}
            <Text color="gray">█</Text>
          </Text>
        </Box>
        <Box marginTop={1}>
          <Text dimColor>Paste your license key then Enter (Esc to cancel, empty to skip)</Text>
        </Box>
      </Box>
    );
  }

  if (phase === "activating-license") {
    return (
      <Box flexDirection="column" marginY={1}>
        <Text bold>Activating license…</Text>
        <Box marginTop={1}>
          <Text dimColor>Contacting Keygen API, please wait</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" marginY={1}>
      <Text bold>Installation menu</Text>
      <Box flexDirection="column" marginTop={1}>
        <Box flexDirection="column">
          <Text color={menuIndex === 0 ? "cyan" : undefined}>
            {menuIndex === 0 ? "❯ " : "  "}1. Define your environment
          </Text>
          <Box flexDirection="column" marginLeft={5}>
            <Text dimColor>Domain:   {domain}</Text>
            <Text dimColor>TLS mode: {tls}</Text>
          </Box>
        </Box>
        <Box flexDirection="column" marginTop={1}>
          <Text color={menuIndex === 1 ? "cyan" : undefined}>
            {menuIndex === 1 ? "❯ " : "  "}2. Activate license
          </Text>
          <Box marginLeft={5}>
            <Text dimColor>Current: {licenseLabel}</Text>
          </Box>
        </Box>
        <Box marginTop={1}>
          <Text color={menuIndex === 2 ? "cyan" : undefined}>
            {menuIndex === 2 ? "❯ " : "  "}3. Install
          </Text>
        </Box>
      </Box>
      {licenseMessage.length > 0 && (
        <Box marginTop={1}>
          <Text color={licenseMessage.startsWith("✓") ? "green" : "red"}>{licenseMessage}</Text>
        </Box>
      )}
      <Box marginTop={1}>
        <Text dimColor>↑/↓ to navigate, Enter to select</Text>
      </Box>
    </Box>
  );
}
