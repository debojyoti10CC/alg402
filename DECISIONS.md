# Ward — Decision Log

Every judgment call made while building Ward autonomously, per the build brief §2.
Entries are append-only, in the order decisions were made.

---

## D0 — GITHUB_TOKEN not set

`GITHUB_TOKEN` was not present in the environment at setup time. Proceeded without
the GitHub MCP server. Used WebFetch against raw.githubusercontent.com and
github.com tree pages instead to inspect the facilitator repo. This was sufficient —
no GitHub API rate-limit or auth-gated content was needed.

## D1 (§2.1) — Target facilitator

**Chosen:** GoPlausible's x402-avm facilitator, at
`examples/typescript/facilitator/` inside the `x402-foundation/x402` monorepo
(GoPlausible's Algorand work is developed on the `branch-v2-algorand-publish`
branch of `github.com/GoPlausible/x402-avm`, which tracks/mirrors the official
x402-foundation monorepo — the published `@x402/avm` npm package's `repository`
field points to `x402-foundation/x402`, confirming this is the canonical,
foundation-adopted implementation, not an abandoned fork).

**Why:** AGENTS.md (installed from the algorand-devrel skills repo) already names
this facilitator explicitly (`https://facilitator.goplausible.xyz`) as the
reference implementation. Verified via WebFetch against the live repo:
- `examples/typescript/facilitator/index.ts` is a real Express.js service
  implementing `GET /supported`, `POST /verify`, `POST /settle`.
- `@x402/core` and `@x402/avm` are real, actively published npm packages
  (v2.22.0, published 2026-08-11), maintained by GoPlausible/Coinbase engineers
  under the x402-foundation org.
- The facilitator is self-hostable: `pnpm install && pnpm build`, then
  `pnpm dev`, configured via `.env` (`AVM_PRIVATE_KEY`, `ALGOD_SERVER`,
  `ALGOD_TOKEN`, `PORT`).

**Wrinkle:** the facilitator example is a multi-chain service — it also requires
`EVM_PRIVATE_KEY` and `SVM_PRIVATE_KEY` at startup and `process.exit(1)`s if
either is missing, even though Ward only exercises the AVM/Algorand scheme.
Resolution: `scripts/fund-accounts.ts` / `ward init` generate throwaway
well-formed EVM (hex) and SVM (base58) keys purely to satisfy the facilitator's
startup check. They are never funded, used to sign anything, or exercised by any
invariant — Algorand is the only chain under test.

**Self-hosting mechanism:** the facilitator's own `package.json` depends on
`@x402-avm/*` via `workspace:*` — i.e. it's a monorepo-internal package, not
independently `npm install`-able. So `docker-compose.yml` builds an image that
clones `GoPlausible/x402-avm` at `branch-v2-algorand-publish` at container-build
time, runs `pnpm install && pnpm build` at the `examples/typescript` workspace
root, and starts the facilitator with `pnpm --filter facilitator start` (or
equivalent), exposing port 4022. This is the standard way to self-host a
workspace-internal example package.

## D2 (§2.2) — A1 (atomic group integrity) viability: VIABLE

Confirmed via the facilitator's documented "fee abstraction" flow
(`use-typescript-x402-core-avm-reference.md`): every settlement is a 2-transaction
Algorand atomic group —
1. Txn 0: the client's payment (fee = 0), which the client signs.
2. Txn 1: a self-payment by the facilitator's fee-payer address (fee covers both
   txns), left unsigned by the client and co-signed by the facilitator at
   `/settle` time.

The facilitator is documented to validate txn 1's safety (self-payment, amount
== 0, no rekey/close-to, fee under `MAX_REASONABLE_FEE`) before co-signing and
submitting the group atomically. This is a real, concrete atomic-group trust
boundary — exactly what A1 is designed to probe. **A1 is built as originally
specified**, no substitution needed. It is the headline invariant: tamper a
transaction in the authorized group after the client signs (e.g. redirect the
fee-payer self-payment to an external address, or splice in a 3rd group member)
and assert the facilitator detects the mismatch and refuses to settle rather than
trusting the group by paymentIndex alone.

## D3 (§2.3) — API shapes

Pulled real V2 schemas from `use-typescript-x402-core-avm-reference.md` rather
than assuming generic x402-spec shapes:
- `PaymentPayload`: `{ x402Version: 2, scheme: "exact", network, payload: { paymentGroup: string[] /* base64 msgpack txns */, paymentIndex: number } }`
- `PaymentRequirements`: `{ scheme, network, maxAmountRequired, resource, description, mimeType, payTo, maxTimeoutSeconds, asset, outputSchema, extra? }`
- `/verify` and `/settle` both take `{ paymentPayload, paymentRequirements }` as
  the POST body (confirmed directly from the facilitator's `index.ts` route
  handlers).
- `/supported` takes no body, returns `facilitator.getSupported()` — a
  by-network map of registered schemes/signer addresses. U4 parses this
  structurally rather than assuming a fixed shape, since the exact key names
  weren't fully enumerated from docs alone; `facilitator-client/types.ts` types
  it permissively and the invariant asserts on behavior (rejection), not on
  matching an assumed shape.
- Network identifiers are CAIP-2 (`ALGORAND_TESTNET_CAIP2` /
  `ALGORAND_MAINNET_CAIP2`), not the informal `"algorand-testnet"` V1 strings.

This divergence from the generic x402 spec (Algorand's 2-txn fee-abstraction
group, and CAIP-2 network IDs) is itself worth surfacing in the report — Ward's
U1/U4 evidence includes the raw requirements/payload so a reader can see exactly
how Algorand's shape differs from the canonical EVM-first x402 spec.

## D4 — Network target: TestNet, not LocalNet

AlgoKit CLI is not installed in this environment (`algokit` not found), and
LocalNet requires it. Rather than adding an AlgoKit-CLI install as a prerequisite
just to get a local Algorand node, Ward targets **Algorand TestNet** by default:
- `algosdk`/`@x402/avm` already default to public testnet algod endpoints
  (`https://testnet-api.algonode.cloud`) — zero extra infra.
- The x402-on-Algorand skill's own "Testing" section is written testnet-first
  (dispenser for ALGO, testnet USDC ASA `10458941` via its own dispenser).
- `docker-compose.yml` still exists per the brief (it runs the self-hosted
  facilitator container), but that container talks out to public TestNet algod
  rather than to a LocalNet node.

This keeps `ward init && ward test` reproducible on a second machine without
requiring a LocalNet bootstrap, at the cost of needing testnet ALGO/USDC (funded
via public dispensers, scripted in `scripts/fund-accounts.ts`).

## D5 — Ward is not an AlgoKit-templated project

AGENTS.md's "Creating New Projects" section (`algokit init -n <name> -t
typescript ...`) is written for AlgoKit contract/frontend projects. Ward is a
standalone TypeScript CLI tool with no smart contract and no frontend — it's an
npm package built with `commander`, `algosdk`, `@x402/core`/`@x402/avm`, and
`algokit-utils-ts` (used only as a library for account/txn helpers, not via the
AlgoKit CLI). Scaffolded directly per the brief's `ward/` layout instead of via
`algokit init`.

## D6 (§2.4) — Invariant build order

Following the brief's cut order exactly: U1, U2, U3, U4, A1 are must-have and
built first (in the order U1 → U4 → U2 → U3 → A1, front-loading U1/U4 per the
brief's own build order §7 step 5, since they're the simplest end-to-end proof
that the pipeline works before tackling U2/U3's harder failure-injection and
concurrency semantics). U5, A2, A3 are stretch, attempted in that priority order
only after all must-haves are solid.

## D7 — Ground truth pulled from the installed package source, not just docs

After `npm install`, read the actual compiled `@x402/core` and `@x402/avm`
`.d.mts`/`.mjs` (not just the skill's reference markdown, which turned out to be
stale/paraphrased in a few places). This changed several concrete decisions:

1. **Real wire types differ from the skill docs.** `PaymentRequirements` is
   `{ scheme, network, asset, amount, payTo, maxTimeoutSeconds, extra }` (no
   `maxAmountRequired`/`resource`/`description`/`mimeType`/`outputSchema` —
   those live on `PaymentRequired.resource`/`PaymentPayload.resource`
   instead). `PaymentPayload` is `{ x402Version, resource?, accepted:
   PaymentRequirements, payload, extensions? }` — it embeds the accepted
   requirements. `SettleResponse.transaction` is the field name (not
   `txHash`/`txId` as the facilitator README paraphrase implied).
   `src/core/types.ts` was corrected to match the installed `.d.mts` exactly.
2. **Real atomic-group order (corrects D2's assumption):** reading
   `chunk-FXYJOXH6.mjs` (the compiled `ExactAvmScheme` client implementation)
   directly shows the fee-payer self-payment is **index 0** (built first,
   left unsigned) and the client's signed ASA transfer is **index 1**
   (`paymentIndex: 1`) — the reverse of D2's guess. The fee-payer leg's fee
   is calculated as the sum of both transactions' size-based fees, pooled
   entirely onto index 0; the payment leg gets `staticFee: 0`.
3. **A1 now has an exact, code-grounded target.** Reading
   `exact/facilitator/index.mjs` in full gave the complete, real validation
   algorithm the facilitator runs, including exact error codes. The critical
   trust boundary A1 exploits: `verifyFeePayerTransaction()` validates the
   *unsigned* fee-payer leg (self-payment, amount==0, no closeRemainderTo, no
   rekeyTo, fee ≤ `maxReasonableGroupFee(groupSize)`) — but that leg is never
   signed by the client, only by the facilitator at settle time. Because it's
   unsigned, an attacker who intercepts the payload after the client signs
   their own leg can rewrite the fee-payer leg arbitrarily (redirect its
   receiver, inflate its amount, add `rekeyTo`/`closeRemainderTo`) as long as
   the forged transaction still carries the original `group` field, so the
   separate group-ID-consistency check in `decodeTransactionGroup()` doesn't
   catch it. A1 is now built as 5 concrete sub-cases against
   `verifyFeePayerTransaction`'s exact checks, each mapping onto one of the
   USENIX study's four violation classes (fee-payer amount > 0 → Asset Theft;
   receiver redirected → Asset Theft; `closeRemainderTo` set → Asset Theft;
   `rekeyTo` set on the fee-payer leg → account takeover; fee over
   `maxReasonableGroupFee` → Gas Abuse). This is a strictly more precise test
   than the brief's generic "alter a transaction in the group" description,
   grounded in the facilitator's actual code path rather than a guess.
4. **A3's real target, per the actual code:** `settle()` unconditionally
   calls `this.verify()` as its own first step — it never trusts a
   previously-cached `/verify` decision. So the interesting version of "does
   settle trust a stale pre-rekey check" is: does the *fresh* verify inside
   settle() re-check spending authority against the account's *current*
   on-chain auth-addr, or only against the address's inherent ed25519 key
   (`txn.sender.publicKey`, which never changes even after a rekey)?
   `verifyPaymentTransaction`'s local `ed25519Verifier` check uses the
   latter (a potential local blind spot), but the subsequent
   `simulateTransactionGroup()` call runs a real algod simulation, which
   *does* enforce actual on-chain auth-addr rules. A3 tests the net effect
   end-to-end (rekey the client account, then settle) rather than assuming
   which internal layer would catch it — this is exactly the kind of
   evidence-over-assumption approach Ward is supposed to produce, and a PASS
   here (facilitator correctly rejects/re-verifies) is as valid and reportable
   an outcome as a FAIL.
5. **Client scheme always builds an ASA transfer**, never a native-ALGO
   payment (`composer.addAssetTransfer` unconditionally) — `asset: "0"` for
   native ALGO, mentioned in `types.ts`'s original comment, is not something
   the real client scheme ever produces. Ward's happy-path payments use the
   Algorand TestNet USDC ASA (`10458941`) via `ExactAvmScheme`, matching real
   x402-on-Algorand usage; native-ALGO groups are only ever hand-built
   in `tx-builder.ts` if a specific invariant needs one directly (none of the
   must-have invariants do).

Where this document and the actual `src/` code ever disagree, the code is
newer and correct — this entry exists so the reasoning is traceable, not as a
spec to keep re-syncing by hand.

## D8 — Pinning `@algorandfoundation/algokit-utils` to the v10 alpha @x402/avm actually uses

`npm install` initially resolved the top-level `@algorandfoundation/algokit-utils`
to `9.2.0` (matching what the skill's install instructions imply), but `@x402/avm`
depends on `10.0.0-alpha.46` and npm correctly nested a second copy under
`node_modules/@x402/avm/node_modules/` to satisfy it. Ward's own tamper code
(`atomic-group.ts`) needs to construct and decode the exact same `Transaction`
class instances that flow through `@x402/avm`'s `decodeTransaction`/
`encodeTransaction` — using a different major version's `Transaction` class would
be a real (if easy to miss) type/runtime mismatch. Pinned Ward's own dependency
to `10.0.0-alpha.46` explicitly so there's exactly one copy in the tree and no
ambiguity about which `Transaction` class is in play. Confirmed via the
package's own `exports` map (`./transact`, `./common` for `Address`, etc.) that
this version exposes everything `atomic-group.ts`, `asa.ts`, and `rekey.ts` need.

## D9 — TestNet dispensers can't be automated end-to-end

Algorand's TestNet ALGO dispenser (`bank.testnet.algorand.network`) and USDC
dispenser (`asset-dispenser.testnet.algorand.network`) are both captcha-gated
web forms, not plain APIs Ward can POST to on its own. `ward init` and
`scripts/fund-accounts.ts` automate everything *except* the initial funding of
one bootstrap account (`WARD_FUNDER_PRIVATE_KEY`) and the facilitator's own
signing key (`AVM_PRIVATE_KEY`) — those two addresses need one manual visit to
each dispenser. Once funded, `WARD_FUNDER` auto-funds every other test account
Ward needs (including A3's disposable throwaway accounts) via
`ChainAdapter.fundAccount()`, so this manual step only happens once per
environment, not once per run. This is called out explicitly in `.env.example`
and `scripts/fund-accounts.ts`'s printed instructions rather than pretending
`ward init` is push-button from a cold start — a tool that silently hangs
waiting on an unfunded account would be worse than one that's upfront about
the one step it can't do for you.

## D10 — Throwaway EVM/SVM keys are generated locally, not derived from anything real

Per D1's wrinkle, the upstream facilitator example refuses to start without
`EVM_PRIVATE_KEY`/`SVM_PRIVATE_KEY` even though only the AVM scheme is ever
registered or exercised. `scripts/fund-accounts.ts` generates a random,
well-formed hex string (EVM) and base58 string (SVM) purely to satisfy that
startup check — no real key material, no funding, no chain interaction on
either network. This is safe specifically because those signers are never
invoked by anything Ward does (Ward only ever calls the facilitator's
`/verify`, `/settle`, `/supported` HTTP endpoints, never anything EVM/SVM
specific), and it's simpler and more honest than trying to source real
throwaway keys from an EVM/SVM SDK Ward has no other reason to depend on.

## D11 — A3 runs on a disposable throwaway account, not the shared fixture account

`createA3Invariant` generates a brand-new keypair, funds it via
`ChainAdapter.fundAccount()`, and rekeys *that* account rather than
`fixture.clientAccount` (which every other invariant reuses). A rekey is a
real, potentially hard-to-reverse on-chain state change — if the "rekey back"
step at the end of A3 ever failed to execute (a crashed process, a network
partition mid-run), a shared fixture account left rekeyed to a discarded key
would strand every other invariant for the rest of that run and any future
run reusing the same `.env`. Isolating the blast radius to a purpose-built,
funded-just-for-this-test account means the worst case of a failed revert is
one small, clearly-logged, disposable account being stuck — not the whole
suite. The revert itself still runs unconditionally in a `finally` block, and
a failure to revert is logged loudly (`ctx.logger.warn`) rather than silently
swallowed.

## D12 — U2/U3's "retry safety" assertion is "no distinct double-settlement," not literally "success exactly once"

Both U2 (sequential retries) and U5 (resubmission) initially read as "assert
success happens exactly once" from the brief's wording. Algorand's own txID
deduplication means replaying byte-identical signed transaction bytes to
algod is safe by construction — a facilitator that echoes `success: true` with
the *same* transaction id on every retry has not caused any economic harm,
even though "success" technically appeared more than once. The sharper,
chain-grounded version of the safety property or, is: repeated retries of one
signed authorization must never resolve to more than one *distinct* on-chain
transaction id. U2 and U3 assert that directly (`distinctSuccessfulTxns.size
<= 1`) and report whether exactly-one-success also held as informative
context, rather than failing a facilitator that's actually safe just because
it wasn't maximally strict about idempotency bookkeeping. U3 additionally
keeps the brief's literal "exactly one success" as a named (but non-blocking)
data point in its evidence, since true concurrent dispatch is where that
distinction is most likely to actually differ from the sequential case.

## D13 — The §2.1 manual-payment verification step could not be completed autonomously

The brief requires getting the facilitator running and completing one real
payment on TestNet, confirmed on an explorer, *before* trusting any invariant
result — and explicitly says not to skip this. Ward's code path for it is
built and typechecks/compiles (`ward init`, `scripts/verify-manual-payment.ts`),
but actually executing it end-to-end requires TestNet ALGO in a real account,
and both Algorand TestNet dispensers (`bank.testnet.algorand.network` for
ALGO, `asset-dispenser.testnet.algorand.network` for USDC) are captcha-gated
web forms with no API this agent can complete on its own — there is no
credential or automation path around that gate available in this environment.

This is a genuine, environment-imposed stopping point, not a scope decision:
every other build-order step (scaffold, facilitator client, Algorand adapter,
all 8 invariants, CLI, Docker, unit tests, docs) is complete, and the full
project builds, typechecks, and unit-tests cleanly. What's unverified is
specifically the live, real-funds run — the one step that requires a human to
click through two dispenser pages once (`scripts/fund-accounts.ts` prints
exactly which two addresses and links). Once that's done, `ward init && ward
test` is expected to run the full suite for real; until then, the acceptance
checklist's "reliably across ≥5 repeated `ward test` runs" item is unverified
by this agent, and should be the first thing a human checks after funding.

---

*(Further entries appended below as more judgment calls come up during the
build.)*
