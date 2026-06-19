import { describe, expect, it } from 'vitest';
import { type Cache, readCache, writeCache } from '../cacheUtils';

describe('cacheUtils', () => {
  it('round-trips data through write and read', () => {
    const cache: Cache = new Map();
    writeCache(cache, 'test-key', { foo: 'bar' });
    expect(readCache(cache, 'test-key')).toEqual({ foo: 'bar' });
  });

  it('returns undefined for missing keys', () => {
    const cache: Cache = new Map();
    expect(readCache(cache, 'nonexistent')).toBeUndefined();
  });

  it('overwrites an existing entry', () => {
    const cache: Cache = new Map();
    writeCache(cache, 'k', 1);
    writeCache(cache, 'k', 2);
    expect(readCache(cache, 'k')).toBe(2);
  });

  it('isolates entries between separate cache maps', () => {
    const a: Cache = new Map();
    const b: Cache = new Map();
    writeCache(a, 'k', 'a-value');
    expect(readCache(b, 'k')).toBeUndefined();
  });

  it('stores undefined data without conflating it with a missing key', () => {
    const cache: Cache = new Map();
    writeCache(cache, 'k', undefined);
    expect(cache.has('k')).toBe(true);
    expect(readCache(cache, 'k')).toBeUndefined();
  });
});
