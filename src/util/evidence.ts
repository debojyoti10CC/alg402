/**
 * Captures request/response pairs so invariant results carry reproducible,
 * JSON-serializable evidence rather than just a pass/fail bit.
 */

export interface EvidenceEntry {
  label: string;
  request?: unknown;
  response?: unknown;
  note?: string;
  timestamp: string;
}

export class EvidenceCollector {
  private entries: EvidenceEntry[] = [];

  record(label: string, request?: unknown, response?: unknown, note?: string): void {
    this.entries.push({
      label,
      request: safeSerialize(request),
      response: safeSerialize(response),
      note,
      timestamp: new Date().toISOString(),
    });
  }

  all(): EvidenceEntry[] {
    return this.entries;
  }
}

/** Strips non-JSON-serializable values (functions, bigints as-is) so evidence always round-trips through JSON.stringify. */
function safeSerialize(value: unknown): unknown {
  if (value === undefined) return undefined;
  return JSON.parse(
    JSON.stringify(value, (_key, v) => (typeof v === "bigint" ? v.toString() : v)),
  );
}
