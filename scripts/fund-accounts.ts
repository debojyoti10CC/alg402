/**
 * Generates every keypair Ward's .env needs and prints the manual funding
 * steps that can't be automated (TestNet dispensers are captcha-gated, so
 * this can't POST to them on your behalf — see DECISIONS.md D9).
 *
 * Usage: npx tsx scripts/fund-accounts.ts
 */
import algosdk from "algosdk";
import { generateKeyPairSync } from "node:crypto";

function algorandKeyPair(label: string) {
  const account = algosdk.generateAccount();
  const secretKeyBase64 = Buffer.from(account.sk).toString("base64");
  console.log(`\n${label}`);
  console.log(`  address:     ${account.addr.toString()}`);
  console.log(`  base64 key:  ${secretKeyBase64}`);
  return { address: account.addr.toString(), secretKeyBase64 };
}

function throwawayEvmKey(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return "0x" + Buffer.from(bytes).toString("hex");
}

function throwawaySvmKey(): string {
  // base58-encoded 64-byte secret key (32-byte seed + 32-byte public key), the
  // standard Solana/nacl format. @solana/keys verifies at load time that the
  // public-key half is actually derived from the seed half, so this must be a
  // real Ed25519 keypair, not 64 arbitrary random bytes — never used to sign
  // anything, since Ward never exercises SVM.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pubDer = publicKey.export({ type: "spki", format: "der" });
  const privDer = privateKey.export({ type: "pkcs8", format: "der" });
  const seed = privDer.subarray(privDer.length - 32);
  const pub = pubDer.subarray(pubDer.length - 32);
  return base58Encode(Buffer.concat([seed, pub]));
}

const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Encode(bytes: Uint8Array): string {
  let value = BigInt("0x" + Buffer.from(bytes).toString("hex"));
  let out = "";
  while (value > 0n) {
    const rem = value % 58n;
    out = BASE58_ALPHABET[Number(rem)] + out;
    value /= 58n;
  }
  for (const b of bytes) {
    if (b === 0) out = "1" + out;
    else break;
  }
  return out || "1";
}

console.log("=== Ward account generation ===");
console.log("Paste the values below into .env (copy .env.example first).\n");

const funder = algorandKeyPair("WARD_FUNDER (fund this one FIRST via the dispenser, then it can auto-fund the rest)");
const client = algorandKeyPair("WARD_CLIENT (the account Ward signs test payments from)");
const payTo = algorandKeyPair("WARD_PAYTO (the seller/resource-owner stand-in Ward pays)");
const facilitatorSigner = algorandKeyPair("AVM_PRIVATE_KEY (the self-hosted facilitator's own fee-payer signing key)");

console.log("\nEVM_PRIVATE_KEY (throwaway — required by the upstream facilitator to start, never used):");
console.log(`  ${throwawayEvmKey()}`);
console.log("\nSVM_PRIVATE_KEY (throwaway — required by the upstream facilitator to start, never used):");
console.log(`  ${throwawaySvmKey()}`);

console.log("\n=== Manual steps (cannot be automated — dispensers are captcha-gated) ===");
console.log(`1. Fund WARD_FUNDER with TestNet ALGO: https://bank.testnet.algorand.network/  (address: ${funder.address})`);
console.log(`2. Fund AVM_PRIVATE_KEY's address the same way — the facilitator needs ALGO to co-sign fee-payer txns (address: ${facilitatorSigner.address})`);
console.log("3. Run `ward init` — it will use WARD_FUNDER to fund WARD_CLIENT and WARD_PAYTO with ALGO automatically.");
console.log(`4. Opt WARD_CLIENT and WARD_PAYTO into the TestNet USDC ASA (10458941), then fund both from`);
console.log("   https://asset-dispenser.testnet.algorand.network/");
console.log("\nOnce all four addresses hold ALGO (+ USDC for client/payTo), run `ward test`.");
