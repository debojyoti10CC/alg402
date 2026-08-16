import algosdk from "algosdk";
import type { Invariant, ScenarioContext, TestFixture } from "../../core/types.js";
import { EvidenceCollector } from "../../util/evidence.js";
import { makeResult } from "../shared.js";
import { AlgorandChainAdapter } from "../../chain-adapters/algorand/algorand-adapter.js";
import { isOptedIntoAsset } from "../../chain-adapters/algorand/asa.js";

/**
 * A2 — ASA opt-in precheck (stretch).
 *
 * Algorand requires an account to explicitly opt in before it can receive a
 * given ASA; a transfer to a non-opted-in account fails on-chain. A
 * facilitator that only discovers this at broadcast time burns a real
 * transaction fee on a doomed settlement. A2 asserts the facilitator's
 * /verify step (which runs a full algod simulation — see DECISIONS.md D7,
 * `simulateTransactionGroup`) catches this *before* /settle would ever
 * submit, by targeting a freshly generated account that has deliberately
 * never opted into the test asset.
 */
export function createA2Invariant(fixture: TestFixture): Invariant {
  return {
    id: "A2",
    name: "ASA opt-in precheck",
    category: "algorand",
    source: "Algorand ASA opt-in requirement (protocol primitive); brief §4 — early detection vs. wasted on-chain fees",
    async run(ctx: ScenarioContext) {
      const start = Date.now();
      const evidence = new EvidenceCollector();
      const adapter = ctx.chain as AlgorandChainAdapter;
      const algod = adapter.getAlgodClient();

      const neverOptedIn = algosdk.generateAccount();
      const optedIn = await isOptedIntoAsset(algod, neverOptedIn.addr.toString(), fixture.asset);
      evidence.record("opt-in status of freshly generated, never-funded account", undefined, {
        address: neverOptedIn.addr.toString(),
        optedIntoAsset: optedIn,
      });

      const payment = await ctx.chain.buildPayment({
        from: fixture.clientAccount,
        to: neverOptedIn.addr.toString(),
        amount: fixture.amount,
        asset: fixture.asset,
        facilitatorFeeAddress: fixture.facilitatorFeeAddress,
        resource: fixture.resource,
      });

      const verifyResult = await ctx.facilitator.verify(payment);
      evidence.record("verify against a non-opted-in recipient", payment, verifyResult);

      const caughtEarly = !verifyResult.isValid;
      const passed = !optedIn && caughtEarly;

      const summary = optedIn
        ? "the generated account was unexpectedly already opted in — sub-case did not exercise the intended condition"
        : caughtEarly
          ? `verify correctly rejected before settlement would have burned a fee (${verifyResult.invalidReason ?? "no reason given"})`
          : "verify APPROVED a payment to a non-opted-in recipient — this would fail on-chain and waste a real settlement attempt";

      return makeResult("A2", "ASA opt-in precheck", "algorand", start, passed, summary, {
        recipient: neverOptedIn.addr.toString(),
        optedIn,
        evidence: evidence.all(),
      });
    },
  };
}
