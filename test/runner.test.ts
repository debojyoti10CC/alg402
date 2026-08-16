import { describe, expect, it, vi } from "vitest";
import { runInvariants } from "../src/core/runner.js";
import type { Invariant, Logger, ScenarioContext } from "../src/core/types.js";

function noopLogger(): Logger {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function stubContext(): ScenarioContext {
  return {
    facilitator: { verify: vi.fn(), settle: vi.fn(), supported: vi.fn() },
    chain: {
      chainId: "stub",
      fundAccount: vi.fn(),
      buildPayment: vi.fn(),
      tamperPayload: vi.fn(),
      getExplorerLink: vi.fn(),
      waitForConfirmation: vi.fn(),
    },
    logger: noopLogger(),
  };
}

describe("runInvariants", () => {
  it("runs invariants sequentially and summarizes pass/fail", async () => {
    const order: string[] = [];
    const invariants: Invariant[] = [
      {
        id: "A",
        name: "A",
        category: "universal",
        source: "test",
        async run() {
          order.push("A");
          return { id: "A", name: "A", category: "universal", passed: true, evidenceSummary: "", evidence: null, durationMs: 0, timestamp: "" };
        },
      },
      {
        id: "B",
        name: "B",
        category: "universal",
        source: "test",
        async run() {
          order.push("B");
          return { id: "B", name: "B", category: "universal", passed: false, evidenceSummary: "", evidence: null, durationMs: 0, timestamp: "" };
        },
      },
    ];

    const summary = await runInvariants(invariants, stubContext());

    expect(order).toEqual(["A", "B"]);
    expect(summary.total).toBe(2);
    expect(summary.passed).toBe(1);
    expect(summary.failed).toBe(1);
  });

  it("converts a thrown error into a failed InvariantResult instead of crashing the run", async () => {
    const throwing: Invariant = {
      id: "C",
      name: "C",
      category: "universal",
      source: "test",
      async run() {
        throw new Error("boom");
      },
    };

    const summary = await runInvariants([throwing], stubContext());

    expect(summary.results).toHaveLength(1);
    expect(summary.results[0]?.passed).toBe(false);
    expect(summary.results[0]?.evidenceSummary).toMatch(/boom/);
  });
});
