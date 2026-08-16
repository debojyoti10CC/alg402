/**
 * Deterministic concurrency helpers for invariants (U3, A1) that need
 * simultaneous dispatch rather than natural network jitter. Using
 * Promise.all directly on a set of already-built request promises is not
 * deterministic — request construction time varies. These helpers build
 * every request first, then release them together via a shared gate so the
 * dispatch instant is as close to identical as JS's single-threaded event
 * loop allows.
 */

/**
 * Runs `count` async operations, each produced by `factory(index)`, released
 * simultaneously from a single microtask via a shared gate promise. Returns
 * results in index order (not completion order), each tagged with wall-clock
 * dispatch and settle timestamps for evidence capture.
 */
export async function dispatchConcurrently<T>(
  count: number,
  factory: (index: number) => Promise<T>,
): Promise<Array<{ index: number; status: "fulfilled" | "rejected"; value?: T; reason?: unknown; dispatchedAt: number; settledAt: number }>> {
  let releaseGate: () => void;
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const runners = Array.from({ length: count }, (_, index) => {
    return (async () => {
      await gate;
      const dispatchedAt = Date.now();
      try {
        const value = await factory(index);
        return { index, status: "fulfilled" as const, value, dispatchedAt, settledAt: Date.now() };
      } catch (reason) {
        return { index, status: "rejected" as const, reason, dispatchedAt, settledAt: Date.now() };
      }
    })();
  });

  // Release synchronously in the next microtask, after every runner has
  // already reached `await gate` and queued its continuation.
  queueMicrotask(() => releaseGate());

  return Promise.all(runners);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
