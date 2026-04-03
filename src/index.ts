#!/usr/bin/env node
import { Command } from "commander";
import { runStatus } from "./commands/status.js";
import { runDeploy } from "./commands/deploy.js";
import { runStop } from "./commands/stop.js";
import { runLogs } from "./commands/logs.js";
import { runSecrets } from "./commands/secrets.js";
import { runInstall } from "./commands/install.js";
import { runUpdate } from "./commands/update.js";
import { runLicense } from "./commands/license.js";
import { runUninstall } from "./commands/uninstall.js";
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
  .command("stop")
  .description("Stop an environment")
  .option("--env <environment>", "Environment to stop (prod, dev, staging)")
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
  .action(() => {
    runInstall();
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

program.parse();
