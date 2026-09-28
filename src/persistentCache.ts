// localStorage persistence beneath the per-card in-memory cache. It only seeds
// a cold start: persisted data is always shown as stale ('cached') and then
// revalidated, so expiry here bounds storage rather than guaranteeing freshness.
//
// Every card built on this library bundles its own copy, and they all share one
// localStorage. Housekeeping therefore covers the whole `preact-ha:` NAMESPACE,
// not just this version's PREFIX, so data left by a deleted card (or a card on
// another library version) still expires as long as any preact-ha card loads.
//
// - Entries older than MAX_AGE_MS are dropped (never shown).
// - At most MAX_ENTRIES are kept namespace-wide; least-recently-used go first.
// - The first access per page sweeps expired and unrecognizable entries.
// - The versioned PREFIX scopes what this version *reads*; bumping it makes old
//   entries unreadable to new code, and they then age out via the sweep.
// - Quota errors evict the oldest entry and retry once, then give up silently.
//
// Cross-version contract — keep stable in all future versions: every value under
// NAMESPACE is JSON with numeric `s` (saved at, ms) and `u` (last used, ms).
// Pre-0.3 entries ({ data, timestamp }) are understood via `timestamp`.

const NAMESPACE = 'preact-ha:';
const PREFIX = 'preact-ha:v2:';
export const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000;
export const MAX_ENTRIES = 60;

interface PersistedEntry<T> {
  /** data */
  d: T;
  /** saved at (ms) */
  s: number;
  /** last used (ms) */
  u: number;
}

interface EntryTimes {
  saved: number;
  used: number;
}

let swept = false;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage ?? undefined;
  } catch {
    // Access can throw (sandboxed iframes, disabled storage)
    return undefined;
  }
}

/** Timestamps from any version's entry; undefined if unrecognizable. */
function timesOf(raw: string | null): EntryTimes | undefined {
  if (!raw) return undefined;
  try {
    const value = JSON.parse(raw);
    const saved = typeof value?.s === 'number' ? value.s : value?.timestamp;
    if (typeof saved !== 'number') return undefined;
    return { saved, used: typeof value.u === 'number' ? value.u : saved };
  } catch {
    return undefined;
  }
}

function namespaceKeys(ls: Storage): string[] {
  const keys: string[] = [];
  for (let i = 0; i < ls.length; i++) {
    const key = ls.key(i);
    if (key?.startsWith(NAMESPACE)) keys.push(key);
  }
  return keys;
}

/** Namespace entries, least recently used first. */
function entriesByUse(ls: Storage): { key: string; used: number }[] {
  return namespaceKeys(ls)
    .map((key) => ({ key, used: timesOf(ls.getItem(key))?.used ?? 0 }))
    .sort((a, b) => a.used - b.used);
}

function evictOverCap(ls: Storage): void {
  // Cheap key count first; only parse entries when we actually need to evict.
  const count = namespaceKeys(ls).length;
  if (count <= MAX_ENTRIES) return;
  const entries = entriesByUse(ls);
  for (let i = 0; i < count - MAX_ENTRIES; i++) {
    ls.removeItem(entries[i].key);
  }
}

/** Drop expired and unrecognizable entries namespace-wide, then enforce the cap. Once per page. */
function sweep(ls: Storage): void {
  if (swept) return;
  swept = true;
  const now = Date.now();
  for (const key of namespaceKeys(ls)) {
    const times = timesOf(ls.getItem(key));
    if (!times || now - times.saved > MAX_AGE_MS) ls.removeItem(key);
  }
  evictOverCap(ls);
}

export function readPersisted<T>(key: string): T | undefined {
  const ls = storage();
  if (!ls) return undefined;
  try {
    sweep(ls);
    const fullKey = PREFIX + key;
    const raw = ls.getItem(fullKey);
    if (!raw) return undefined;
    const entry = JSON.parse(raw) as PersistedEntry<T>;
    const now = Date.now();
    if (typeof entry?.s !== 'number' || now - entry.s > MAX_AGE_MS) {
      ls.removeItem(fullKey);
      return undefined;
    }
    entry.u = now;
    ls.setItem(fullKey, JSON.stringify(entry));
    return entry.d;
  } catch {
    return undefined;
  }
}

export function writePersisted<T>(key: string, data: T): void {
  const ls = storage();
  if (!ls) return;
  const now = Date.now();
  const value = JSON.stringify({ d: data, s: now, u: now } satisfies PersistedEntry<T>);
  try {
    sweep(ls);
    ls.setItem(PREFIX + key, value);
    evictOverCap(ls);
  } catch {
    // Most likely quota exceeded: free the oldest entry and retry once.
    try {
      const oldest = entriesByUse(ls)[0];
      if (oldest) ls.removeItem(oldest.key);
      ls.setItem(PREFIX + key, value);
    } catch {
      // Give up; the in-memory cache still works.
    }
  }
}

/** Test hook: forget that the startup sweep ran. */
export function resetPersistedSweep(): void {
  swept = false;
}
