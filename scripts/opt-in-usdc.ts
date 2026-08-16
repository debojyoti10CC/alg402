/**
 * Opts WARD_CLIENT and (if its private key is set) WARD_PAYTO into the
 * configured TestNet USDC ASA, since the facilitator's own /verify simulation
 * rejects payments from/to accounts that aren't opted in. Manual step §4 in
 * the README, automated here since both private keys already live in .env.
 *
 * Usage: npx tsx scripts/opt-in-usdc.ts
 */
import algosdk from "algosdk";
import { loadConfig } from "../src/util/config.js";

const MIN_ALGO_FOR_OPTIN = 300_000; // opt-in min-balance bump (100k) + a few txn fees of headroom

async function ensureFunded(algod: algosdk.Algodv2, label: string, address: string, funderSecretKey?: Uint8Array) {
  const accountInfo = await algod.accountInformation(address).do();
  if (Number(accountInfo.amount) >= MIN_ALGO_FOR_OPTIN) return;
  if (!funderSecretKey) {
    throw new Error(
      `${label} (${address}) has too little ALGO to opt in and WARD_FUNDER_PRIVATE_KEY isn't set to top it up.`,
    );
  }
  const funderAddr = algosdk.encodeAddress(funderSecretKey.subarray(32));
  const suggestedParams = await algod.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: funderAddr,
    receiver: address,
    amount: MIN_ALGO_FOR_OPTIN,
    suggestedParams,
  });
  const signed = txn.signTxn(funderSecretKey);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 10);
  console.log(`${label} (${address}) funded with ${MIN_ALGO_FOR_OPTIN / 1e6} ALGO for the opt-in fee — txn ${txid}`);
}

async function optIn(algod: algosdk.Algodv2, label: string, secretKeyBase64: string, assetId: number, funderSecretKey?: Uint8Array) {
  const secretKey = Buffer.from(secretKeyBase64, "base64");
  const address = algosdk.encodeAddress(secretKey.subarray(32));

  await ensureFunded(algod, label, address, funderSecretKey);

  const accountInfo = await algod.accountInformation(address).do();
  const alreadyOptedIn = accountInfo.assets?.some((a) => Number(a.assetId) === assetId);
  if (alreadyOptedIn) {
    console.log(`${label} (${address}) already opted into asset ${assetId}`);
    return;
  }

  const suggestedParams = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address,
    receiver: address,
    amount: 0,
    assetIndex: assetId,
    suggestedParams,
  });
  const signed = txn.signTxn(secretKey);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 10);
  console.log(`${label} (${address}) opted into asset ${assetId} — txn ${txid}`);
}

async function main() {
  const config = loadConfig();
  const algod = new algosdk.Algodv2(config.algodToken, config.algodServer, "");
  const assetId = Number(config.usdcAssetId);
  const funderSecretKey = process.env.WARD_FUNDER_PRIVATE_KEY
    ? Buffer.from(process.env.WARD_FUNDER_PRIVATE_KEY, "base64")
    : undefined;

  await optIn(algod, "WARD_CLIENT", config.clientPrivateKey, assetId, funderSecretKey);

  if (config.payToPrivateKey) {
    await optIn(algod, "WARD_PAYTO", config.payToPrivateKey, assetId, funderSecretKey);
  } else {
    console.log(`WARD_PAYTO_PRIVATE_KEY not set — opt in ${config.payToAddress} manually if it needs to hold USDC.`);
  }

  console.log(`\nNow fund both addresses with TestNet USDC from https://asset-dispenser.testnet.algorand.network/`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
