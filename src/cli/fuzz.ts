import chalk from "chalk";
import { buildScenario } from "./setup.js";

export async function runFuzzCommand(invariantId: string): Promise<void> {
  const { ctx, registry } = buildScenario("debug");
  const invariant = registry.requireGet(invariantId.toUpperCase());

  console.log(chalk.bold(`\nFuzzing ${invariant.id} — ${invariant.name}`));
  console.log(chalk.gray(invariant.source));
  console.log(chalk.gray(`category: ${invariant.category}\n`));

  const result = await invariant.run(ctx);

  console.log(chalk.bold(`\nResult: ${result.passed ? chalk.green("PASS") : chalk.red("FAIL")} (${result.durationMs}ms)`));
  console.log(result.evidenceSummary);
  console.log(chalk.gray("\n--- evidence ---"));
  console.log(JSON.stringify(result.evidence, null, 2));

  if (!result.passed) process.exitCode = 1;
}
