import { describe, expect, it } from "vitest";
import { InvariantRegistry } from "../src/core/registry.js";
import type { Invariant } from "../src/core/types.js";

function stubInvariant(id: string, passed: boolean): Invariant {
  return {
    id,
    name: `stub ${id}`,
    category: "universal",
    source: "test",
    async run() {
      return {
        id,
        name: `stub ${id}`,
        category: "universal",
        passed,
        evidenceSummary: passed ? "ok" : "not ok",
        evidence: null,
        durationMs: 0,
        timestamp: new Date().toISOString(),
      };
    },
  };
}

describe("InvariantRegistry", () => {
  it("registers and retrieves by id", () => {
    const registry = new InvariantRegistry();
    const inv = stubInvariant("X1", true);
    registry.register(inv);
    expect(registry.get("X1")).toBe(inv);
    expect(registry.all()).toEqual([inv]);
  });

  it("rejects duplicate ids", () => {
    const registry = new InvariantRegistry();
    registry.register(stubInvariant("X1", true));
    expect(() => registry.register(stubInvariant("X1", true))).toThrow(/already registered/);
  });

  it("requireGet throws a helpful error for unknown ids", () => {
    const registry = new InvariantRegistry();
    registry.register(stubInvariant("X1", true));
    expect(() => registry.requireGet("NOPE")).toThrow(/Known ids: X1/);
  });

  it("filters by category", () => {
    const registry = new InvariantRegistry();
    const universal = stubInvariant("U1", true);
    const algorand: Invariant = { ...stubInvariant("A1", true), category: "algorand" };
    registry.registerAll([universal, algorand]);
    expect(registry.byCategory("universal")).toEqual([universal]);
    expect(registry.byCategory("algorand")).toEqual([algorand]);
  });
});
