/**
 * Core, chain-agnostic contracts. `invariants/universal/*` may only ever import
 * from this file (plus registry/runner) — never from `chain-adapters/algorand/*`
 * directly. See DECISIONS.md D2/D3 for where the concrete Algorand shapes below
 * (PaymentPayload, PaymentRequirements) come from.
 */

export type InvariantCategory = "universal" | "algorand";

export interface InvariantResult {
  id: string;
  name: string;
  category: InvariantCategory;
  passed: boolean;
  evidenceSummary: string;
  evidence: unknown;
  durationMs: number;
  timestamp: string;
}

export interface ScenarioContext {
  facilitator: FacilitatorClient;
  chain: ChainAdapter;
  logger: Logger;
}

export interface Invariant {
  id: string;
  name: string;
  category: InvariantCategory;
  source: string;
  run: (ctx: ScenarioContext) => Promise<InvariantResult>;
}

export interface Logger {
  debug(msg: string, meta?: unknown): void;
  info(msg: string, meta?: unknown): void;
  warn(msg: string, meta?: unknown): void;
  error(msg: string, meta?: unknown): void;
}

// ---------------------------------------------------------------------------
// x402 v2 + Algorand "exact" scheme wire shapes. These mirror the *installed*
// @x402/core and @x402/avm package types exactly (read from their compiled
// .d.mts), not the (looser, occasionally stale) skill reference docs — see
// DECISIONS.md D3/D7 for how and why these differ from the docs.
// ---------------------------------------------------------------------------

/** CAIP-2 network identifier, e.g. ALGORAND_TESTNET_CAIP2. Kept as a plain string (rather than the installed package's `${string}:${string}` template type) since Ward deliberately constructs malformed/mismatched network values for adversarial test cases. */
export type Network = string;

/**
 * `extra.feePayer`, when present, is the Algorand address the facilitator
 * will co-sign a self-payment leg for (the gasless/sponsored-fee path). Its
 * absence means the client pays their own fee and the group is a single
 * transaction. See DECISIONS.md D7 #2 for the real group layout.
 */
export interface PaymentRequirements {
  scheme: "exact";
  network: Network;
  /** ASA ID as a string (the real client scheme always treats payment as an ASA transfer). */
  asset: string;
  /** Atomic units, as a string. */
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  extra: Record<string, unknown> & { feePayer?: string };
}

export interface ResourceInfo {
  url: string;
  description?: string;
  mimeType?: string;
  serviceName?: string;
  tags?: string[];
  iconUrl?: string;
}

export interface PaymentRequired {
  x402Version: number;
  error?: string;
  resource: ResourceInfo;
  accepts: PaymentRequirements[];
  extensions?: Record<string, unknown>;
}

export interface AvmPaymentPayloadBody {
  /** Base64-encoded msgpack transaction bytes, in Algorand atomic-group order. */
  paymentGroup: string[];
  /** Index of the client's signed payment transaction within paymentGroup. */
  paymentIndex: number;
}

export interface PaymentPayload {
  x402Version: number;
  resource?: ResourceInfo;
  /** The requirements the client believed it was accepting when it signed. */
  accepted: PaymentRequirements;
  payload: AvmPaymentPayloadBody;
  extensions?: Record<string, unknown>;
}

/**
 * The real POST /verify and POST /settle body shape is
 * `{ x402Version, paymentPayload, paymentRequirements }` — note that
 * `paymentRequirements` here is a *separate* field from
 * `paymentPayload.accepted`. The facilitator enforces amount/receiver/asset
 * against this outer `paymentRequirements`, not against `payload.accepted` —
 * which is exactly the seam U1 exploits: same signed transaction bytes, a
 * different declared `paymentRequirements` sent alongside them at /settle
 * time. Keeping the two fields independently mutable here (rather than
 * collapsing them) is what makes that attack expressible.
 */
export interface SignedPayload {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
  extensions?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface SettleResponse {
  success: boolean;
  errorReason?: string;
  errorMessage?: string;
  payer?: string;
  /** The settled transaction id, when known — empty string on failure. */
  transaction: string;
  network: Network;
  amount?: string;
  extensions?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

export interface SupportedKind {
  x402Version: number;
  scheme: string;
  network: Network;
  extra?: Record<string, unknown>;
}

export interface SupportedResponse {
  kinds: SupportedKind[];
  extensions: string[];
  signers: Record<string, string[]>;
}

export interface FacilitatorClient {
  verify(payload: SignedPayload): Promise<VerifyResponse>;
  settle(payload: SignedPayload): Promise<SettleResponse>;
  supported(): Promise<SupportedResponse>;
}

// ---------------------------------------------------------------------------
// Chain adapter contract
// ---------------------------------------------------------------------------

export interface AccountHandle {
  address: string;
  /** Opaque, chain-specific secret material (e.g. an algosdk secretKey). */
  signer: unknown;
}

export interface PaymentParams {
  from: AccountHandle;
  to: string;
  amount: bigint;
  /** ASA ID as a string (e.g. testnet USDC "10458941"). */
  asset: string;
  /** When set, requests the sponsored-fee (2-txn) group; omit for a self-paid single-txn group. */
  facilitatorFeeAddress?: string;
  resource?: string;
  description?: string;
  maxTimeoutSeconds?: number;
}

/**
 * Mutations target either the outer, independently-sent `paymentRequirements`
 * (the U1 seam — see SignedPayload's doc comment) or the unsigned fee-payer
 * leg inside `paymentPayload.payload.paymentGroup` (the A1 seam — see
 * DECISIONS.md D7 #3 for exactly which facilitator check each one probes).
 */
export type PayloadMutation =
  | { kind: "network"; value: Network }
  | { kind: "asset"; value: string }
  | { kind: "recipient"; value: string }
  | { kind: "amount"; value: string }
  | { kind: "feePayerAmount"; value: bigint }
  | { kind: "feePayerReceiver"; value: string }
  | { kind: "feePayerCloseRemainderTo"; value: string }
  | { kind: "feePayerRekeyTo"; value: string }
  | { kind: "feePayerFee"; value: bigint }
  | { kind: "spliceExtraTxn" }
  | { kind: "custom"; label: string; apply: (payload: SignedPayload) => SignedPayload };

export interface TxConfirmation {
  txId: string;
  confirmedRound: number;
  raw: unknown;
}

export interface ChainAdapter {
  chainId: string;
  fundAccount(address: string, amount: bigint): Promise<void>;
  buildPayment(params: PaymentParams): Promise<SignedPayload>;
  tamperPayload(payload: SignedPayload, mutation: PayloadMutation): SignedPayload;
  getExplorerLink(txId: string): string;
  waitForConfirmation(txId: string): Promise<TxConfirmation>;
}

/**
 * Plain test-fixture data (funded client account, receiving address, asset,
 * amount) that every invariant needs to build payments from. Kept as a
 * chain-agnostic bag of primitives — not a ChainAdapter method — so
 * `invariants/universal/*` can accept it via factory-function closure
 * without importing anything Algorand-specific; the CLI layer is the only
 * place that populates it with real (currently Algorand) values.
 */
export interface TestFixture {
  clientAccount: AccountHandle;
  payToAddress: string;
  asset: string;
  amount: bigint;
  facilitatorFeeAddress?: string;
  resource: string;
  /** A syntactically valid network identifier known to differ from the one under test — e.g. mainnet's CAIP-2 id when testing testnet. Used by U1's network-mutation sub-case. */
  alternateNetwork: string;
  /** A syntactically valid but unregistered asset/network the facilitator does not support — used by U4. */
  unsupportedAsset: string;
  unsupportedNetwork: string;
}
