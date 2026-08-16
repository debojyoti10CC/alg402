/**
 * The installed `@x402/avm@2.22.0` package's own `ALGORAND_TESTNET_CAIP2` /
 * `ALGORAND_MAINNET_CAIP2` exports are truncated — hardcoded 33-char literals
 * cut mid-base64 (`algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDe`) instead of the
 * full 44-char base64-encoded genesis hash a CAIP-2 Algorand network id
 * actually needs (`algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=`).
 * Confirmed against both a live facilitator's `/verify` rejection and algod's
 * own `/v2/transactions/params` `genesis-hash` field, queried directly against
 * `testnet-api.algonode.cloud` and `mainnet-api.algonode.cloud`. Ward defines
 * its own correct constants here rather than trusting that package export.
 */
export const ALGORAND_TESTNET_CAIP2: `${string}:${string}` = "algorand:SGO1GKSzyE7IEPItTxCByw9x8FmnrCDexi9/cOUJOiI=";
export const ALGORAND_MAINNET_CAIP2: `${string}:${string}` = "algorand:wGHE2Pwdvd7S12BL5FaOP20EGYesN73ktiC1qzkkit8=";
