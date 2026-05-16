import { act, screen, waitFor } from '@testing-library/preact';
import { render } from '@testing-library/preact';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWeatherForecast } from '../HAContext';
import { HAProvider } from '../HAContext';
import type { FetchStatus } from '../types';
import { createMockSubscribe, makeHass } from './testHelpers';

function ForecastDisplay({
  entityId,
  type,
}: {
  entityId: `weather.${string}`;
  type: 'daily' | 'hourly' | 'twice_daily';
}) {
  const { forecast, status, error } = useWeatherForecast(entityId, type);
  return (
    <div>
      <span data-testid="count">{forecast?.length ?? 'loading'}</span>
      <span data-testid="status">{status}</span>
      <span data-testid="error">{error?.message ?? 'none'}</span>
      <span data-testid="conditions">{forecast?.map((f) => f.condition).join(',') ?? ''}</span>
    </div>
  );
}

describe('useWeatherForecast', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('fetches forecast data', async () => {
    const sendMessagePromise = vi.fn().mockResolvedValue({
      response: {
        'weather.home': {
          forecast: [
            { datetime: '2025-01-01T00:00:00Z', condition: 'sunny', temperature: 72 },
            { datetime: '2025-01-02T00:00:00Z', condition: 'cloudy', temperature: 65 },
          ],
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
        <ForecastDisplay entityId="weather.home" type="daily" />
      </HAProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('status').textContent).toBe('ready');
    });

    expect(screen.getByTestId('count').textContent).toBe('2');
    expect(screen.getByTestId('conditions').textContent).toBe('sunny,cloudy');
  });

  it('sends the correct service call', async () => {
    const sendMessagePromise = vi.fn().mockResolvedValue({
      response: { 'weather.home': { forecast: [] } },
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
        <ForecastDisplay entityId="weather.home" type="hourly" />
      </HAProvider>,
    );

    await waitFor(() => {
      expect(sendMessagePromise).toHaveBeenCalled();
    });

    expect(sendMessagePromise).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'call_service',
        domain: 'weather',
        service: 'get_forecasts',
        service_data: { type: 'hourly' },
        target: { entity_id: 'weather.home' },
        return_response: true,
      }),
    );
  });

  it('refetches when entity changes (debounced)', async () => {
    vi.useFakeTimers();

    const sendMessagePromise = vi.fn().mockResolvedValue({
      response: { 'weather.home': { forecast: [] } },
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
        <ForecastDisplay entityId="weather.home" type="daily" />
      </HAProvider>,
    );

    // Let initial fetch + timer scheduling settle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const initialCallCount = sendMessagePromise.mock.calls.length;

    // Simulate entity change
    act(() => {
      notify('weather.home', { state: 'cloudy' });
    });

    // Advance past debounce (500ms)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    expect(sendMessagePromise.mock.calls.length).toBeGreaterThan(initialCallCount);

    vi.useRealTimers();
  });

  it('handles missing connection', async () => {
    const hass = makeHass({}, { connection: undefined as any });
    const { subscribe } = createMockSubscribe();

    render(
      <HAProvider hass={hass} subscribeToEntity={subscribe}>
        <ForecastDisplay entityId="weather.home" type="daily" />
      </HAProvider>,
    );

    await waitFor(() => {
      expect(screen.getByTestId('error').textContent).toContain('connection');
    });
  });

  it('schedules hourly refetch', async () => {
    vi.useFakeTimers();

    const sendMessagePromise = vi.fn().mockResolvedValue({
      response: { 'weather.home': { forecast: [] } },
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
        <ForecastDisplay entityId="weather.home" type="hourly" />
      </HAProvider>,
    );

    // Let initial fetch settle
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });

    const callsAfterInit = sendMessagePromise.mock.calls.length;

    // Advance to next hour
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61 * 60 * 1000);
    });

    expect(sendMessagePromise.mock.calls.length).toBeGreaterThan(callsAfterInit);

    vi.useRealTimers();
  });
});
