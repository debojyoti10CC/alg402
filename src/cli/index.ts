#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { runInitCommand } from "./init.js";
import { runTestCommand } from "./test.js";
import { runFuzzCommand } from "./fuzz.js";
import { runReportCommand } from "./report.js";

const program = new Command();

program
  .name("ward")
  .description("Verifies whether an x402 payment facilitator on Algorand actually honors its correctness invariants.")
  .version("0.1.0");

program
  .command("init")
  .description("Boot the self-hosted facilitator, fund test accounts, and verify one real payment end-to-end")
  .action(runOrExit(runInitCommand));

program
  .command("test")
  .description("Run the full invariant suite and write a JSON report")
  .action(runOrExit(runTestCommand));

program
  .command("fuzz <id>")
  .description("Run one invariant in isolation with verbose evidence output (e.g. `ward fuzz A1`)")
  .action(runOrExit((id: string) => runFuzzCommand(id)));

program
  .command("report")
  .description("Re-render the last `ward test` run from reports/latest.json")
  .action(runOrExit(runReportCommand));

function runOrExit<Args extends unknown[]>(fn: (...args: Args) => Promise<void>) {
  return async (...args: Args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error(chalk.red(`\nward: ${err instanceof Error ? err.message : String(err)}`));
      if (err instanceof Error && err.stack && process.env.WARD_DEBUG) {
        console.error(chalk.gray(err.stack));
      }
      process.exitCode = 1;
    }
  };
}

program.parseAsync(process.argv);
