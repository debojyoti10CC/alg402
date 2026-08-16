import type { Invariant, InvariantResult, ScenarioContext } from "./types.js";

export interface RunOptions {
  /** Run invariants concurrently instead of sequentially. Default: false. */
  concurrent?: boolean;
}

export interface RunSummary {
  results: InvariantResult[];
  total: number;
  passed: number;
  failed: number;
  skipped: number;
}

/**
 * Runs a set of invariants against a shared ScenarioContext. Sequential by
 * default so evidence/logs stay readable and one invariant's chain state
 * (e.g. account balances) can't bleed into another's; `concurrent: true` is
 * for invariants that are explicitly safe to interleave.
 */
export async function runInvariants(
  invariants: Invariant[],
  ctx: ScenarioContext,
  options: RunOptions = {},
): Promise<RunSummary> {
  const results: InvariantResult[] = [];

  if (options.concurrent) {
    const settled = await Promise.all(invariants.map((inv) => runOne(inv, ctx)));
    results.push(...settled);
  } else {
    for (const invariant of invariants) {
      results.push(await runOne(invariant, ctx));
    }
  }

  const passed = results.filter((r) => r.passed).length;
  const failed = results.length - passed;

  return { results, total: results.length, passed, failed, skipped: 0 };
}

async function runOne(invariant: Invariant, ctx: ScenarioContext): Promise<InvariantResult> {
  const start = Date.now();
  ctx.logger.info(`Running ${invariant.id} — ${invariant.name}`);
  try {
    const result = await invariant.run(ctx);
    ctx.logger.info(`${invariant.id} ${result.passed ? "PASSED" : "FAILED"} (${result.durationMs}ms)`);
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    const message = err instanceof Error ? err.message : String(err);
    ctx.logger.error(`${invariant.id} threw: ${message}`);
    return {
      id: invariant.id,
      name: invariant.name,
      category: invariant.category,
      passed: false,
      evidenceSummary: `Invariant threw an unhandled error: ${message}`,
      evidence: { error: message, stack: err instanceof Error ? err.stack : undefined },
      durationMs,
      timestamp: new Date().toISOString(),
    };
  }
}
