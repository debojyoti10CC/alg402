import algosdk from "algosdk";

/** Whether `address` has opted into ASA `assetId` — used by A2 to distinguish "the facilitator caught it" from "it was never going to fail." */
export async function isOptedIntoAsset(algod: algosdk.Algodv2, address: string, assetId: string): Promise<boolean> {
  const info = await algod.accountAssetInformation(address, Number(assetId)).do().catch((err: unknown) => {
    if (err instanceof Error && /account asset info not found/i.test(err.message)) return null;
    throw err;
  });
  return info !== null;
}

export async function optInToAsset(algod: algosdk.Algodv2, address: string, secretKey: Uint8Array, assetId: string): Promise<string> {
  const suggestedParams = await algod.getTransactionParams().do();
  const txn = algosdk.makeAssetTransferTxnWithSuggestedParamsFromObject({
    sender: address,
    receiver: address,
    amount: 0,
    assetIndex: Number(assetId),
    suggestedParams,
  });
  const signed = txn.signTxn(secretKey);
  const { txid } = await algod.sendRawTransaction(signed).do();
  await algosdk.waitForConfirmation(algod, txid, 10);
  return txid;
}
