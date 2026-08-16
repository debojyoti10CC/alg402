import { ExactAvmScheme } from "@x402/avm/exact/client";
import { toClientAvmSigner } from "@x402/avm";
import type { PaymentParams, PaymentPayload, PaymentRequirements, SignedPayload } from "../../core/types.js";
import { ALGORAND_TESTNET_CAIP2, ALGORAND_MAINNET_CAIP2 } from "./network-ids.js";

/**
 * Builds a real, correctly-signed x402 payload using the actual published
 * @x402/avm client scheme — not a hand-rolled reimplementation — so the
 * "happy path" Ward starts from is byte-identical to what a real x402
 * client on Algorand would produce. Tampering happens afterward, in
 * atomic-group.ts, against this real output.
 */
export async function buildSignedPayload(params: PaymentParams): Promise<SignedPayload> {
  const clientSecretKey = requireBase64Key(params.from.signer, params.from.address);
  const signer = toClientAvmSigner(clientSecretKey);
  if (signer.address !== params.from.address) {
    throw new Error(
      `AccountHandle.address (${params.from.address}) does not match the address derived from its signer key (${signer.address})`,
    );
  }

  const requirements: PaymentRequirements = {
    scheme: "exact",
    network: networkFromEnv(),
    asset: params.asset,
    amount: params.amount.toString(),
    payTo: params.to,
    maxTimeoutSeconds: params.maxTimeoutSeconds ?? 60,
    extra: params.facilitatorFeeAddress ? { feePayer: params.facilitatorFeeAddress } : {},
  };

  const scheme = new ExactAvmScheme(signer);
  // @x402/core's PaymentRequirements types `network` as a `${string}:${string}` template
  // literal; Ward's own type keeps it a plain string so adversarial cases can assign
  // deliberately malformed values elsewhere. This boundary cast is where that trade-off lives.
  const result = await scheme.createPaymentPayload(2, requirements as Parameters<typeof scheme.createPaymentPayload>[1]);

  const paymentPayload: PaymentPayload = {
    x402Version: result.x402Version,
    accepted: requirements,
    payload: result.payload as unknown as PaymentPayload["payload"],
    resource: params.resource ? { url: params.resource, description: params.description } : undefined,
  };

  return { paymentPayload, paymentRequirements: requirements };
}

function requireBase64Key(signer: unknown, address: string): string {
  if (typeof signer !== "string" || signer.length === 0) {
    throw new Error(`AccountHandle for ${address} must carry its base64 algosdk secret key as \`signer\``);
  }
  return signer;
}

/** Reads WARD_NETWORK lazily (avoids importing util/config into a chain adapter, keeping the layering one-directional). */
function networkFromEnv(): `${string}:${string}` {
  return process.env.WARD_NETWORK === "mainnet" ? ALGORAND_MAINNET_CAIP2 : ALGORAND_TESTNET_CAIP2;
}
