/**
 * Standalone one-shot payment: builds, verifies, and settles a single real
 * payment against the configured facilitator, then prints an explorer link.
 * This is the manual-verification step §2.1 requires before trusting any
 * invariant result — `ward init` also runs it, but it's kept runnable on
 * its own for re-checking a facilitator setup in isolation.
 *
 * Usage: npx tsx scripts/verify-manual-payment.ts
 */
import { buildScenario } from "../src/cli/setup.js";

async function main() {
  const { ctx, fixture } = buildScenario("debug");

  console.log(`Building a payment: ${fixture.clientAccount.address} -> ${fixture.payToAddress}, ${fixture.amount} of asset ${fixture.asset}`);
  const payment = await ctx.chain.buildPayment({
    from: fixture.clientAccount,
    to: fixture.payToAddress,
    amount: fixture.amount,
    asset: fixture.asset,
    facilitatorFeeAddress: fixture.facilitatorFeeAddress,
    resource: fixture.resource,
  });

  console.log("Calling /verify...");
  const verifyResult = await ctx.facilitator.verify(payment);
  console.log(JSON.stringify(verifyResult, null, 2));
  if (!verifyResult.isValid) {
    throw new Error(`Rejected at /verify: ${verifyResult.invalidReason} — ${verifyResult.invalidMessage}`);
  }

  console.log("Calling /settle...");
  const settleResult = await ctx.facilitator.settle(payment);
  console.log(JSON.stringify(settleResult, null, 2));
  if (!settleResult.success) {
    throw new Error(`Rejected at /settle: ${settleResult.errorReason} — ${settleResult.errorMessage}`);
  }

  console.log(`\nSettled. Confirming on-chain...`);
  await ctx.chain.waitForConfirmation(settleResult.transaction);
  console.log(`Confirmed: ${ctx.chain.getExplorerLink(settleResult.transaction)}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
