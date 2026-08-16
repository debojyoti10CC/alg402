import type { Invariant, ScenarioContext, TestFixture } from "../../core/types.js";
import { EvidenceCollector } from "../../util/evidence.js";
import { dispatchConcurrently } from "../../util/timing.js";
import { makeResult } from "../shared.js";

const CONCURRENCY = 5;

/**
 * U3 — concurrent double-settle.
 *
 * Fires CONCURRENCY simultaneous /settle requests for one signed
 * authorization, released from a single shared gate (util/timing.ts) rather
 * than relying on natural network jitter, so the race is reproducible run
 * to run. This targets facilitator-side races (e.g. a check-then-act
 * idempotency guard that's safe sequentially but not under concurrent
 * access) that U2's sequential retries can't expose. The safety-critical
 * assertion is the same as U2's: at most one *distinct* on-chain
 * transaction id may result, since the same signed bytes hash to the same
 * txid deterministically — but here we additionally require exactly one
 * HTTP-level success, since a facilitator with correct concurrency handling
 * should have exactly one request "win" a lock/claim rather than every
 * request racing algod directly.
 */
export function createU3Invariant(fixture: TestFixture): Invariant {
  return {
    id: "U3",
    name: "concurrent double-settle",
    category: "universal",
    source: "USENIX Security '26 facilitator study — concurrency races enabling double-settlement (Free Shopping / Asset Theft)",
    async run(ctx: ScenarioContext) {
      const start = Date.now();
      const evidence = new EvidenceCollector();

      const payload = await ctx.chain.buildPayment({
        from: fixture.clientAccount,
        to: fixture.payToAddress,
        amount: fixture.amount,
        asset: fixture.asset,
        facilitatorFeeAddress: fixture.facilitatorFeeAddress,
        resource: fixture.resource,
      });

      const settled = await dispatchConcurrently(CONCURRENCY, () => ctx.facilitator.settle(payload));

      for (const outcome of settled) {
        evidence.record(
          `concurrent settle #${outcome.index}`,
          { dispatchedAt: outcome.dispatchedAt },
          outcome.status === "fulfilled"
            ? { ...outcome.value, settledAt: outcome.settledAt }
            : { error: String(outcome.reason), settledAt: outcome.settledAt },
        );
      }

      const successes = settled.filter((o) => o.status === "fulfilled" && o.value?.success);
      const distinctTxns = new Set(
        successes
          .map((o) => (o.status === "fulfilled" ? o.value?.transaction : undefined))
          .filter((txn): txn is string => Boolean(txn)),
      );

      const noDoubleSettlement = distinctTxns.size <= 1;
      const exactlyOneSuccess = successes.length === 1;

      let chainConfirmed: unknown = null;
      const [txId] = [...distinctTxns];
      if (distinctTxns.size === 1 && txId) {
        try {
          chainConfirmed = await ctx.chain.waitForConfirmation(txId);
          evidence.record("chain confirmation of the winning transaction", { txId }, chainConfirmed);
        } catch (err) {
          chainConfirmed = { error: err instanceof Error ? err.message : String(err) };
        }
      }

      const passed = noDoubleSettlement;
      const summary = noDoubleSettlement
        ? `${CONCURRENCY} concurrent /settle calls resolved to ${distinctTxns.size} distinct on-chain transaction(s), ${successes.length} HTTP-level success(es)` +
          (exactlyOneSuccess ? " — exactly one winner, as expected" : " — no double-settlement, though more than one request reported success (idempotent echo, not a separate transfer)")
        : `${CONCURRENCY} concurrent /settle calls produced ${distinctTxns.size} DISTINCT on-chain transactions — double-settlement race`;

      return makeResult("U3", "concurrent double-settle", "universal", start, passed, summary, {
        successCount: successes.length,
        distinctTxns: [...distinctTxns],
        chainConfirmed,
        evidence: evidence.all(),
      });
    },
  };
}
