export type LocalStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// Obtaining localStorage can throw too. Resolve it only inside guarded calls.
export function createSafeStorage(resolve: () => LocalStore) {
  const cache = new Map<string, string | null>();
  const dirty = new Set<string>();
  const listeners = new Set<() => void>();
  let unavailable = false;
  function failed() {
    if (unavailable) return;
    unavailable = true;
    queueMicrotask(() => listeners.forEach((listener) => listener()));
  }
  return {
    getItem(key: string) {
      if (dirty.has(key)) return cache.get(key) ?? null;
      try {
        const value = resolve().getItem(key);
        cache.set(key, value);
        return value;
      } catch {
        failed();
        return cache.get(key) ?? null;
      }
    },
    setItem(key: string, value: string) {
      cache.set(key, value);
      try {
        resolve().setItem(key, value);
        dirty.delete(key);
      } catch {
        dirty.add(key);
        failed();
      }
    },
    removeItem(key: string) {
      cache.set(key, null);
      try {
        resolve().removeItem(key);
        dirty.delete(key);
      } catch {
        dirty.add(key);
        failed();
      }
    },
    unavailable: () => unavailable,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
export const browserStorage = createSafeStorage(() => globalThis.localStorage);
