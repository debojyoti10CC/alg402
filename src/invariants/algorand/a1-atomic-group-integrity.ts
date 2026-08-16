import type { Invariant, PayloadMutation, ScenarioContext, TestFixture } from "../../core/types.js";
import { EvidenceCollector } from "../../util/evidence.js";
import { makeResult } from "../shared.js";

interface FeePayerSubCase {
  mutation: PayloadMutation;
  label: string;
  violationClass: string;
}

function subCases(_feePayerAddress: string): FeePayerSubCase[] {
  return [
    {
      mutation: { kind: "feePayerAmount", value: 1_000_000n },
      label: "fee-payer leg amount > 0 (drains value instead of a pure self-payment)",
      violationClass: "Asset Theft",
    },
    {
      mutation: { kind: "feePayerReceiver", value: REDIRECT_TARGET },
      label: "fee-payer leg receiver redirected away from self",
      violationClass: "Asset Theft",
    },
    {
      mutation: { kind: "feePayerCloseRemainderTo", value: REDIRECT_TARGET },
      label: "fee-payer leg closes remainder balance to a third party",
      violationClass: "Asset Theft",
    },
    {
      mutation: { kind: "feePayerRekeyTo", value: REDIRECT_TARGET },
      label: "fee-payer leg rekeys the facilitator's own account",
      violationClass: "Asset Theft / account takeover",
    },
    {
      mutation: { kind: "feePayerFee", value: 50_000_000n },
      label: "fee-payer leg fee inflated far past the reasonable cap",
      violationClass: "Gas Abuse",
    },
  ];
}

// A syntactically valid, clearly-third-party TestNet address used as the redirect target
// for tamper sub-cases. Any well-formed, non-facilitator address works — the check under
// test is "is this the sender itself", not "is this address special".
const REDIRECT_TARGET = "RDBSPBKPCH6JSJXSUXWSBWCRGPIVN4OUJXDXPGYIDTHRYRQGW56UMGJZCI";

/**
 * A1 — atomic group integrity (headline invariant).
 *
 * The facilitator's fee-abstraction flow builds a 2-transaction atomic
 * group: the client's signed payment (index 1) plus an *unsigned*
 * fee-payer self-payment (index 0) that only the facilitator signs, at
 * verify/settle time. Because that second leg is never signed by the
 * client, an attacker who intercepts the authorized payload before it
 * reaches the facilitator can rewrite it arbitrarily — inflate its amount,
 * redirect its receiver, attach a rekey or close-out, or inflate its fee —
 * while keeping the original `group` field intact so the (separate)
 * group-ID-consistency check doesn't catch it. A1 proves the facilitator's
 * own `verifyFeePayerTransaction` check catches each of these, using
 * /verify only (never /settle) for the malicious sub-cases — /verify signs
 * the fee-payer leg to run this exact check but never broadcasts, so a
 * bug here can't actually damage the facilitator's real key even though
 * this suite runs against a real, self-hosted instance. See DECISIONS.md
 * D2 and D7 #3 for how this maps onto the USENIX study's four violation
 * classes and exactly which facilitator code path each sub-case targets.
 */
export function createA1Invariant(fixture: TestFixture): Invariant {
  return {
    id: "A1",
    name: "atomic group integrity",
    category: "algorand",
    source:
      "Algorand atomic transaction groups (protocol primitive) + @x402/avm facilitator's verifyFeePayerTransaction; USENIX Security '26 study — Free Shopping, Asset Theft, Service Denial, Gas Abuse",
    async run(ctx: ScenarioContext) {
      const start = Date.now();
      const evidence = new EvidenceCollector();

      const supported = await ctx.facilitator.supported();
      // `signers` is keyed by CAIP-2 namespace wildcard (e.g. "algorand:*", "eip155:*",
      // "solana:*") across every chain the facilitator supports, not just Algorand — grabbing
      // the first value blindly (Object.values(...).flat()[0]) picks whichever chain happens
      // to be listed first, which is never guaranteed to be Algorand's own fee-payer.
      const feePayerAddress =
        fixture.facilitatorFeeAddress ?? supported.signers?.[`${ctx.chain.chainId}:*`]?.[0];
      evidence.record("GET /supported (discovering fee-payer address)", undefined, supported);

      if (!feePayerAddress) {
        return makeResult(
          "A1",
          "atomic group integrity",
          "algorand",
          start,
          false,
          "Facilitator advertises no signer addresses via /supported — cannot exercise the sponsored-fee atomic-group path at all.",
          { evidence: evidence.all() },
        );
      }

      // Baseline sanity: the happy-path sponsored group must actually settle for real,
      // otherwise a "the tamper cases were rejected" result would be meaningless — the
      // facilitator might simply reject everything on this path.
      const baseline = await ctx.chain.buildPayment({
        from: fixture.clientAccount,
        to: fixture.payToAddress,
        amount: fixture.amount,
        asset: fixture.asset,
        facilitatorFeeAddress: feePayerAddress,
        resource: fixture.resource,
      });
      const baselineSettle = await ctx.facilitator.settle(baseline);
      evidence.record("baseline sponsored-fee settle (sanity check)", baseline, baselineSettle);

      const cases = subCases(feePayerAddress);
      const subResults: Array<{ label: string; violationClass: string; ok: boolean; detail: string }> = [];

      for (const { mutation, label, violationClass } of cases) {
        const fresh = await ctx.chain.buildPayment({
          from: fixture.clientAccount,
          to: fixture.payToAddress,
          amount: fixture.amount,
          asset: fixture.asset,
          facilitatorFeeAddress: feePayerAddress,
          resource: fixture.resource,
        });
        const tampered = ctx.chain.tamperPayload(fresh, mutation);
        const verifyResult = await ctx.facilitator.verify(tampered);
        evidence.record(`verify — ${label}`, { original: fresh, tampered }, verifyResult);

        const rejected = !verifyResult.isValid;
        subResults.push({
          label,
          violationClass,
          ok: rejected,
          detail: rejected
            ? `rejected (${verifyResult.invalidReason ?? "no reason given"})`
            : `ACCEPTED — facilitator would have co-signed a tampered fee-payer transaction (${violationClass})`,
        });
      }

      const passed = baselineSettle.success && subResults.every((r) => r.ok);
      const summary = !baselineSettle.success
        ? `baseline sponsored-fee settlement failed (${baselineSettle.errorReason}) — cannot validate tamper resistance on a path that doesn't work`
        : subResults.map((r) => `${r.label}: ${r.ok ? "OK" : "VIOLATION"}`).join("; ");

      return makeResult("A1", "atomic group integrity", "algorand", start, passed, summary, {
        baselineTransaction: baselineSettle.transaction,
        subResults,
        evidence: evidence.all(),
      });
    },
  };
}
