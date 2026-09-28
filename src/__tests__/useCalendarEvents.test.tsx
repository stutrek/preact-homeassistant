import { act, screen, waitFor } from '@testing-library/preact';
import { render } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HAProvider } from '../HAContext';
import { useCalendarEvents } from '../calendars';
import type { FetchStatus } from '../types';
import type { CalendarEventWithSource } from '../types';
import { createMockSubscribe, makeHass } from './testHelpers';

function CalendarDisplay({
  entityIds,
  start,
  end,
}: {
  entityIds: `calendar.${string}`[];
  start: Date;
  end: Date;
}) {
  const { events, status, error } = useCalendarEvents(entityIds, {
    start,
    end,
  });
  return (
    <div>
      <span data-testid="count">{events?.length ?? 'loading'}</span>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error?.message ?? 'none'}</span>
      <span data-testid="events">
        {events?.map((e: CalendarEventWithSource) => `${e.calendarId}:${e.summary}`).join(',') ??
          ''}
      </span>
    </div>
  );
}

describe('useCalendarEvents', () => {
  const start = new Date('2025-01-01');
  const end = new Date('2025-01-31');

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('fetches events from multiple calendars', async () => {
    const sendMessagePromise = vi
      .fn()
      .mockResolvedValueOnce({
        response: {
          'calendar.family': {
            events: [{ start: '2025-01-05', end: '2025-01-05', summary: 'Birthday' }],
          },
        },
      })
      .mockResolvedValueOnce({
        response: {
          'calendar.work': {
            events: [{ start: '2025-01-10', end: '2025-01-10', summary: 'Meeting' }],
          },
        },
      });

    const hass = makeHass(
      {},
      {
        connection: { sendMessagePromise } as any,
      },
    );
    const { subscribe } = createMockSubscribe();

    render(
      <HAProvider hass={hass} subscribeToEntity={subscribe}>
        <CalendarDisplay entityIds={['calendar.family', 'calendar.work']} start={start} end={end} />
      </HAProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    expect(screen.getByTestId('count').textContent).toBe('2');
    expect(screen.getByTestId('events').textContent).toContain('calendar.family:Birthday');
    expect(screen.getByTestId('events').textContent).toContain('calendar.work:Meeting');
  });

  it('attaches calendarId to each event', async () => {
    const sendMessagePromise = vi.fn().mockResolvedValue({
      response: {
        'calendar.family': {
          events: [{ start: '2025-01-05', end: '2025-01-05', summary: 'Event' }],
        },
      },
    });

    const hass = makeHass(
      {},
      {
        connection: { sendMessagePromise } as any,
      },
    );
    const { subscribe } = createMockSubscribe();

    render(
      <HAProvider hass={hass} subscribeToEntity={subscribe}>
        <CalendarDisplay entityIds={['calendar.family']} start={start} end={end} />
      </HAProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('events').textContent).toBe('calendar.family:Event');
    });
  });

  it('handles fetch failure for one calendar gracefully', async () => {
    const sendMessagePromise = vi
      .fn()
      .mockRejectedValueOnce(new Error('Calendar offline'))
      .mockResolvedValueOnce({
        response: {
          'calendar.work': {
            events: [{ start: '2025-01-10', end: '2025-01-10', summary: 'Meeting' }],
          },
        },
      });

    // Suppress the expected console.error
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const hass = makeHass(
      {},
      {
        connection: { sendMessagePromise } as any,
      },
    );
    const { subscribe } = createMockSubscribe();

    render(
      <HAProvider hass={hass} subscribeToEntity={subscribe}>
        <CalendarDisplay entityIds={['calendar.family', 'calendar.work']} start={start} end={end} />
      </HAProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    // Should still get events from the working calendar
    expect(screen.getByTestId('count').textContent).toBe('1');
    expect(screen.getByTestId('events').textContent).toBe('calendar.work:Meeting');
  });

  it('returns empty array for empty entityIds', async () => {
    const { subscribe } = createMockSubscribe();

    render(
      <HAProvider hass={makeHass()} subscribeToEntity={subscribe}>
        <CalendarDisplay entityIds={[]} start={start} end={end} />
      </HAProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('refetches when entity changes (debounced)', async () => {
    vi.useFakeTimers();

    const sendMessagePromise = vi.fn().mockResolvedValue({
      response: {
        'calendar.family': {
          events: [{ start: '2025-01-05', end: '2025-01-05', summary: 'Event' }],
        },
      },
    });

    const hass = makeHass(
      {},
      {
        connection: { sendMessagePromise } as any,
      },
    );
    const { subscribe, notify } = createMockSubscribe();

    render(
      <HAProvider hass={hass} subscribeToEntity={subscribe}>
        <CalendarDisplay entityIds={['calendar.family']} start={start} end={end} />
      </HAProvider>,
    );

    // Wait for initial fetch
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const initialCallCount = sendMessagePromise.mock.calls.length;

    // Simulate entity change
    act(() => {
      notify('calendar.family', { state: 'on' });
    });

    // Not called yet (debounced)
    expect(sendMessagePromise.mock.calls.length).toBe(initialCallCount);

    // Advance past debounce
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(sendMessagePromise.mock.calls.length).toBeGreaterThan(initialCallCount);

    vi.useRealTimers();
  });
});

describe('useCalendarEvents REST path', () => {
  const start = new Date('2025-01-01');
  const end = new Date('2025-01-31');

  function UidDisplay({ entityIds }: { entityIds: `calendar.${string}`[] }) {
    const { events } = useCalendarEvents(entityIds, { start, end });
    return (
      <span data-testid="events">
        {events
          ?.map((e) => `${e.summary}/${e.start}/${e.uid ?? '-'}/${e.recurrence_id ?? '-'}`)
          .join(',') ?? ''}
      </span>
    );
  }

  it('prefers callApi and passes uid/recurrence_id/rrule through', async () => {
    const callApi = vi.fn().mockResolvedValue([
      {
        summary: 'Recital',
        description: null,
        location: null,
        uid: 'uid-1',
        recurrence_id: '2025-01-07T15:00:00',
        rrule: 'FREQ=WEEKLY',
        start: { dateTime: '2025-01-07T15:00:00-08:00' },
        end: { dateTime: '2025-01-07T16:00:00-08:00' },
      },
      {
        summary: 'Trip',
        description: null,
        location: null,
        uid: null,
        recurrence_id: null,
        rrule: null,
        start: { date: '2025-01-10' },
        end: { date: '2025-01-11' },
      },
    ]);
    const hass = makeHass({}, { callApi });
    const { subscribe } = createMockSubscribe();

    render(
      <HAProvider hass={hass} subscribeToEntity={subscribe}>
        <UidDisplay entityIds={['calendar.family']} />
      </HAProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('events').textContent).toBe(
        'Recital/2025-01-07T15:00:00-08:00/uid-1/2025-01-07T15:00:00,Trip/2025-01-10/-/-',
      );
    });

    expect(callApi).toHaveBeenCalledTimes(1);
    const [method, path] = callApi.mock.calls[0];
    expect(method).toBe('GET');
    expect(path).toMatch(/^calendars\/calendar\.family\?start=.+&end=.+$/);
    // The WS service-call path must not be used when callApi exists
    expect(hass.connection.sendMessagePromise).not.toHaveBeenCalled();
  });

  it('falls back to the WS service call without callApi', async () => {
    const hass = makeHass();
    (hass.connection.sendMessagePromise as ReturnType<typeof vi.fn>).mockResolvedValue({
      response: {
        'calendar.family': {
          events: [{ start: '2025-01-05', end: '2025-01-06', summary: 'Fallback' }],
        },
      },
    });
    const { subscribe } = createMockSubscribe();

    render(
      <HAProvider hass={hass} subscribeToEntity={subscribe}>
        <UidDisplay entityIds={['calendar.family']} />
      </HAProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('events').textContent).toBe('Fallback/2025-01-05/-/-');
    });
  });
});

describe('useCalendarEvents persistence', () => {
  const start = new Date('2025-01-01');
  const end = new Date('2025-01-31');

  function renderWith(
    entityIds: `calendar.${string}`[],
    sendMessagePromise: ReturnType<typeof vi.fn>,
  ) {
    const hass = makeHass({}, { connection: { sendMessagePromise } as any });
    const { subscribe } = createMockSubscribe();
    return render(
      <HAProvider hass={hass} subscribeToEntity={subscribe}>
        <CalendarDisplay entityIds={entityIds} start={start} end={end} />
      </HAProvider>,
    );
  }

  const respond = (msg: { target: { entity_id: string } }) => ({
    response: {
      [msg.target.entity_id]: {
        events: [{ start: '2025-01-05', end: '2025-01-05', summary: msg.target.entity_id }],
      },
    },
  });

  it('seeds a fresh provider from persisted per-entity events', async () => {
    const first = renderWith(['calendar.family'], vi.fn().mockImplementation(respond));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    first.unmount();

    // New provider = empty in-memory cache; a never-resolving fetch shows the seed.
    renderWith(['calendar.family'], vi.fn().mockReturnValue(new Promise(() => {})));
    expect(screen.getByTestId('status').textContent).toBe('cached');
    expect(screen.getByTestId('events').textContent).toBe('calendar.family:calendar.family');
  });

  it('composes a different calendar set from per-entity entries', async () => {
    const a = renderWith(['calendar.family'], vi.fn().mockImplementation(respond));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    a.unmount();
    const b = renderWith(['calendar.work'], vi.fn().mockImplementation(respond));
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    b.unmount();

    renderWith(
      ['calendar.family', 'calendar.work'],
      vi.fn().mockReturnValue(new Promise(() => {})),
    );
    expect(screen.getByTestId('status').textContent).toBe('cached');
    expect(screen.getByTestId('count').textContent).toBe('2');
  });

  it('does not seed when any calendar is missing, and never persists failures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const failing = vi.fn().mockRejectedValue(new Error('offline'));
    const first = renderWith(['calendar.family'], failing);
    await waitFor(() => expect(screen.getByTestId('status').textContent).toBe('ready'));
    first.unmount();

    renderWith(['calendar.family'], vi.fn().mockReturnValue(new Promise(() => {})));
    expect(screen.getByTestId('status').textContent).toBe('loading');
  });
});
