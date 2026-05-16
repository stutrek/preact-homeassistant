import { act, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCachedFetch } from '../HAContext';
import type { FetchStatus } from '../types';
import { createMockSubscribe, makeHass, renderWithHA } from './testHelpers';

let lastStatus: FetchStatus;

function FetchDisplay({
  cacheKey,
  fetcher,
  deps,
}: {
  cacheKey: string;
  fetcher: () => Promise<any>;
  deps: unknown[];
}) {
  const { data, status, error } = useCachedFetch(cacheKey, fetcher, deps);
  lastStatus = status;
  return (
    <div>
      <span data-testid="data">{JSON.stringify(data) ?? 'undefined'}</span>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error?.message ?? 'none'}</span>
    </div>
  );
}

describe('useCachedFetch', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('transitions from loading to ready on successful fetch', async () => {
    const fetcher = vi.fn().mockResolvedValue({ temp: 72 });
    const { subscribe } = createMockSubscribe();

    renderWithHA(<FetchDisplay cacheKey="test" fetcher={fetcher} deps={[]} />, {
      subscribeFn: subscribe,
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    expect(screen.getByTestId('data').textContent).toBe('{"temp":72}');
  });

  it('shows cached data while refreshing', async () => {
    // Pre-populate cache
    const entry = {
      data: { temp: 68 },
      timestamp: Date.now(),
    };
    localStorage.setItem('preact-ha:test', JSON.stringify(entry));

    let resolve: (v: any) => void;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const { subscribe } = createMockSubscribe();

    renderWithHA(<FetchDisplay cacheKey="test" fetcher={fetcher} deps={[]} />, {
      subscribeFn: subscribe,
    });

    // Should show cached data
    expect(screen.getByTestId('data').textContent).toBe('{"temp":68}');

    // Resolve the fetch
    await act(async () => {
      resolve!({ temp: 75 });
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    expect(screen.getByTestId('data').textContent).toBe('{"temp":75}');
  });

  it('reports errors from failed fetches', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Network error'));
    const { subscribe } = createMockSubscribe();

    renderWithHA(<FetchDisplay cacheKey="test" fetcher={fetcher} deps={[]} />, {
      subscribeFn: subscribe,
    });

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Network error');
    });
  });

  it('saves fetched data to cache', async () => {
    const fetcher = vi.fn().mockResolvedValue({ temp: 72 });
    const { subscribe } = createMockSubscribe();

    renderWithHA(<FetchDisplay cacheKey="cache-write-test" fetcher={fetcher} deps={[]} />, {
      subscribeFn: subscribe,
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    const cached = localStorage.getItem('preact-ha:cache-write-test');
    expect(cached).toBeTruthy();
    expect(JSON.parse(cached!).data).toEqual({ temp: 72 });
  });

  it('ignores stale fetch results', async () => {
    const resolvers: Array<(v: any) => void> = [];
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolvers.push(r);
        }),
    );
    const { subscribe } = createMockSubscribe();

    const { rerender } = renderWithHA(
      <FetchDisplay cacheKey="test" fetcher={fetcher} deps={['a']} />,
      { subscribeFn: subscribe },
    );

    // Trigger a second fetch by changing deps
    rerender(<FetchDisplay cacheKey="test" fetcher={fetcher} deps={['b']} />);

    // Resolve the first (stale) fetch
    await act(async () => {
      resolvers[0]?.({ temp: 'stale' });
    });

    // Resolve the second (current) fetch
    await act(async () => {
      resolvers[1]?.({ temp: 'fresh' });
    });

    await waitFor(() => {
      expect(screen.getByTestId('data').textContent).toBe('{"temp":"fresh"}');
    });
  });
});
