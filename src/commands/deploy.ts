// src/commands/deploy.ts
// Thin router: delegates to the active Runtime (Swarm or Compose).
// All deployment logic lives in src/lib/runtimes/{swarm,compose}.ts.
import { loadConfig } from "../lib/config.js";
import { getRuntime } from "../lib/runtimes/index.js";
import type { DeployOptions } from "../lib/runtimes/index.js";

export type Environment = "prod" | "dev" | "staging";

export async function runDeploy(
  environment?: string,
  options?: DeployOptions,
): Promise<void> {
  const config = await loadConfig();
  const runtime = await getRuntime(config);

  // Live 4-pane dashboard when we have a TTY and an explicit environment
  // (no interactive env prompt while Ink owns the screen). Both swarm and
  // compose runtimes emit progress; CI / non-TTY use the plain stdout path.
  const useDashboard = Boolean(environment) && Boolean(process.stdout.isTTY);

  if (!useDashboard) {
    await runtime.deploy(environment, options ?? {});
    return;
  }

  const [{ render }, React, { DeployReporter }, { DeployDashboard }] =
    await Promise.all([
      import("ink"),
      import("react"),
      import("../lib/deploy-reporter.js"),
      import("../components/DeployDashboard.js"),
    ]);

  const reporter = new DeployReporter();
  const app = render(
    React.createElement(DeployDashboard, {
      reporter,
      title: `Industream · ${environment} · ${runtime.name}`,
    }),
  );

  try {
    await runtime.deploy(environment, options ?? {}, reporter);
    // Let the final frame (result pane) flush before tearing down.
    await new Promise((r) => setTimeout(r, 300));
  } finally {
    app.unmount();
  }
}
