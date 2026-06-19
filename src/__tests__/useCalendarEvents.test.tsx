import { act, screen, waitFor } from '@testing-library/preact';
import { render } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useCalendarEvents } from '../HAContext';
import { HAProvider } from '../HAContext';
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
