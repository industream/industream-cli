#!/usr/bin/env node
import { Command } from "commander";

const program = new Command();

program
  .name("industream")
  .description("Industream Platform CLI")
  .version("0.1.0");

program.parse();
