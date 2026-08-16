import type { Invariant, ScenarioContext, TestFixture } from "../../core/types.js";
import { EvidenceCollector } from "../../util/evidence.js";
import { makeResult } from "../shared.js";

/**
 * U4 — allowlist enforcement.
 *
 * Calls GET /supported, then attempts settlement for a network and an asset
 * that are not listed. A correct facilitator must reject both — silently
 * accepting an unadvertised asset/network is exactly the kind of scope creep
 * the USENIX study flagged as letting sellers or attackers redirect value
 * the client never agreed the facilitator would move.
 */
export function createU4Invariant(fixture: TestFixture): Invariant {
  return {
    id: "U4",
    name: "allowlist enforcement",
    category: "universal",
    source: "x402 protocol spec — GET /supported must be authoritative over what /settle will actually move",
    async run(ctx: ScenarioContext) {
      const start = Date.now();
      const evidence = new EvidenceCollector();

      const supported = await ctx.facilitator.supported();
      evidence.record("GET /supported", undefined, supported);
      const listedNetworks = new Set((supported.kinds ?? []).map((k) => k.network));

      const basePayment = await ctx.chain.buildPayment({
        from: fixture.clientAccount,
        to: fixture.payToAddress,
        amount: fixture.amount,
        asset: fixture.asset,
        facilitatorFeeAddress: fixture.facilitatorFeeAddress,
        resource: fixture.resource,
      });

      const networkCasePayload = ctx.chain.tamperPayload(basePayment, {
        kind: "network",
        value: fixture.unsupportedNetwork,
      });
      const networkSettle = await ctx.facilitator.settle(networkCasePayload);
      evidence.record("settle against unsupported network", networkCasePayload, networkSettle);
      const networkRejected = !networkSettle.success;

      const assetPayment = await ctx.chain.buildPayment({
        from: fixture.clientAccount,
        to: fixture.payToAddress,
        amount: fixture.amount,
        asset: fixture.unsupportedAsset,
        facilitatorFeeAddress: fixture.facilitatorFeeAddress,
        resource: fixture.resource,
      });
      const assetSettle = await ctx.facilitator.settle(assetPayment);
      evidence.record("settle against unsupported asset", assetPayment, assetSettle);
      const assetRejected = !assetSettle.success;

      const passed = networkRejected && assetRejected;
      const summary =
        `unsupported network (listed=${listedNetworks.has(fixture.unsupportedNetwork)}): ` +
        `${networkRejected ? "rejected" : "SETTLED — VIOLATION"}; ` +
        `unsupported asset: ${assetRejected ? "rejected" : "SETTLED — VIOLATION"}`;

      return makeResult("U4", "allowlist enforcement", "universal", start, passed, summary, {
        listedNetworks: [...listedNetworks],
        networkRejected,
        assetRejected,
        evidence: evidence.all(),
      });
    },
  };
}
