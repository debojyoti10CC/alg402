import {
  Transaction,
  decodeTransaction as decodeTxnBytes,
  encodeTransactionRaw,
} from "@algorandfoundation/algokit-utils/transact";
import { Address } from "@algorandfoundation/algokit-utils/common";
import { encodeTransaction as bytesToBase64, decodeTransaction as base64ToBytes } from "@x402/avm";
import type { PayloadMutation, SignedPayload } from "../../core/types.js";

/**
 * Applies a PayloadMutation to a SignedPayload built by tx-builder.ts,
 * simulating what a malicious intermediary could do to the wire payload
 * after the client has signed their own leg but before the facilitator
 * sees it. See DECISIONS.md D7 #3 for which facilitator check each
 * fee-payer mutation is designed to probe.
 */
export function tamperPayload(payload: SignedPayload, mutation: PayloadMutation): SignedPayload {
  switch (mutation.kind) {
    case "network":
      return withRequirements(payload, { network: mutation.value });
    case "asset":
      return withRequirements(payload, { asset: mutation.value });
    case "recipient":
      return withRequirements(payload, { payTo: mutation.value });
    case "amount":
      return withRequirements(payload, { amount: mutation.value });
    case "feePayerAmount":
      return withFeePayerLeg(payload, (txn) => new Transaction({
        ...txn,
        payment: { ...txn.payment!, amount: mutation.value },
      }));
    case "feePayerReceiver":
      return withFeePayerLeg(payload, (txn) => new Transaction({
        ...txn,
        payment: { ...txn.payment!, receiver: Address.fromString(mutation.value) },
      }));
    case "feePayerCloseRemainderTo":
      return withFeePayerLeg(payload, (txn) => new Transaction({
        ...txn,
        payment: { ...txn.payment!, closeRemainderTo: Address.fromString(mutation.value) },
      }));
    case "feePayerRekeyTo":
      return withFeePayerLeg(payload, (txn) => new Transaction({
        ...txn,
        rekeyTo: Address.fromString(mutation.value),
      }));
    case "feePayerFee":
      return withFeePayerLeg(payload, (txn) => new Transaction({ ...txn, fee: mutation.value }));
    case "spliceExtraTxn":
      return spliceExtraTransaction(payload);
    case "custom":
      return mutation.apply(payload);
  }
}

function withRequirements(payload: SignedPayload, patch: Partial<SignedPayload["paymentRequirements"]>): SignedPayload {
  return {
    ...payload,
    paymentRequirements: { ...payload.paymentRequirements, ...patch },
  };
}

/**
 * The unsigned fee-payer leg is whichever paymentGroup entry is NOT the
 * (signed) paymentIndex — see DECISIONS.md D7 #2 for why it's index 0 in
 * practice, but this is written to not assume group layout beyond "exactly
 * one other transaction" so it still fails loudly on an unexpected shape
 * rather than silently mutating the wrong leg.
 */
function feePayerIndex(paymentGroup: string[], paymentIndex: number): number {
  if (paymentGroup.length !== 2) {
    throw new Error(
      `Fee-payer-leg mutations require a 2-transaction sponsored group; got ${paymentGroup.length} transactions. ` +
        `Build the payload with facilitatorFeeAddress set to exercise the sponsored-fee path.`,
    );
  }
  return paymentIndex === 0 ? 1 : 0;
}

function withFeePayerLeg(payload: SignedPayload, mutate: (txn: Transaction) => Transaction): SignedPayload {
  const { paymentGroup, paymentIndex } = payload.paymentPayload.payload;
  const idx = feePayerIndex(paymentGroup, paymentIndex);
  const txn = decodeTxnBytes(base64ToBytes(paymentGroup[idx]!));
  const mutated = mutate(txn);
  const nextGroup = [...paymentGroup];
  nextGroup[idx] = bytesToBase64(encodeTransactionRaw(mutated));
  return {
    ...payload,
    paymentPayload: {
      ...payload.paymentPayload,
      payload: { ...payload.paymentPayload.payload, paymentGroup: nextGroup },
    },
  };
}

/**
 * Splices a bogus extra transaction into the authorized group without
 * recomputing a matching group ID, so it probes decodeTransactionGroup's
 * group-ID-consistency check rather than the fee-payer-specific checks.
 */
function spliceExtraTransaction(payload: SignedPayload): SignedPayload {
  const { paymentGroup, paymentIndex } = payload.paymentPayload.payload;
  const idx = feePayerIndex(paymentGroup, paymentIndex);
  const feePayerTxn = decodeTxnBytes(base64ToBytes(paymentGroup[idx]!));
  const senderAddr = feePayerTxn.sender;
  const bogus = new Transaction({
    ...feePayerTxn,
    payment: { receiver: senderAddr, amount: 0n },
    group: undefined,
  });
  const nextGroup = [...paymentGroup, bytesToBase64(encodeTransactionRaw(bogus))];
  return {
    ...payload,
    paymentPayload: {
      ...payload.paymentPayload,
      payload: { ...payload.paymentPayload.payload, paymentGroup: nextGroup },
    },
  };
}
