import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

export interface WardConfig {
  facilitatorUrl: string;
  algodServer: string;
  algodToken: string;
  network: "testnet" | "mainnet";
  usdcAssetId: string;
  /** Base64-encoded 64-byte algosdk secret key for Ward's own test client account. */
  clientPrivateKey: string;
  /** Address Ward's test payments are sent to (a seller/resource-owner stand-in). */
  payToAddress: string;
  payToPrivateKey?: string;
}

/**
 * `overrides` lets a caller replace individual fields after the env-derived
 * defaults are resolved — e.g. the paid verification server substitutes
 * `facilitatorUrl` per-request (a customer's own facilitator) instead of the
 * single facilitator the CLI's `.env` points at. The CLI itself never passes
 * overrides, so its behavior is unchanged.
 */
export function loadConfig(overrides: Partial<WardConfig> = {}): WardConfig {
  const network = (optional("WARD_NETWORK", "testnet") as "testnet" | "mainnet");
  return {
    facilitatorUrl: optional("FACILITATOR_URL", "http://localhost:4022"),
    algodServer: optional(
      "ALGOD_TESTNET_URL",
      network === "testnet" ? "https://testnet-api.algonode.cloud" : "https://mainnet-api.algonode.cloud",
    ),
    algodToken: optional("ALGOD_TOKEN", ""),
    network,
    usdcAssetId: optional("USDC_ASSET_ID", "10458941"),
    clientPrivateKey: required("WARD_CLIENT_PRIVATE_KEY"),
    payToAddress: required("WARD_PAYTO_ADDRESS"),
    payToPrivateKey: process.env.WARD_PAYTO_PRIVATE_KEY,
    ...overrides,
  };
}
