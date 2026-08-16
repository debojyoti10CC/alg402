import type { InvariantCategory, InvariantResult } from "../core/types.js";

/**
 * Shared result-building helper for every invariant module. Imports nothing
 * beyond core/types.ts, so it's safe for both `invariants/universal/*` and
 * `invariants/algorand/*` to depend on.
 */
export function makeResult(
  id: string,
  name: string,
  category: InvariantCategory,
  start: number,
  passed: boolean,
  evidenceSummary: string,
  evidence: unknown,
): InvariantResult {
  return {
    id,
    name,
    category,
    passed,
    evidenceSummary,
    evidence,
    durationMs: Date.now() - start,
    timestamp: new Date().toISOString(),
  };
}
