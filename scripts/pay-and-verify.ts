/**
 * Example customer client for Ward's paid verification service
 * (src/server): pays $1.00 USDC via x402, then gets back a real adversarial
 * pass/fail report for the facilitator URL it submits. Standard x402 client
 * pattern — see skills/algorand-x402-typescript/references/create-typescript-x402-client.md.
 *
 * Usage: npx tsx scripts/pay-and-verify.ts <facilitatorUrl>
 *   npx tsx scripts/pay-and-verify.ts http://localhost:4022
 */
import "dotenv/config";
import algosdk from "algosdk";
import { AlgorandClient } from "@algorandfoundation/algokit-utils";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import { ExactAvmScheme } from "@x402/avm/exact/client";

const SERVER_URL = process.env.WARD_SERVICE_URL ?? "http://localhost:4030";
const facilitatorUrl = process.argv[2];

if (!facilitatorUrl) {
  console.error("Usage: npx tsx scripts/pay-and-verify.ts <facilitatorUrl>");
  process.exit(1);
}

const secretKey = Buffer.from(requireEnv("WARD_CLIENT_PRIVATE_KEY"), "base64");
const address = algosdk.encodeAddress(secretKey.subarray(32));

const signer = {
  address,
  signTransactions: async (txns: Uint8Array[], indexesToSign?: number[]) => {
    return txns.map((txn, i) => {
      if (indexesToSign && !indexesToSign.includes(i)) return null;
      const decoded = algosdk.decodeUnsignedTransaction(txn);
      return algosdk.signTransaction(decoded, secretKey).blob;
    });
  },
};

// @x402/avm's ExactAvmScheme uses algokit-utils' TransactionComposer under the
// hood, whose default transaction validity window (~10 rounds, ~30-40s on
// TestNet) is tight enough that a real HTTP hop through a resource server's
// payment middleware (verify() then settle(), each a separate facilitator
// round trip) can outrun it before the facilitator ever submits — observed
// directly while building the paid endpoint. Passing a pre-configured
// AlgorandClient with a wider window fixes it at the source.
const algorandClient = AlgorandClient.testNet().setDefaultValidityWindow(1000);

const client = new x402Client();
client.register("algorand:*", new ExactAvmScheme(signer, { algorandClient }));
client.onBeforePaymentCreation(async (ctx) => {
  console.log("onBeforePaymentCreation:", JSON.stringify(ctx.selectedRequirements));
});
client.onAfterPaymentCreation(async () => console.log("onAfterPaymentCreation: signed OK"));
client.onPaymentCreationFailure(async ({ error }) => console.log("onPaymentCreationFailure:", error));
const fetchWithPay = wrapFetchWithPayment(fetch, client);

async function main() {
  console.log(`Paying for a verification check against ${facilitatorUrl} as ${address}...`);
  const res = await fetchWithPay(`${SERVER_URL}/verify-facilitator`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ facilitatorUrl }),
  });

  const paymentReceipt = res.headers.get("PAYMENT-RESPONSE");
  if (paymentReceipt) {
    console.log("Payment settled:", Buffer.from(paymentReceipt, "base64").toString("utf-8"));
  }

  const body = await res.json();
  if (!res.ok) {
    console.error(`Server returned ${res.status}:`, body);
    console.error("headers:", JSON.stringify([...res.headers.entries()]));
    process.exit(1);
  }

  const { summary, results } = body.report;
  console.log(`\n${summary.passed}/${summary.total} invariants passed for ${facilitatorUrl}`);
  for (const r of results) {
    console.log(`  ${r.passed ? "PASS" : "FAIL"}  ${r.id}  ${r.name}`);
  }
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
