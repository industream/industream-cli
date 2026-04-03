// src/commands/status.tsx
import React, { useState, useEffect } from "react";
import { render, Text, Box, useInput, useApp } from "ink";
import { Banner } from "../components/Banner.js";
import { ServiceTable } from "../components/ServiceTable.js";
import { getSwarmServices, isSwarmActive } from "../lib/docker.js";
import { loadConfig } from "../lib/config.js";

function StatusDashboard(): React.ReactElement {
  const { exit } = useApp();
  const [services, setServices] = useState<Awaited<ReturnType<typeof getSwarmServices>>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchStatus() {
      try {
        const config = await loadConfig();
        const stackName = `industream-${config.defaultEnvironment}`;
        const active = await isSwarmActive();
        if (!active) {
          setError("Docker Swarm is not active. Run: docker swarm init");
          setLoading(false);
          return;
        }
        const result = await getSwarmServices(stackName);
        setServices(result);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to get status");
      } finally {
        setLoading(false);
      }
    }
    fetchStatus();
  }, []);

  useInput((input) => {
    if (input === "q") exit();
  });

  if (loading) {
    return <Text color="blue">Loading services...</Text>;
  }

  if (error) {
    return <Text color="red">{error}</Text>;
  }

  const running = services.filter((s) => s.isRunning).length;

  return (
    <Box flexDirection="column">
      <Banner />
      <ServiceTable services={services} />
      <Box marginTop={1}>
        <Text dimColor>
          {running}/{services.length} services running — press q to quit
        </Text>
      </Box>
    </Box>
  );
}

export function runStatus(): void {
  render(<StatusDashboard />);
}
