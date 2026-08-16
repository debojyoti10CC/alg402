import type { Invariant, ScenarioContext, TestFixture } from "../../core/types.js";
import { EvidenceCollector } from "../../util/evidence.js";
import { makeResult } from "../shared.js";

const RESUBMIT_COUNT = 5;
// A request taking > 10x the first attempt's latency is treated as evidence of unbounded
// internal amplification (e.g. a naive retry-with-backoff loop per resubmission) rather
// than a flat, bounded rejection cost.
const LATENCY_BLOWUP_FACTOR = 10;

/**
 * U5 — gas abuse resubmission (stretch).
 *
 * Crafts a payload with an amount the client's real balance can't cover.
 * Verify's structural checks (signature, declared amount/receiver/asset
 * match) all pass cheaply — the failure only shows up when the facilitator
 * actually tries to settle (simulate/submit against real account state).
 * Resubmitting that same doomed payload repeatedly must stay a bounded-cost
 * rejection on every attempt, not something that gets progressively more
 * expensive (which would let a client force the facilitator to spend
 * unbounded work rejecting a payment that was never going to succeed —
 * the USENIX study's Gas Abuse class).
 */
export function createU5Invariant(fixture: TestFixture): Invariant {
  return {
    id: "U5",
    name: "gas abuse resubmission",
    category: "universal",
    source: "USENIX Security '26 facilitator study — Gas Abuse violation class",
    async run(ctx: ScenarioContext) {
      const start = Date.now();
      const evidence = new EvidenceCollector();

      // Comfortably beyond any realistic TestNet USDC balance, so verify's declared-terms
      // checks pass but the underlying transfer can never actually succeed.
      const unaffordableAmount = fixture.amount * 1_000_000_000n;

      const payload = await ctx.chain.buildPayment({
        from: fixture.clientAccount,
        to: fixture.payToAddress,
        amount: unaffordableAmount,
        asset: fixture.asset,
        facilitatorFeeAddress: fixture.facilitatorFeeAddress,
        resource: fixture.resource,
      });

      const attempts: Array<{ attempt: number; success: boolean; latencyMs: number; errorReason?: string }> = [];
      for (let attempt = 1; attempt <= RESUBMIT_COUNT; attempt++) {
        const attemptStart = Date.now();
        const result = await ctx.facilitator.settle(payload);
        const latencyMs = Date.now() - attemptStart;
        evidence.record(`resubmit #${attempt} of an unaffordable payload`, payload, { ...result, latencyMs });
        attempts.push({ attempt, success: result.success, latencyMs, errorReason: result.errorReason });
      }

      const neverSucceeded = attempts.every((a) => !a.success);
      const firstLatency = attempts[0]?.latencyMs ?? 0;
      const maxLatency = Math.max(...attempts.map((a) => a.latencyMs));
      const boundedCost = firstLatency === 0 || maxLatency <= firstLatency * LATENCY_BLOWUP_FACTOR;

      const passed = neverSucceeded && boundedCost;
      const summary = !neverSucceeded
        ? "an unaffordable payload SUCCEEDED on resubmission — verify's cheap checks and settle's real-balance check disagree"
        : boundedCost
          ? `all ${RESUBMIT_COUNT} resubmissions rejected with bounded, consistent latency (max ${maxLatency}ms vs first ${firstLatency}ms)`
          : `rejection latency grew ${(maxLatency / (firstLatency || 1)).toFixed(1)}x across resubmissions (${firstLatency}ms → ${maxLatency}ms) — possible unbounded internal amplification`;

      return makeResult("U5", "gas abuse resubmission", "universal", start, passed, summary, {
        attempts,
        evidence: evidence.all(),
      });
    },
  };
}
