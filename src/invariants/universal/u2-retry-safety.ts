import type { Invariant, ScenarioContext, TestFixture } from "../../core/types.js";
import { EvidenceCollector } from "../../util/evidence.js";
import { makeResult } from "../shared.js";

const RETRY_COUNT = 3;

/**
 * U2 — retry safety.
 *
 * Sends the *identical* signed authorization to /settle several times in a
 * row — simulating a client that retries after a perceived timeout/unknown
 * outcome, without minting a new signature. Because Algorand's own txID
 * dedup makes replaying byte-identical signed transactions to algod safe by
 * construction, "exactly one success" isn't the sharp assertion here (a
 * facilitator can legitimately echo success on every retry, each time
 * referring to the same transaction). What must never happen is retries
 * resolving to *more than one distinct on-chain transaction id* — that
 * would mean the facilitator re-signed or re-submitted a fresh transfer per
 * retry, i.e. a real double-settlement (Free Shopping / Asset Theft, if the
 * fee payer or client didn't intend to pay twice).
 */
export function createU2Invariant(fixture: TestFixture): Invariant {
  return {
    id: "U2",
    name: "retry safety",
    category: "universal",
    source: "x402 protocol spec — retrying an unresolved settlement must not double-settle; USENIX study — Free Shopping via naive retry handling",
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

      const responses: Array<{ attempt: number; success: boolean; transaction: string; errorReason?: string }> = [];
      for (let attempt = 1; attempt <= RETRY_COUNT; attempt++) {
        const result = await ctx.facilitator.settle(payload);
        evidence.record(`settle retry #${attempt}`, payload, result);
        responses.push({
          attempt,
          success: result.success,
          transaction: result.transaction,
          errorReason: result.errorReason,
        });
      }

      const distinctSuccessfulTxns = new Set(
        responses.filter((r) => r.success && r.transaction).map((r) => r.transaction),
      );
      const noDoubleSettlement = distinctSuccessfulTxns.size <= 1;

      const distinctErrorReasons = new Set(responses.filter((r) => !r.success).map((r) => r.errorReason ?? "unknown"));
      const failuresConsistent = distinctErrorReasons.size <= 1;

      const anySucceeded = distinctSuccessfulTxns.size === 1;
      const passed = noDoubleSettlement && (anySucceeded || failuresConsistent);

      const summary = anySucceeded
        ? `all ${RETRY_COUNT} retries converged on a single transaction (${[...distinctSuccessfulTxns][0]}) — no double-settlement`
        : noDoubleSettlement
          ? `no retry succeeded (env likely unfunded) but all ${RETRY_COUNT} failures were consistent (${[...distinctErrorReasons][0]}) — no evidence of nondeterministic double-processing`
          : `retries produced ${distinctSuccessfulTxns.size} DISTINCT on-chain transactions for one signed authorization — double-settlement`;

      return makeResult("U2", "retry safety", "universal", start, passed, summary, {
        responses,
        distinctSuccessfulTxns: [...distinctSuccessfulTxns],
        evidence: evidence.all(),
      });
    },
  };
}
