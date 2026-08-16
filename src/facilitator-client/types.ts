import type { PaymentPayload, PaymentRequirements } from "../core/types.js";

/** Real POST /verify and POST /settle body shape (matches @x402/core's VerifyRequest/SettleRequest). */
export interface FacilitatorRequestBody {
  x402Version: number;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}
