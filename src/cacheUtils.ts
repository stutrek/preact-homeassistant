// In-memory cache helpers. The cache Map is owned per-card by the HAProvider
// store (see HAContext), so its lifetime matches the card and it is
// garbage-collected when the card is torn down. There is intentionally no TTL
// or size cap here: freshness comes from entity subscriptions and periodic
// refetch, not from cache expiry, and growth is bounded by the ranges a single
// card visits in a session. Cross-reload persistence (with expiry) lives in
// persistentCache.ts and only seeds this cache on a miss.

export interface CacheEntry<T> {
  data: T;
}

export type Cache = Map<string, CacheEntry<unknown>>;

export function readCache<T>(cache: Cache, key: string): T | undefined {
  return (cache.get(key) as CacheEntry<T> | undefined)?.data;
}

export function writeCache<T>(cache: Cache, key: string, data: T): void {
  cache.set(key, { data });
}
