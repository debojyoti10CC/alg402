import algosdk from "algosdk";
import type { AccountHandle, Invariant, ScenarioContext, TestFixture } from "../../core/types.js";
import { EvidenceCollector } from "../../util/evidence.js";
import { makeResult } from "../shared.js";
import { AlgorandChainAdapter } from "../../chain-adapters/algorand/algorand-adapter.js";
import { rekeyAccount } from "../../chain-adapters/algorand/rekey.js";
import { optInToAsset } from "../../chain-adapters/algorand/asa.js";

const REKEY_TEST_FUNDING = 500_000n; // microAlgo — min-balance (incl. ASA opt-in) + a handful of fees

/**
 * A3 — rekey authorization (stretch).
 *
 * Builds a payment signed under an account's *original* Ed25519 key, then
 * rekeys that account on-chain to a fresh authority mid-flow, then submits
 * the still-old-key-signed payload to /settle. A correct facilitator must
 * reject it: the signature no longer reflects the account's current
 * spending authority. See DECISIONS.md D7 #4 — the facilitator's `settle()`
 * always re-runs `verify()` from scratch (never trusts an earlier /verify
 * decision), and that fresh verify's `simulateTransactionGroup` step calls
 * real algod simulation, which enforces actual on-chain auth-addr rules
 * even though the facilitator's own local `ed25519Verifier` pre-check
 * only checks the address's inherent key. A PASS here is a genuinely useful
 * result either way — it's evidence the net behavior is correct, not proof
 * we assumed it would be.
 *
 * Runs against a disposable throwaway account (funded via
 * ChainAdapter.fundAccount), never the shared fixture client account,
 * because a rekey that fails to un-rekey would strand that account for
 * every other invariant. The rekey is always reverted in a `finally` block.
 */
export function createA3Invariant(_fixture: TestFixture): Invariant {
  return {
    id: "A3",
    name: "rekey authorization",
    category: "algorand",
    source: "Algorand rekeying (protocol primitive); brief §4 — settle() must not trust spending authority captured before a mid-flow rekey",
    async run(ctx: ScenarioContext) {
      const start = Date.now();
      const evidence = new EvidenceCollector();
      const adapter = ctx.chain as AlgorandChainAdapter;
      const algod = adapter.getAlgodClient();

      const throwaway = algosdk.generateAccount();
      const newAuthKeypair = algosdk.generateAccount();
      const throwawayHandle: AccountHandle = {
        address: throwaway.addr.toString(),
        signer: Buffer.from(throwaway.sk).toString("base64"),
      };

      try {
        await ctx.chain.fundAccount(throwaway.addr.toString(), REKEY_TEST_FUNDING);
      } catch (err) {
        return makeResult(
          "A3",
          "rekey authorization",
          "algorand",
          start,
          false,
          `Could not fund a disposable test account (WARD_FUNDER_PRIVATE_KEY not configured?): ${err instanceof Error ? err.message : String(err)}`,
          { evidence: evidence.all() },
        );
      }

      try {
        await optInToAsset(algod, throwaway.addr.toString(), throwaway.sk, _fixture.asset);

        const payment = await ctx.chain.buildPayment({
          from: throwawayHandle,
          to: _fixture.payToAddress,
          amount: 0n, // proving spending authority is what's under test, not moving real value
          asset: _fixture.asset,
          facilitatorFeeAddress: _fixture.facilitatorFeeAddress,
          resource: _fixture.resource,
        });
        evidence.record("payment signed under the ORIGINAL key, before rekey", payment, undefined);

        const rekeyTxId = await rekeyAccount(algod, throwaway.addr.toString(), throwaway.sk, newAuthKeypair.addr.toString());
        evidence.record("on-chain rekey (mid-flow)", { newAuthAddress: newAuthKeypair.addr.toString() }, { rekeyTxId });

        const settleResult = await ctx.facilitator.settle(payment);
        evidence.record("settle of the pre-rekey-signed payload, submitted AFTER the rekey", payment, settleResult);

        const rejected = !settleResult.success;
        const summary = rejected
          ? `settle correctly rejected the stale pre-rekey authorization (${settleResult.errorReason ?? "no reason given"})`
          : `settle SUCCEEDED (tx ${settleResult.transaction}) using a signature from a key that was no longer the account's spending authority`;

        return makeResult("A3", "rekey authorization", "algorand", start, rejected, summary, {
          throwawayAddress: throwaway.addr.toString(),
          evidence: evidence.all(),
        });
      } finally {
        try {
          await rekeyAccount(algod, throwaway.addr.toString(), newAuthKeypair.sk, throwaway.addr.toString());
        } catch (err) {
          ctx.logger.warn(
            `A3: failed to revert rekey on disposable account ${throwaway.addr.toString()} — it is now permanently controlled by a discarded key`,
            err,
          );
        }
      }
    },
  };
}
