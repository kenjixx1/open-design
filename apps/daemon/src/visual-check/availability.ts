/**
 * Is a live desktop that supports visual checks attached right now? The probe
 * is an IPC round trip, so its answer is cached briefly. A thrown probe means
 * "no". Used both to add the prompt directive and to gate the route.
 */
export function createVisualCheckAvailability(
  probe: (() => Promise<boolean>) | null,
  options: { now?: () => number; ttlMs?: number } = {},
): () => Promise<boolean> {
  const ttlMs = options.ttlMs ?? 10_000;
  const now = options.now ?? Date.now;
  let cached: { at: number; value: boolean } | null = null;
  return async () => {
    if (!probe) return false;
    const t = now();
    if (cached && t - cached.at < ttlMs) return cached.value;
    let value = false;
    try {
      value = (await probe()) === true;
    } catch {
      value = false;
    }
    cached = { at: t, value };
    return value;
  };
}
