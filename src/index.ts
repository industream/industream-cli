#!/usr/bin/env node
import { Command } from "commander";
import { runStatus } from "./commands/status.js";
import { runDeploy } from "./commands/deploy.js";
import { runStop } from "./commands/stop.js";
import { runLogs } from "./commands/logs.js";
import { runSecrets } from "./commands/secrets.js";
import { runInstall } from "./commands/install.js";

const program = new Command();

program
  .name("industream")
  .description("Industream Platform CLI")
  .version("0.1.0");

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
  .action((options) => {
    runDeploy(options.env, { withDemo: options.withDemo });
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

program.parse();
