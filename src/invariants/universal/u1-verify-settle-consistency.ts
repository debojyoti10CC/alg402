import type { Invariant, PayloadMutation, ScenarioContext, TestFixture } from "../../core/types.js";
import { EvidenceCollector } from "../../util/evidence.js";
import { makeResult } from "../shared.js";

/**
 * U1 — verify/settle consistency.
 *
 * Builds one valid payload per sub-case, calls /verify on the UNMUTATED
 * payload (expecting approval), then calls /settle on a version with a
 * single field mutated afterward. A correct facilitator must reject the
 * mutated settlement (or settle only the originally-verified terms) — if it
 * settles the mutated terms instead, /verify's approval was meaningless and
 * a client can get different terms honored at settle time than what was
 * shown at verify time (Free Shopping / Asset Theft, per the USENIX study).
 */
export function createU1Invariant(fixture: TestFixture): Invariant {
  return {
    id: "U1",
    name: "verify/settle consistency under post-verify mutation",
    category: "universal",
    source:
      "x402 protocol spec (verify/settle contract); USENIX Security '26 facilitator study — Free Shopping & Asset Theft violation classes",
    async run(ctx: ScenarioContext) {
      const start = Date.now();
      const evidence = new EvidenceCollector();

      const mutations: PayloadMutation[] = [
        { kind: "network", value: fixture.alternateNetwork },
        { kind: "asset", value: fixture.unsupportedAsset },
        { kind: "recipient", value: fixture.clientAccount.address },
        { kind: "amount", value: (fixture.amount * 1000n).toString() },
      ];

      const subResults: Array<{ field: string; ok: boolean; detail: string }> = [];

      for (const mutation of mutations) {
        const original = await ctx.chain.buildPayment({
          from: fixture.clientAccount,
          to: fixture.payToAddress,
          amount: fixture.amount,
          asset: fixture.asset,
          facilitatorFeeAddress: fixture.facilitatorFeeAddress,
          resource: fixture.resource,
        });

        const verifyResult = await ctx.facilitator.verify(original);
        evidence.record(`verify baseline (${mutation.kind} case)`, original, verifyResult);

        if (!verifyResult.isValid) {
          subResults.push({
            field: mutation.kind,
            ok: false,
            detail: `baseline verify rejected before the mutation was even applied (${verifyResult.invalidReason}) — cannot exercise this sub-case`,
          });
          continue;
        }

        const tampered = ctx.chain.tamperPayload(original, mutation);
        const settleResult = await ctx.facilitator.settle(tampered);
        evidence.record(`settle after mutating ${mutation.kind}`, tampered, settleResult);

        const rejected = !settleResult.success;
        subResults.push({
          field: mutation.kind,
          ok: rejected,
          detail: rejected
            ? `settle correctly rejected the mutated ${mutation.kind} (${settleResult.errorReason ?? "no reason given"})`
            : `settle SUCCEEDED (tx ${settleResult.transaction}) despite a mutated ${mutation.kind} that verify never approved`,
        });
      }

      const passed = subResults.length > 0 && subResults.every((r) => r.ok);
      const summary = subResults.map((r) => `${r.field}: ${r.ok ? "OK" : "VIOLATION"}`).join(", ");
      return makeResult(
        "U1",
        "verify/settle consistency under post-verify mutation",
        "universal",
        start,
        passed,
        summary,
        { subResults, evidence: evidence.all() },
      );
    },
  };
}
