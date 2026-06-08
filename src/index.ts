#!/usr/bin/env node
import { Command } from "commander";
import { runStatus } from "./commands/status.js";
import { runDeploy } from "./commands/deploy.js";
import { runDown, runStop } from "./commands/stop.js";
import { runLogs } from "./commands/logs.js";
import { runSecrets } from "./commands/secrets.js";
import { runInstall } from "./commands/install.js";
import { runDoctor } from "./commands/doctor.js";
import { runUpdate } from "./commands/update.js";
import { runConfig } from "./commands/config.js";
import { runLicense } from "./commands/license.js";
import { runUninstall } from "./commands/uninstall.js";
import { runWorkerAdd, runWorkerList, runWorkerRemove } from "./commands/worker.js";
import { runMenu } from "./commands/menu.js";
import {
  runDevCreate,
  runDevUp,
  runDevDown,
  runDevList,
  runDevPs,
  runDevLogs,
  runDevDelete,
  runDevLaunchWorker,
  runDevCdnReset,
  runDevHosts,
  runDevInit,
  runDevSync,
} from "./commands/dev.js";
import {
  runCaddyRebuild,
  runCaddyStop,
  runCaddyDelete,
  runCaddyLogs,
  runCaddyCa,
} from "./commands/caddy.js";

const program = new Command();

program
  .name("industream")
  .description("Industream Platform CLI")
  .version("0.1.0")
  .action(() => {
    // No subcommand → show interactive menu
    runMenu();
  });

program
  .command("status")
  .description("Show platform status dashboard")
  .action(() => {
    runStatus();
  });

program
  .command("deploy")
  .description("Deploy an environment")
  .option("--env <environment>", "Environment to deploy (prod, dev, staging, or compose instance name)")
  .option("--runtime <runtime>", "Unified path: override runtime (swarm|compose) — default from .env")
  .option("--edition <edition>", "Unified path: override edition (ce|ee) — default from .env")
  .option("--bundle <version>", "Unified path: release bundle version (auto-selected if only one)")
  .option("--groups <groups>", "Unified path: group footprint, e.g. \"core data monitoring\"")
  .option("--with-demo", "Include demo simulators (Swarm)")
  .option("--with-workers", "Bring up workers alongside core services (Compose)")
  .option("--with-uimaker", "Bring up UIMaker alongside core services (Compose)")
  .option(
    "--allow-compose-prod",
    "Allow ComposeRuntime to proceed when NODE_ENV=production (bypass guard)",
  )
  .option("-y, --yes", "Skip interactive prompts")
  .action((options) => {
    runDeploy(options.env, {
      runtime: options.runtime,
      edition: options.edition,
      bundle: options.bundle,
      groups: options.groups,
      withDemo: options.withDemo,
      withWorkers: options.withWorkers,
      withUimaker: options.withUimaker,
      allowComposeProd: options.allowComposeProd,
      yes: options.yes,
    });
  });

program
  .command("down")
  .description("Bring an environment down (data preserved)")
  .option("--env <environment>", "Environment to stop (prod, dev, staging)")
  .option("--runtime <runtime>", "Override runtime (swarm|compose) — default from .env")
  .action((options) => {
    runDown(options.env, options.runtime);
  });

// Backward-compat: keep `stop` as alias for `down`
program
  .command("stop", { hidden: true })
  .option("--env <environment>")
  .option("--runtime <runtime>")
  .action((options) => {
    runStop(options.env, options.runtime);
  });

program
  .command("logs [service]")
  .description("View service logs")
  .option("-f, --follow", "Follow log output")
  .option("--tail <lines>", "Number of lines to show", "100")
  .option("--env <environment>", "Environment whose logs to view (unified path)")
  .option("--runtime <runtime>", "Override runtime (swarm|compose) — default from .env")
  .action((service, options) => {
    runLogs(service, {
      follow: options.follow,
      tail: Number(options.tail),
      env: options.env,
      runtime: options.runtime,
    });
  });

program
  .command("secrets")
  .description("Manage platform secrets")
  .option("--show", "Display secret values")
  .option("--regenerate", "Regenerate all secrets")
  .action((options) => {
    runSecrets(options);
  });

program
  .command("install")
  .description("Install the Industream platform")
  .option("--env <environment>", "Environment to deploy (prod, dev, staging)", "prod")
  .option("--domain <domain>", "Platform domain name", "industream.platform.lan")
  .option("--tls <mode>", "TLS mode (selfsigned, letsencrypt). Default: selfsigned")
  .option(
    "--runtime <runtime>",
    "Container orchestrator (swarm or compose). Locked in .env. Default: swarm",
    "swarm",
  )
  .action((options) => {
    runInstall(options.env, options.domain, options.tls, options.runtime);
  });

program
  .command("update")
  .description("Check for available platform updates")
  .action(() => {
    runUpdate();
  });

program
  .command("config")
  .description("View and edit platform .env configuration")
  .action(() => {
    runConfig();
  });

program
  .command("doctor")
  .description("Preflight: check (and with --fix provision) install prerequisites")
  .option("--runtime <runtime>", "swarm (prod) or compose (dev)")
  .option("--edition <edition>", "ce or ee")
  .option("--env <environment>", "Environment name (default: prod for swarm, dev for compose)")
  .option("--fix", "Provision the missing prerequisites")
  .option("-y, --yes", "Auto-confirm fixes")
  .action((options) => {
    runDoctor({
      runtime: options.runtime,
      edition: options.edition,
      env: options.env,
      fix: options.fix,
      yes: options.yes,
    });
  });

program
  .command("license")
  .description("View or set license information")
  .option("--set <token>", "Save a new license token")
  .action((options) => {
    runLicense({ set: options.set });
  });

program
  .command("uninstall")
  .description("Remove the platform from an environment")
  .option("--env <environment>", "Environment to uninstall")
  .action((options) => {
    runUninstall(options.env);
  });

const workerCommand = new Command("worker").description("Manage external workers");

workerCommand
  .command("add")
  .argument("<path>", "Path to worker directory containing industream.yaml")
  .description("Install an external worker from a directory")
  .action((path: string) => {
    runWorkerAdd(path);
  });

workerCommand
  .command("list")
  .description("List installed external workers")
  .action(() => {
    runWorkerList();
  });

workerCommand
  .command("remove")
  .argument("<name>", "Worker name to remove")
  .description("Remove an installed external worker")
  .action((name: string) => {
    runWorkerRemove(name);
  });

program.addCommand(workerCommand);

// ============================================================================
// `industream dev` — Compose multi-instance management (fm).
// Thin wrappers around the thematic bash scripts under
// industream-stack/scripts/compose/. See docs/RUNTIME-STRATEGY.md §3.3.
// ============================================================================
const devCommand = new Command("dev").description(
  "Manage Compose dev instances (create, up, down, list, ...)",
);

devCommand
  .command("create")
  .argument("<name>", "Instance name")
  .description("Create a new Compose instance (interactive prompts)")
  .action((name: string) => {
    runDevCreate(name);
  });

devCommand
  .command("up")
  .argument("<name>", "Instance name")
  .description("Start a Compose instance")
  .option("--workers", "Also bring up the workers stack")
  .option("--uimaker", "Also bring up UIMaker (profile)")
  .option("--community", "Use the public community Harbor (no premium creds required)")
  .option("--local", "Skip image pull, use locally available images only")
  .action((name: string, options) => {
    runDevUp(name, options);
  });

devCommand
  .command("down")
  .argument("<name>", "Instance name")
  .description("Stop a Compose instance (keep volumes)")
  .action((name: string) => {
    runDevDown(name);
  });

devCommand
  .command("list")
  .description("List all Compose instances")
  .action(() => {
    runDevList();
  });

devCommand
  .command("ps")
  .argument("<name>", "Instance name")
  .description("List containers of an instance")
  .action((name: string) => {
    runDevPs(name);
  });

devCommand
  .command("logs")
  .argument("<name>", "Instance name")
  .argument("[service]", "Optional service name")
  .description("View instance logs")
  .action((name: string, service?: string) => {
    runDevLogs(name, service);
  });

devCommand
  .command("delete")
  .argument("<name>", "Instance name")
  .description("Delete an instance and its data (destructive)")
  .action((name: string) => {
    runDevDelete(name);
  });

devCommand
  .command("launch-worker")
  .argument("<instance>", "Instance name")
  .argument("<worker>", "Worker name")
  .argument("[process-args...]", "Optional process command override")
  .description("Run a local worker process against a running instance")
  .option("--id <id>", "Worker id (default: worker-local-<random>)")
  .option("--port <port>", "ZMQ port to bind (default: auto from 5570)")
  .option("--flowmaker-workers-path <path>", "Path to worker-cli root")
  .action((instance: string, worker: string, processArgs: string[], options) => {
    runDevLaunchWorker(instance, worker, processArgs ?? [], {
      id: options.id,
      port: options.port,
      workersPath: options.flowmakerWorkersPath,
    });
  });

devCommand
  .command("cdn-reset")
  .argument("<name>", "Instance name")
  .argument("[worker]", "Worker name or 'all' (default)")
  .description("Reset CDN seed flag for workers (triggers re-seed on restart)")
  .action((name: string, worker?: string) => {
    runDevCdnReset(name, worker);
  });

devCommand
  .command("hosts")
  .description("Print /etc/hosts entries for all known instances")
  .action(() => {
    runDevHosts();
  });

devCommand
  .command("init")
  .argument("<name>", "Instance name")
  .description("Initialize confighub (environment + scheduler)")
  .action((name: string) => {
    runDevInit(name);
  });

devCommand
  .command("sync")
  .argument("<name>", "Instance name")
  .description("Sync instance versions from release-tracker")
  .action((name: string) => {
    runDevSync(name);
  });

program.addCommand(devCommand);

// ============================================================================
// `industream caddy:*` — local reverse-proxy management (community dev).
// Commander doesn't accept ":" in command names, so we expose them as aliases
// on a nested `caddy` sub-command: `industream caddy rebuild` works, and the
// bash dispatcher keeps `industream caddy:rebuild` for power users.
// ============================================================================
const caddyCommand = new Command("caddy").description(
  "Manage the local Caddy reverse proxy (community Compose dev)",
);

caddyCommand
  .command("rebuild")
  .description("Regenerate Caddy config from all instance .env files")
  .action(() => {
    runCaddyRebuild();
  });

caddyCommand
  .command("stop")
  .description("Stop the Caddy container")
  .action(() => {
    runCaddyStop();
  });

caddyCommand
  .command("delete")
  .description("Stop Caddy and remove all its data (CA, volumes)")
  .action(() => {
    runCaddyDelete();
  });

caddyCommand
  .command("logs")
  .description("Tail Caddy logs")
  .action(() => {
    runCaddyLogs();
  });

caddyCommand
  .command("ca")
  .argument("[dest]", "Destination path for the exported CA (default: ~/caddy-root-ca.crt)")
  .description("Export the Caddy root CA certificate")
  .action((dest?: string) => {
    runCaddyCa(dest);
  });

program.addCommand(caddyCommand);

program.parse();
