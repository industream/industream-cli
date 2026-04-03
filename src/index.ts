#!/usr/bin/env node
import { Command } from "commander";
import { runStatus } from "./commands/status.js";

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

program.parse();
