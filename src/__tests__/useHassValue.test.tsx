import { act, render, screen } from '@testing-library/preact';
import { describe, expect, it } from 'vitest';
import { HAProvider, useDarkMode } from '../HAContext';
import type { HomeAssistant } from '../types';

function makeHass(darkMode: boolean): HomeAssistant {
  return {
    states: {},
    config: {} as any,
    services: {} as any,
    connection: {} as any,
    callService: () => {},
    themes: { darkMode },
  };
}

// Controllable hass-change subscription.
function makeHassSubscription() {
  const listeners = new Set<() => void>();
  return {
    subscribeToHass: (cb: () => void) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    notify: () => listeners.forEach((cb) => cb()),
  };
}

let renderCount = 0;
function DarkModeProbe() {
  renderCount++;
  const dark = useDarkMode();
  return <span data-testid="dark">{String(dark)}</span>;
}

describe('useHassValue / useDarkMode', () => {
  it('returns the initial selected value', () => {
    const { subscribeToHass } = makeHassSubscription();
    render(
      <HAProvider
        hass={makeHass(true)}
        subscribeToEntity={() => () => {}}
        subscribeToHass={subscribeToHass}
      >
        <DarkModeProbe />
      </HAProvider>,
    );
    expect(screen.getByTestId('dark').textContent).toBe('true');
  });

  it('does not re-render when the selected slice is unchanged', () => {
    const { subscribeToHass, notify } = makeHassSubscription();
    renderCount = 0;
    render(
      <HAProvider
        hass={makeHass(false)}
        subscribeToEntity={() => () => {}}
        subscribeToHass={subscribeToHass}
      >
        <DarkModeProbe />
      </HAProvider>,
    );
    const afterMount = renderCount;

    // hass pushes arrive but darkMode is still false → no re-render.
    act(() => {
      notify();
      notify();
    });

    expect(renderCount).toBe(afterMount);
    expect(screen.getByTestId('dark').textContent).toBe('false');
  });

  it('updates when the selected slice changes', () => {
    const { subscribeToHass, notify } = makeHassSubscription();
    let hass = makeHass(false);

    const { rerender } = render(
      <HAProvider hass={hass} subscribeToEntity={() => () => {}} subscribeToHass={subscribeToHass}>
        <DarkModeProbe />
      </HAProvider>,
    );
    expect(screen.getByTestId('dark').textContent).toBe('false');

    // New hass with darkMode flipped, then a hass-change notification.
    hass = makeHass(true);
    rerender(
      <HAProvider hass={hass} subscribeToEntity={() => () => {}} subscribeToHass={subscribeToHass}>
        <DarkModeProbe />
      </HAProvider>,
    );
    act(() => {
      notify();
    });

    expect(screen.getByTestId('dark').textContent).toBe('true');
  });
});
