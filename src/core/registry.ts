import type { Invariant, InvariantCategory } from "./types.js";

/**
 * Chain-agnostic invariant registry. Registration is purely additive and
 * knows nothing about Algorand or any other chain — it just holds
 * `Invariant` objects and indexes them by id/category.
 */
export class InvariantRegistry {
  private byId = new Map<string, Invariant>();

  register(invariant: Invariant): void {
    if (this.byId.has(invariant.id)) {
      throw new Error(`Invariant with id "${invariant.id}" is already registered`);
    }
    this.byId.set(invariant.id, invariant);
  }

  registerAll(invariants: Invariant[]): void {
    for (const invariant of invariants) this.register(invariant);
  }

  get(id: string): Invariant | undefined {
    return this.byId.get(id);
  }

  requireGet(id: string): Invariant {
    const invariant = this.get(id);
    if (!invariant) {
      throw new Error(`No invariant registered with id "${id}". Known ids: ${this.all().map((i) => i.id).join(", ")}`);
    }
    return invariant;
  }

  all(): Invariant[] {
    return Array.from(this.byId.values());
  }

  byCategory(category: InvariantCategory): Invariant[] {
    return this.all().filter((i) => i.category === category);
  }
}
