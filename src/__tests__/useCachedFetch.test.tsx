import { act, screen, waitFor } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCachedFetch } from '../HAContext';
import type { FetchStatus } from '../types';
import { renderWithHA } from './testHelpers';

// Every status seen across renders, so we can assert the SWR invariant
// (never 'loading' when data is available).
let statuses: FetchStatus[] = [];

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
  statuses.push(status);
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
    statuses = [];
  });

  it('transitions from loading to ready on successful fetch (cold start)', async () => {
    const fetcher = vi.fn().mockResolvedValue({ temp: 72 });

    renderWithHA(<FetchDisplay cacheKey="test" fetcher={fetcher} deps={[]} />);

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    expect(screen.getByTestId('data').textContent).toBe('{"temp":72}');
    // Cold start is the only time 'loading' is allowed.
    expect(statuses).toContain('loading');
  });

  it('shows cached data while refreshing', async () => {
    const cache = new Map<string, { data: unknown }>([['test', { data: { temp: 68 } }]]);

    let resolve: (v: any) => void;
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );

    renderWithHA(<FetchDisplay cacheKey="test" fetcher={fetcher} deps={[]} />, { cache });

    // Cached data shown immediately; no loading flash.
    expect(screen.getByTestId('data').textContent).toBe('{"temp":68}');
    expect(statuses).not.toContain('loading');

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

    renderWithHA(<FetchDisplay cacheKey="test" fetcher={fetcher} deps={[]} />);

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toBe('Network error');
    });
  });

  it('writes fetched data to the cache', async () => {
    const cache = new Map<string, { data: unknown }>();
    const fetcher = vi.fn().mockResolvedValue({ temp: 72 });

    renderWithHA(<FetchDisplay cacheKey="cache-write-test" fetcher={fetcher} deps={[]} />, {
      cache,
    });

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    expect(cache.get('cache-write-test')).toEqual({ data: { temp: 72 } });
  });

  it('ignores stale fetch results', async () => {
    const resolvers: Array<(v: any) => void> = [];
    const fetcher = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolvers.push(r);
        }),
    );

    const { rerender } = renderWithHA(
      <FetchDisplay cacheKey="test" fetcher={fetcher} deps={['a']} />,
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

  it('swaps to the new key cached data instantly on key change, never loading', () => {
    const cache = new Map<string, { data: unknown }>([
      ['a', { data: { v: 'A' } }],
      ['b', { data: { v: 'B' } }],
    ]);
    // Fetcher never resolves, so only cache-driven state is observed.
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));

    const { rerender } = renderWithHA(
      <FetchDisplay cacheKey="a" fetcher={fetcher} deps={['a']} />,
      { cache },
    );
    expect(screen.getByTestId('data').textContent).toBe('{"v":"A"}');

    rerender(<FetchDisplay cacheKey="b" fetcher={fetcher} deps={['b']} />);

    // Synchronous swap to the new key's cached value, no loading flash.
    expect(screen.getByTestId('data').textContent).toBe('{"v":"B"}');
    expect(screen.getByTestId('status').textContent).toBe('cached');
    expect(statuses).not.toContain('loading');
  });

  it('keeps the previous data on a cold key change (keep-previous-data)', () => {
    const cache = new Map<string, { data: unknown }>([['a', { data: { v: 'A' } }]]);
    const fetcher = vi.fn().mockImplementation(() => new Promise(() => {}));

    const { rerender } = renderWithHA(
      <FetchDisplay cacheKey="a" fetcher={fetcher} deps={['a']} />,
      { cache },
    );
    expect(screen.getByTestId('data').textContent).toBe('{"v":"A"}');

    // 'b' is not cached → keep showing A while the (pending) fetch runs.
    rerender(<FetchDisplay cacheKey="b" fetcher={fetcher} deps={['b']} />);
    expect(screen.getByTestId('data').textContent).toBe('{"v":"A"}');
    expect(statuses).not.toContain('loading');
  });
});
