import { act, screen } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useEntity } from '../HAContext';
import { createMockSubscribe, makeHass, renderWithHA } from './testHelpers';

function EntityDisplay({ entityId }: { entityId: string }) {
  const entity = useEntity(entityId);
  const renderCount = useRef(0);
  renderCount.current++;
  return (
    <div>
      <span data-testid="state">{entity?.state ?? 'undefined'}</span>
      <span data-testid="id">{entity?.entity_id ?? 'none'}</span>
      <span data-testid="renders">{renderCount.current}</span>
    </div>
  );
}

describe('useEntity', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('returns the initial entity state from hass', () => {
    const hass = makeHass({
      'sensor.temp': { entity_id: 'sensor.temp', state: '72' },
    });
    const { subscribe } = createMockSubscribe();

    renderWithHA(<EntityDisplay entityId="sensor.temp" />, {
      hass,
      subscribeFn: subscribe,
    });

    expect(screen.getByTestId('state').textContent).toBe('72');
  });

  it('returns undefined for missing entities', () => {
    const { subscribe } = createMockSubscribe();

    renderWithHA(<EntityDisplay entityId="sensor.missing" />, {
      hass: makeHass({}),
      subscribeFn: subscribe,
    });

    expect(screen.getByTestId('state').textContent).toBe('undefined');
  });

  it('updates when subscribeToEntity fires', async () => {
    const { subscribe, notify } = createMockSubscribe();

    renderWithHA(<EntityDisplay entityId="sensor.temp" />, {
      hass: makeHass({}),
      subscribeFn: subscribe,
    });

    expect(screen.getByTestId('state').textContent).toBe('undefined');

    await act(() => {
      notify('sensor.temp', { entity_id: 'sensor.temp', state: '75' });
    });

    expect(screen.getByTestId('state').textContent).toBe('75');
  });

  it('caches entity to localStorage on update', async () => {
    const { subscribe, notify } = createMockSubscribe();

    renderWithHA(<EntityDisplay entityId="sensor.temp" />, {
      hass: makeHass({}),
      subscribeFn: subscribe,
    });

    await act(() => {
      notify('sensor.temp', { entity_id: 'sensor.temp', state: '75' });
    });

    const cached = localStorage.getItem('preact-ha:entity:sensor.temp');
    expect(cached).toBeTruthy();
    const parsed = JSON.parse(cached!);
    expect(parsed.data.state).toBe('75');
  });

  it('loads from cache when hass has no state', () => {
    // Pre-populate cache
    const entry = {
      data: { entity_id: 'sensor.temp', state: '68' },
      timestamp: Date.now(),
    };
    localStorage.setItem('preact-ha:entity:sensor.temp', JSON.stringify(entry));

    const { subscribe } = createMockSubscribe();

    renderWithHA(<EntityDisplay entityId="sensor.temp" />, {
      hass: makeHass({}),
      subscribeFn: subscribe,
    });

    expect(screen.getByTestId('state').textContent).toBe('68');
  });

  it('does not re-render when a different entity changes', async () => {
    const { subscribe, notify } = createMockSubscribe();

    renderWithHA(<EntityDisplay entityId="sensor.temp" />, {
      hass: makeHass({
        'sensor.temp': { entity_id: 'sensor.temp', state: '72' },
      }),
      subscribeFn: subscribe,
    });

    const rendersAfterMount = Number(screen.getByTestId('renders').textContent);

    // Notify a completely different entity
    await act(() => {
      notify('sensor.humidity', { entity_id: 'sensor.humidity', state: '45' });
    });

    // Render count should not have increased
    expect(Number(screen.getByTestId('renders').textContent)).toBe(rendersAfterMount);
    // Original state unchanged
    expect(screen.getByTestId('state').textContent).toBe('72');
  });

  it('unsubscribes on unmount', () => {
    const { subscribe, listeners } = createMockSubscribe();

    const { unmount } = renderWithHA(<EntityDisplay entityId="sensor.temp" />, {
      hass: makeHass({}),
      subscribeFn: subscribe,
    });

    expect(listeners.get('sensor.temp')?.size).toBe(1);

    unmount();

    expect(listeners.get('sensor.temp')?.size ?? 0).toBe(0);
  });
});
