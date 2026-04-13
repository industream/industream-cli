#!/usr/bin/env node
import { Command } from "commander";
import { runStatus } from "./commands/status.js";
import { runDeploy } from "./commands/deploy.js";
import { runDown, runStop } from "./commands/stop.js";
import { runLogs } from "./commands/logs.js";
import { runSecrets } from "./commands/secrets.js";
import { runInstall } from "./commands/install.js";
import { runUpdate } from "./commands/update.js";
import { runLicense } from "./commands/license.js";
import { runUninstall } from "./commands/uninstall.js";
import { runWorkerAdd, runWorkerList, runWorkerRemove } from "./commands/worker.js";
import { runMenu } from "./commands/menu.js";

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
  .option("--env <environment>", "Environment to deploy (prod, dev, staging)")
  .option("--with-demo", "Include demo simulators")
  .option("-y, --yes", "Skip interactive prompts")
  .action((options) => {
    runDeploy(options.env, { withDemo: options.withDemo, yes: options.yes });
  });

program
  .command("down")
  .description("Bring an environment down (data preserved)")
  .option("--env <environment>", "Environment to stop (prod, dev, staging)")
  .action((options) => {
    runDown(options.env);
  });

// Backward-compat: keep `stop` as alias for `down`
program
  .command("stop", { hidden: true })
  .option("--env <environment>")
  .action((options) => {
    runStop(options.env);
  });

program
  .command("logs [service]")
  .description("View service logs")
  .option("-f, --follow", "Follow log output")
  .option("--tail <lines>", "Number of lines to show", "100")
  .action((service, options) => {
    runLogs(service, { follow: options.follow, tail: Number(options.tail) });
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
  .action((options) => {
    runInstall(options.env, options.domain);
  });

program
  .command("update")
  .description("Check for available platform updates")
  .action(() => {
    runUpdate();
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

program.parse();
