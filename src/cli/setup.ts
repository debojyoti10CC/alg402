import algosdk from "algosdk";
import { ALGORAND_MAINNET_CAIP2, ALGORAND_TESTNET_CAIP2 } from "../chain-adapters/algorand/network-ids.js";
import { loadConfig, type WardConfig } from "../util/config.js";
import { createLogger, type LogLevel } from "../util/logger.js";
import { AlgorandChainAdapter } from "../chain-adapters/algorand/algorand-adapter.js";
import { HttpFacilitatorClient } from "../facilitator-client/client.js";
import { InvariantRegistry } from "../core/registry.js";
import type { ScenarioContext, TestFixture } from "../core/types.js";

import { createU1Invariant } from "../invariants/universal/u1-verify-settle-consistency.js";
import { createU2Invariant } from "../invariants/universal/u2-retry-safety.js";
import { createU3Invariant } from "../invariants/universal/u3-concurrent-double-settle.js";
import { createU4Invariant } from "../invariants/universal/u4-allowlist-enforcement.js";
import { createU5Invariant } from "../invariants/universal/u5-gas-abuse-resubmission.js";
import { createA1Invariant } from "../invariants/algorand/a1-atomic-group-integrity.js";
import { createA2Invariant } from "../invariants/algorand/a2-asa-optin-precheck.js";
import { createA3Invariant } from "../invariants/algorand/a3-rekey-authorization.js";

/** §2.4 — never-cut invariants. `ward test` exits non-zero if any of these fail. */
export const MUST_HAVE_IDS = ["U1", "U2", "U3", "U4", "A1"];

const TEST_AMOUNT_ATOMIC = 1000n; // 0.001 USDC (6 decimals) — small enough to run repeatedly

export interface Scenario {
  config: WardConfig;
  ctx: ScenarioContext;
  fixture: TestFixture;
  registry: InvariantRegistry;
}

export function buildScenario(logLevel: LogLevel = "info", configOverrides: Partial<WardConfig> = {}): Scenario {
  const config = loadConfig(configOverrides);
  const logger = createLogger(logLevel);

  const chain = new AlgorandChainAdapter({
    algodServer: config.algodServer,
    algodToken: config.algodToken,
    network: config.network,
    funderSecretKey: process.env.WARD_FUNDER_PRIVATE_KEY,
  });
  const facilitator = new HttpFacilitatorClient({ baseUrl: config.facilitatorUrl });
  const ctx: ScenarioContext = { facilitator, chain, logger };

  const clientSecretKey = Buffer.from(config.clientPrivateKey, "base64");
  const clientAddress = algosdk.encodeAddress(clientSecretKey.subarray(32));

  const fixture: TestFixture = {
    clientAccount: { address: clientAddress, signer: config.clientPrivateKey },
    payToAddress: config.payToAddress,
    asset: config.usdcAssetId,
    amount: TEST_AMOUNT_ATOMIC,
    resource: "https://ward.test/resource",
    alternateNetwork: config.network === "testnet" ? ALGORAND_MAINNET_CAIP2 : ALGORAND_TESTNET_CAIP2,
    unsupportedAsset: "999999999999",
    unsupportedNetwork: "algorand:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  };

  const registry = new InvariantRegistry();
  registry.registerAll([
    createU1Invariant(fixture),
    createU4Invariant(fixture),
    createU2Invariant(fixture),
    createU3Invariant(fixture),
    createA1Invariant(fixture),
    createU5Invariant(fixture),
    createA2Invariant(fixture),
    createA3Invariant(fixture),
  ]);

  return { config, ctx, fixture, registry };
}
