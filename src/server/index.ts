/**
 * Paid verification service: exposes Ward's adversarial invariant suite as a
 * single x402-gated endpoint. A customer pays, submits the URL of *their*
 * facilitator, and gets back the same pass/fail evidence `ward test` writes
 * to `reports/latest.json` — Ward's core engine (`core/`, `chain-adapters/`,
 * `invariants/`) is unchanged; this is a second, parallel consumer of it
 * alongside the CLI. See DECISIONS.md for why the CLI's own `.env`-fixed
 * test accounts (WARD_CLIENT/WARD_PAYTO/WARD_FUNDER) are reused here as the
 * probing identity for every check — this server only swaps which
 * facilitator gets tested, not who tests it.
 *
 * Currently TestNet-only: the funded WARD_* accounts back it, and several
 * invariants (U1's baseline, U2, U3, A1's baseline) settle real payments as
 * part of the check. Verifying a real MainNet facilitator would need its own
 * funded MainNet probing accounts and a deliberate spend-cap/consent pass —
 * not wired up here.
 */
import "dotenv/config";
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactAvmScheme } from "@x402/avm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { ALGORAND_TESTNET_CAIP2 } from "../chain-adapters/algorand/network-ids.js";
import { buildScenario } from "../cli/setup.js";
import { runInvariants } from "../core/runner.js";
import { buildReport } from "../core/report-engine.js";
import { summarizeReport } from "../core/report-summary.js";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// Render (and most PaaS hosts) assign the listen port via `PORT` and expect the
// app to bind to it; SERVER_PORT is only for local dev where nothing else claims it.
const PORT = Number(process.env.PORT ?? process.env.SERVER_PORT ?? 4030);
const PAY_TO = required("SERVER_PAY_TO_ADDRESS");
// Defaults to the public facilitator so this works from a host that can't reach
// Ward's own local self-hosted facilitator (e.g. a deployed instance can't see
// `localhost:4022` on the dev machine that ran `docker-compose up`). Point
// PAYMENT_FACILITATOR_URL at a self-hosted instance instead if you deploy one
// somewhere reachable. A too-tight payment validity window against the public
// facilitator was a real issue during development — fixed client-side (see
// scripts/pay-and-verify.ts), not here.
const PAYMENT_FACILITATOR_URL = process.env.PAYMENT_FACILITATOR_URL ?? "https://facilitator.goplausible.xyz";

const app = express();
app.use(express.json());

// The facilitator that processes payment TO this service — deliberately
// separate from the facilitatorUrl a customer submits to be tested; this one
// just needs to work, it is never itself under test.
const facilitatorClient = new HTTPFacilitatorClient({ url: PAYMENT_FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient);
resourceServer.register("algorand:*", new ExactAvmScheme());

const routes = {
  "POST /verify-facilitator": {
    accepts: {
      scheme: "exact" as const,
      network: ALGORAND_TESTNET_CAIP2,
      payTo: PAY_TO,
      price: "$1.00",
    },
    description:
      "Runs Ward's adversarial x402 facilitator invariant suite (U1–U5, A1–A3) against a facilitator URL you provide and returns a pass/fail report with reproducible evidence.",
  },
};

app.use(paymentMiddleware(routes, resourceServer));

app.get("/", (_req, res) => {
  res.json({
    name: "Ward — facilitator verification service",
    description:
      "Pay once, get a real adversarial-test report on whether an x402 facilitator honors its correctness invariants.",
    endpoints: {
      verify: "POST /verify-facilitator { facilitatorUrl: string } — $1.00",
      health: "GET /health",
    },
  });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/verify-facilitator", async (req, res) => {
  const { facilitatorUrl } = req.body ?? {};
  if (typeof facilitatorUrl !== "string" || facilitatorUrl.length === 0) {
    res.status(400).json({ ok: false, error: "facilitatorUrl (string) is required in the request body" });
    return;
  }

  try {
    const { ctx, registry, config } = buildScenario("warn", { facilitatorUrl });
    const run = await runInvariants(registry.all(), ctx, { concurrent: false });
    const report = buildReport(run.results, {
      name: facilitatorUrl,
      commit: "unknown",
      chain: `algorand-${config.network}`,
    });
    res.json({ ok: true, report: summarizeReport(report) });
  } catch (err) {
    res.status(502).json({
      ok: false,
      error: `Could not complete the check against ${facilitatorUrl}: ${err instanceof Error ? err.message : String(err)}`,
    });
  }
});

app.listen(PORT, () => {
  console.log(`Ward verification server: http://localhost:${PORT}`);
  console.log(`Pay-to address:           ${PAY_TO}`);
  console.log(`Payment facilitator:      ${PAYMENT_FACILITATOR_URL}`);
});
