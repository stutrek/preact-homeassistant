import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_AGE_MS,
  MAX_ENTRIES,
  readPersisted,
  resetPersistedSweep,
  writePersisted,
} from '../persistentCache';

describe('persistentCache', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('round-trips data through localStorage', () => {
    writePersisted('k', { foo: 'bar' });
    expect(readPersisted('k')).toEqual({ foo: 'bar' });
  });

  it('returns undefined for missing or corrupt entries', () => {
    expect(readPersisted('missing')).toBeUndefined();
    localStorage.setItem('preact-ha:v2:bad', '{not json');
    expect(readPersisted('bad')).toBeUndefined();
  });

  it('drops entries older than the max age on read', () => {
    vi.useFakeTimers();
    writePersisted('k', 1);
    vi.advanceTimersByTime(MAX_AGE_MS + 1);
    expect(readPersisted('k')).toBeUndefined();
    expect(localStorage.getItem('preact-ha:v2:k')).toBeNull();
  });

  it('expires entries written by other library versions, keeping fresh ones', () => {
    vi.useFakeTimers();
    const now = Date.now();
    const old = now - MAX_AGE_MS - 1;
    localStorage.setItem('preact-ha:v3:stale', JSON.stringify({ d: 1, s: old, u: old }));
    localStorage.setItem('preact-ha:v3:fresh', JSON.stringify({ d: 1, s: now, u: now }));
    localStorage.setItem('preact-ha:events:stale', JSON.stringify({ data: 1, timestamp: old }));
    localStorage.setItem('preact-ha:events:fresh', JSON.stringify({ data: 1, timestamp: now }));

    readPersisted('anything');

    expect(localStorage.getItem('preact-ha:v3:stale')).toBeNull();
    expect(localStorage.getItem('preact-ha:events:stale')).toBeNull();
    expect(localStorage.getItem('preact-ha:v3:fresh')).not.toBeNull();
    expect(localStorage.getItem('preact-ha:events:fresh')).not.toBeNull();
  });

  it('applies the cap across all library versions', () => {
    vi.useFakeTimers();
    const now = Date.now();
    localStorage.setItem('preact-ha:v3:other', JSON.stringify({ d: 1, s: now, u: now - 1 }));
    for (let i = 0; i < MAX_ENTRIES; i++) {
      writePersisted(`k${i}`, i);
      vi.advanceTimersByTime(1);
    }
    expect(localStorage.getItem('preact-ha:v3:other')).toBeNull();
    expect(readPersisted('k0')).toBe(0);
  });

  it('sweeps expired and unrecognizable entries on first access', () => {
    vi.useFakeTimers();
    writePersisted('old', 1);
    vi.advanceTimersByTime(MAX_AGE_MS + 1);
    writePersisted('fresh', 2);
    localStorage.setItem('preact-ha:events:legacy', '{}');
    localStorage.setItem('unrelated', 'keep');

    resetPersistedSweep();
    readPersisted('fresh');

    expect(localStorage.getItem('preact-ha:v2:old')).toBeNull();
    expect(localStorage.getItem('preact-ha:events:legacy')).toBeNull();
    expect(localStorage.getItem('preact-ha:v2:fresh')).not.toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });

  it('evicts the least recently used entries beyond the cap', () => {
    vi.useFakeTimers();
    for (let i = 0; i < MAX_ENTRIES; i++) {
      writePersisted(`k${i}`, i);
      vi.advanceTimersByTime(1);
    }
    // Touch the oldest so it becomes most recently used
    readPersisted('k0');
    vi.advanceTimersByTime(1);
    writePersisted('new', 'x');

    expect(readPersisted('k0')).toBe(0);
    expect(readPersisted('k1')).toBeUndefined();
    expect(readPersisted('new')).toBe('x');
  });

  it('evicts the oldest entry and retries when storage is full', () => {
    vi.useFakeTimers();
    writePersisted('a', 1);
    vi.advanceTimersByTime(1);
    writePersisted('b', 2);

    const realSetItem = localStorage.setItem;
    let failed = false;
    vi.spyOn(localStorage, 'setItem').mockImplementation((key, value) => {
      if (!failed && key === 'preact-ha:v2:c') {
        failed = true;
        throw new DOMException('full', 'QuotaExceededError');
      }
      realSetItem(key, value);
    });

    writePersisted('c', 3);
    expect(localStorage.getItem('preact-ha:v2:a')).toBeNull();
    expect(readPersisted('b')).toBe(2);
    expect(readPersisted('c')).toBe(3);
  });
});
