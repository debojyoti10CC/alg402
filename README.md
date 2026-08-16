# Ward

Ward verifies whether an x402 payment facilitator actually behaves the way it's
supposed to. It compiles correctness invariants — derived from the x402 protocol
spec and a peer-reviewed security study of real facilitators — into executable
adversarial tests, runs them against a real, self-hosted facilitator on Algorand,
and reports exactly which guarantees hold and which are violated, with
reproducible evidence.

## Why

A USENIX Security '26 study tested 15 major x402 facilitators (60,000+ sellers,
360,000+ buyers) and found authorization-correctness violations in every single
one, across four classes: **Free Shopping**, **Asset Theft**, **Service Denial**,
and **Gas Abuse**. No facilitator ships with an automated way to verify it doesn't
have these problems. Ward is that test framework — Algorand first, with a
chain-agnostic core so a second chain is a new adapter, not a rewrite.

## What it tests against

Ward runs against [GoPlausible's x402-avm facilitator](https://github.com/GoPlausible/x402-avm)
(`branch-v2-algorand-publish`, the branch that's since been adopted into the
official `x402-foundation/x402` monorepo — see `DECISIONS.md` D1), self-hosted via
`docker-compose.yml`, not the public `facilitator.goplausible.xyz` instance. Every
finding here is about a real, running facilitator process Ward controls end to
end — never shared or production infrastructure.

## Invariants

| ID | Name | Category | Source |
|----|------|----------|--------|
| **U1** | Verify/settle consistency | universal, must-have | x402 protocol spec; USENIX study — Free Shopping, Asset Theft |
| **U2** | Retry safety | universal, must-have | x402 protocol spec; USENIX study — Free Shopping via naive retries |
| **U3** | Concurrent double-settle | universal, must-have | USENIX study — concurrency races enabling double-settlement |
| **U4** | Allowlist enforcement | universal, must-have | x402 protocol spec — `/supported` must be authoritative |
| **A1** | Atomic group integrity | algorand, **headline / must-have** | Algorand atomic transaction groups; `@x402/avm`'s `verifyFeePayerTransaction`; all four USENIX classes |
| U5 | Gas abuse resubmission | universal, stretch | USENIX study — Gas Abuse |
| A2 | ASA opt-in precheck | algorand, stretch | Algorand ASA opt-in requirement |
| A3 | Rekey authorization | algorand, stretch | Algorand rekeying; settle-time re-verification |

Every invariant's `source` field (visible in `ward test`/`ward fuzz` output and
the JSON report) cites exactly what it's checking against. `DECISIONS.md` records
*why* each one is shaped the way it is — in particular D7, which documents the
exact facilitator code paths A1's five sub-cases each target, pulled from the
installed `@x402/avm` package source rather than assumed from docs.

### A1, the headline invariant

The facilitator's gasless/sponsored-fee flow builds a 2-transaction atomic group:
the client's *signed* payment (index 1) plus an *unsigned* fee-payer self-payment
(index 0) that only the facilitator signs, at verify/settle time. Because that
second leg is never signed by the client, a payload intercepted after the client
authorizes it can be rewritten — inflated amount, redirected receiver, an added
`rekeyTo`/`closeRemainderTo` — while keeping the original group ID intact. A1
proves the facilitator's own safety check catches all five variants, mapped
directly onto the USENIX study's violation classes. It uses `/verify` only for the
malicious sub-cases (never `/settle`) — `/verify` exercises the exact same check
by signing the tampered leg without ever broadcasting it, so a real bug here can't
actually damage the facilitator's operational key.

## Setup

```bash
cp .env.example .env
npx tsx scripts/fund-accounts.ts   # generates every keypair .env needs, prints them
```

Follow the script's printed instructions: fund `WARD_FUNDER` and `AVM_PRIVATE_KEY`'s
addresses via the [TestNet ALGO dispenser](https://bank.testnet.algorand.network/)
(this one manual, captcha-gated step can't be automated — see `DECISIONS.md` D9),
then:

```bash
npm install
npm run ward -- init   # boots the facilitator, auto-funds the rest, verifies one real payment
npm run ward -- test   # runs the full invariant suite
```

Or, once built: `npm run build && ward init && ward test`.

## CLI

| Command | Behavior |
|---|---|
| `ward init` | Boots the facilitator via Docker Compose, funds accounts, verifies one manual payment succeeds. Idempotent. |
| `ward test` | Runs the full invariant suite, writes `reports/ward-report-<timestamp>.json` and `reports/latest.json`. Non-zero exit if any must-have invariant fails. |
| `ward fuzz <id>` | Runs one invariant in isolation with verbose evidence (e.g. `ward fuzz A1`). |
| `ward report` | Re-renders `reports/latest.json` as a table — works without a live facilitator. |

## Sample output

```
$ ward fuzz A1

Fuzzing A1 — atomic group integrity
Algorand atomic transaction groups (protocol primitive) + @x402/avm facilitator's
verifyFeePayerTransaction; USENIX Security '26 study — Free Shopping, Asset Theft,
Service Denial, Gas Abuse
category: algorand

Result: PASS (2143ms)
fee-payer leg amount > 0 (drains value instead of a pure self-payment): OK;
fee-payer leg receiver redirected away from self: OK;
fee-payer leg closes remainder balance to a third party: OK;
fee-payer leg rekeys the facilitator's own account: OK;
fee-payer leg fee inflated far past the reasonable cap: OK
```

## Architecture

```
src/
├── cli/                    commander entrypoint + init/test/fuzz/report commands
├── core/                   chain-agnostic contracts: Invariant, ChainAdapter,
│                           FacilitatorClient, registry, runner, report engine
├── facilitator-client/     thin HTTP wrapper over a real facilitator's REST API
├── invariants/
│   ├── universal/          U1–U5 — import only core/types.ts + shared.ts
│   └── algorand/           A1–A3 — the only files allowed to import chain-adapters/algorand
└── chain-adapters/
    └── algorand/           real @x402/avm-based payload construction + tamper helpers
```

**The one rule that makes "chain-agnostic core" real, not a pitch claim:**
`invariants/universal/*` may only ever import `core/types.ts` (the `ChainAdapter`
and `FacilitatorClient` interfaces) and `invariants/shared.ts` — never
`chain-adapters/algorand/*` directly. Only `invariants/algorand/*` does that. A
second chain means writing a new `chain-adapters/<chain>/` and wiring it into
`cli/setup.ts` — the universal invariants don't change.

## Ground truth, not guesses

Every wire shape and validation rule Ward relies on — `PaymentRequirements`,
`PaymentPayload`, the exact fee-abstraction group layout, and the facilitator's
complete `verify()`/`settle()` algorithm including its error codes — was read
directly from the installed `@x402/core`/`@x402/avm` package source (`.d.mts` and
compiled `.mjs`), not inferred from the skill's reference docs, which turned out
to diverge in several places (see `DECISIONS.md` D7). Where this README, the code,
and `DECISIONS.md` ever disagree, the code is newer and correct.
