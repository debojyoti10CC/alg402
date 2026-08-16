import algosdk from "algosdk";
import type { ChainAdapter, PaymentParams, PayloadMutation, SignedPayload, TxConfirmation } from "../../core/types.js";
import { buildSignedPayload } from "./tx-builder.js";
import { tamperPayload as applyTamper } from "./atomic-group.js";

export interface AlgorandAdapterOptions {
  algodServer: string;
  algodToken?: string;
  network: "testnet" | "mainnet";
  /** Base64 algosdk secret key for the account that funds test accounts with native ALGO. Required only for fundAccount(). */
  funderSecretKey?: string;
}

export class AlgorandChainAdapter implements ChainAdapter {
  readonly chainId = "algorand";
  private readonly algod: algosdk.Algodv2;
  private readonly network: "testnet" | "mainnet";
  private readonly funderSecretKey?: Uint8Array;

  constructor(options: AlgorandAdapterOptions) {
    this.algod = new algosdk.Algodv2(options.algodToken ?? "", options.algodServer, "");
    this.network = options.network;
    this.funderSecretKey = options.funderSecretKey
      ? Buffer.from(options.funderSecretKey, "base64")
      : undefined;
  }

  getAlgodClient(): algosdk.Algodv2 {
    return this.algod;
  }

  async fundAccount(address: string, amount: bigint): Promise<void> {
    if (!this.funderSecretKey) {
      throw new Error(
        "fundAccount() requires WARD_FUNDER_PRIVATE_KEY to be set to a funded TestNet account's base64 secret key. " +
          "Fund that account manually via https://bank.testnet.algorand.network/ first — see README.",
      );
    }
    const suggestedParams = await this.algod.getTransactionParams().do();
    const funderAddress = algosdk.encodeAddress(this.funderSecretKey.slice(32));
    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      sender: funderAddress,
      receiver: address,
      amount,
      suggestedParams,
    });
    const signed = txn.signTxn(this.funderSecretKey);
    const { txid } = await this.algod.sendRawTransaction(signed).do();
    await algosdk.waitForConfirmation(this.algod, txid, 10);
  }

  async buildPayment(params: PaymentParams): Promise<SignedPayload> {
    return buildSignedPayload(params);
  }

  tamperPayload(payload: SignedPayload, mutation: PayloadMutation): SignedPayload {
    return applyTamper(payload, mutation);
  }

  getExplorerLink(txId: string): string {
    return `https://lora.algokit.io/${this.network}/transaction/${txId}`;
  }

  async waitForConfirmation(txId: string): Promise<TxConfirmation> {
    const raw = await algosdk.waitForConfirmation(this.algod, txId, 10);
    return {
      txId,
      confirmedRound: Number(raw.confirmedRound ?? 0n),
      raw,
    };
  }
}
