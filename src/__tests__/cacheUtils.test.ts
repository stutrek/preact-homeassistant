import { beforeEach, describe, expect, it, vi } from 'vitest';
import { loadFromCache, saveToCache } from '../cacheUtils';

describe('cacheUtils', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('round-trips data through save and load', () => {
    saveToCache('test-key', { foo: 'bar' });
    expect(loadFromCache('test-key')).toEqual({ foo: 'bar' });
  });

  it('returns undefined for missing keys', () => {
    expect(loadFromCache('nonexistent')).toBeUndefined();
  });

  it('returns undefined for expired entries', () => {
    saveToCache('old', 'data');

    // Patch the stored timestamp to 25 hours ago
    const raw = localStorage.getItem('preact-ha:old')!;
    const entry = JSON.parse(raw);
    entry.timestamp = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem('preact-ha:old', JSON.stringify(entry));

    expect(loadFromCache('old')).toBeUndefined();
  });

  it('removes expired entries from localStorage', () => {
    saveToCache('old', 'data');

    const raw = localStorage.getItem('preact-ha:old')!;
    const entry = JSON.parse(raw);
    entry.timestamp = Date.now() - 25 * 60 * 60 * 1000;
    localStorage.setItem('preact-ha:old', JSON.stringify(entry));

    loadFromCache('old');
    expect(localStorage.getItem('preact-ha:old')).toBeNull();
  });

  it('returns undefined for corrupted JSON', () => {
    localStorage.setItem('preact-ha:bad', 'not json');
    expect(loadFromCache('bad')).toBeUndefined();
  });

  it('handles localStorage write failures gracefully', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = () => {
      throw new Error('QuotaExceededError');
    };

    // Should not throw
    saveToCache('key', 'value');
    expect(warnSpy).toHaveBeenCalled();

    localStorage.setItem = originalSetItem;
    vi.restoreAllMocks();
  });
});
