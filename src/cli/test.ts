import { runInvariants } from "../core/runner.js";
import { buildReport, renderTerminalReport, writeReport } from "../core/report-engine.js";
import { buildScenario, MUST_HAVE_IDS } from "./setup.js";

export async function runTestCommand(): Promise<void> {
  const { ctx, registry, config } = buildScenario();
  const invariants = registry.all();

  const summary = await runInvariants(invariants, ctx, { concurrent: false });

  const report = buildReport(summary.results, {
    name: "self-hosted x402-avm facilitator (GoPlausible)",
    commit: process.env.FACILITATOR_COMMIT ?? "unknown",
    chain: `algorand-${config.network}`,
  });

  console.log(renderTerminalReport(report));
  const { timestampedPath } = await writeReport(report);
  console.log(`\nReport written to ${timestampedPath} (and reports/latest.json)`);

  const mustHaveFailed = report.results.some((r) => MUST_HAVE_IDS.includes(r.id) && !r.passed);
  if (mustHaveFailed) {
    process.exitCode = 1;
  }
}
