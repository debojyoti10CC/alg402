import algosdk from "algosdk";

/**
 * Rekeys `address` to `newAuthAddress` on-chain. Used by A3 to move an
 * account's real spending authority mid-flow and check whether the
 * facilitator's settle-time verification reflects the account's *current*
 * auth-addr rather than a stale earlier check (see DECISIONS.md D7 #4).
 */
export async function rekeyAccount(
  algod: algosdk.Algodv2,
  address: string,
  currentSecretKey: Uint8Array,
  newAuthAddress: string,
): Promise<string> {
  const suggestedParams = await algod.getTransactionParams().do();
  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    sender: address,
    receiver: address,
    amount: 0,
    rekeyTo: newAuthAddress,
    suggestedParams,
  });
  const signed = txn.signTxn(currentSecretKey);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 10);
  return txid;
}

export async function getAuthAddr(algod: algosdk.Algodv2, address: string): Promise<string | undefined> {
  const info = await algod.accountInformation(address).do();
  return info.authAddr?.toString();
}
