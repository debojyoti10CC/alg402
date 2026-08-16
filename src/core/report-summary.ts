import type { InvariantResult } from "./types.js";
import type { WardReport } from "./report-engine.js";

/**
 * §2.4 — never-cut invariants. Duplicated from `cli/setup.ts`'s MUST_HAVE_IDS
 * (kept here, not imported from there) so this module has no dependency on
 * the CLI layer — it's used by both the CLI's dashboard generator and the
 * paid verification server.
 */
const MUST_HAVE_IDS = new Set(["U1", "U2", "U3", "U4", "A1"]);

const SOURCES: Record<string, string> = {
  U1: "x402 protocol spec + USENIX Security '26 study — Free Shopping, Asset Theft",
  U2: "x402 protocol spec + USENIX Security '26 study — Free Shopping via naive retries",
  U3: "USENIX Security '26 study — concurrency races enabling double-settlement",
  U4: "x402 protocol spec — /supported must be authoritative",
  A1: "Algorand atomic transaction groups + @x402/avm's verifyFeePayerTransaction; all four USENIX violation classes",
  U5: "USENIX Security '26 study — Gas Abuse violation class",
  A2: "Algorand ASA opt-in requirement",
  A3: "Algorand rekeying — settle() must not trust pre-rekey spending authority",
};

export interface SummaryFact {
  label: string;
  value: string;
  txId?: string;
}

export interface SummaryEvidenceRow {
  label: string;
  ok: boolean;
  detail: string;
  tag?: string;
}

export interface InvariantSummary {
  id: string;
  name: string;
  category: string;
  passed: boolean;
  mustHave: boolean;
  evidenceSummary: string;
  durationMs: number;
  source: string;
  detail: {
    rows?: SummaryEvidenceRow[];
    facts?: SummaryFact[];
  };
}

export interface ReportSummary {
  runId: string;
  timestamp: string;
  facilitator: WardReport["facilitator"];
  summary: WardReport["summary"];
  mustHaveIds: string[];
  results: InvariantSummary[];
}

function shortAddr(a: unknown): string {
  if (typeof a !== "string") return String(a);
  if (a.startsWith("algorand:")) {
    const hash = a.slice("algorand:".length);
    return "algorand:" + hash.slice(0, 8) + "…";
  }
  if (a.length > 20) return a.slice(0, 6) + "…" + a.slice(-4);
  return a;
}

/** Narrows `evidence: unknown` to a plain record for the known per-invariant shapes built in invariants/*. */
function ev(result: InvariantResult): Record<string, unknown> {
  return (result.evidence as Record<string, unknown>) ?? {};
}

function buildDetail(r: InvariantResult): InvariantSummary["detail"] {
  const e = ev(r);
  switch (r.id) {
    case "U1": {
      const subResults = (e.subResults as Array<{ field: string; ok: boolean; detail: string }>) ?? [];
      return { rows: subResults.map((s) => ({ label: s.field, ok: s.ok, detail: s.detail })) };
    }
    case "U4": {
      const listedNetworks = (e.listedNetworks as unknown[]) ?? [];
      return {
        facts: [
          { label: "networks advertised via /supported", value: String(listedNetworks.length) },
          { label: "unsupported network rejected", value: e.networkRejected ? "yes" : "no" },
          { label: "unsupported asset rejected", value: e.assetRejected ? "yes" : "no" },
        ],
      };
    }
    case "U2": {
      const responses = (e.responses as Array<{ attempt: number; success: boolean; transaction?: string; errorReason?: string }>) ?? [];
      const distinct = (e.distinctSuccessfulTxns as unknown[]) ?? [];
      return {
        rows: responses.map((a) => ({
          label: `retry #${a.attempt}`,
          ok: a.attempt === 1 ? a.success : !a.success,
          detail:
            a.attempt === 1
              ? a.success
                ? `settled — ${shortAddr(a.transaction)}`
                : (a.errorReason ?? "").replace(/^Failed to submit transaction: /, "")
              : a.success
                ? `settled AGAIN — ${shortAddr(a.transaction)} (double-settlement!)`
                : "correctly rejected as a duplicate of the first settlement",
        })),
        facts: [{ label: "distinct settled transactions", value: String(distinct.length) }],
      };
    }
    case "U3": {
      const distinctTxns = (e.distinctTxns as unknown[]) ?? [];
      const chainConfirmed = e.chainConfirmed as { txId: string; confirmedRound: number } | undefined;
      return {
        facts: [
          { label: "concurrent /settle calls fired", value: "5" },
          { label: "HTTP-level successes", value: String(e.successCount ?? 0) },
          { label: "distinct on-chain transactions", value: String(distinctTxns.length) },
          ...(chainConfirmed
            ? [
                { label: "confirmed transaction", value: shortAddr(chainConfirmed.txId), txId: chainConfirmed.txId },
                { label: "confirmed round", value: String(chainConfirmed.confirmedRound) },
              ]
            : []),
        ],
      };
    }
    case "U5": {
      const attempts = (e.attempts as Array<{ attempt: number; success: boolean; latencyMs: number; errorReason?: string }>) ?? [];
      return {
        rows: attempts.map((a) => ({
          label: `resubmission #${a.attempt}`,
          ok: !a.success,
          detail: `${a.latencyMs}ms — ${a.success ? "SUCCEEDED (unexpected)" : (a.errorReason ?? "rejected").replace(/^Transaction simulation failed: transaction \w+: /, "")}`,
        })),
      };
    }
    case "A1": {
      const subResults = (e.subResults as Array<{ label: string; ok: boolean; detail: string; violationClass: string }>) ?? [];
      const baselineTransaction = e.baselineTransaction as string | undefined;
      return {
        rows: subResults.map((s) => ({ label: s.label, ok: s.ok, detail: s.detail, tag: s.violationClass })),
        facts: baselineTransaction
          ? [{ label: "baseline sponsored settlement", value: shortAddr(baselineTransaction), txId: baselineTransaction }]
          : [],
      };
    }
    case "A2":
      return {
        facts: [
          { label: "test recipient (never opted into the ASA)", value: shortAddr(e.recipient) },
          { label: "opted in", value: e.optedIn ? "yes" : "no" },
        ],
      };
    case "A3":
      return { facts: [{ label: "disposable throwaway account", value: shortAddr(e.throwawayAddress) }] };
    default:
      return {};
  }
}

/** Reduces a full WardReport (raw wire payloads, msgpack blobs, algosdk objects) to a compact, judge/customer-facing summary. */
export function summarizeReport(report: WardReport): ReportSummary {
  return {
    runId: report.runId,
    timestamp: report.timestamp,
    facilitator: report.facilitator,
    summary: report.summary,
    mustHaveIds: [...MUST_HAVE_IDS],
    results: report.results.map((r) => ({
      id: r.id,
      name: r.name,
      category: r.category,
      passed: r.passed,
      mustHave: MUST_HAVE_IDS.has(r.id),
      evidenceSummary: r.evidenceSummary,
      durationMs: r.durationMs,
      source: SOURCES[r.id] ?? "",
      detail: buildDetail(r),
    })),
  };
}
