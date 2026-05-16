import { type RenderOptions, render } from '@testing-library/preact';
import type { ComponentChildren } from 'preact';
import { vi } from 'vitest';
import { HAProvider } from '../HAContext';
import type { HomeAssistant } from '../types';

export type MockSubscribeFn = (entityId: string, callback: (entity: any) => void) => () => void;

export function makeHass(
  states: Record<string, any> = {},
  overrides: Partial<HomeAssistant> = {},
): HomeAssistant {
  return {
    states,
    config: {} as any,
    services: {} as any,
    connection: {
      sendMessagePromise: vi.fn(),
    } as any,
    callService: vi.fn(),
    ...overrides,
  };
}

/**
 * Creates a mock subscribeToEntity that stores callbacks for manual triggering.
 */
export function createMockSubscribe() {
  const listeners = new Map<string, Set<(entity: any) => void>>();

  const subscribe: MockSubscribeFn = (entityId, callback) => {
    if (!listeners.has(entityId)) {
      listeners.set(entityId, new Set());
    }
    listeners.get(entityId)!.add(callback);

    return () => {
      listeners.get(entityId)?.delete(callback);
    };
  };

  const notify = (entityId: string, entity: any) => {
    listeners.get(entityId)?.forEach((cb) => cb(entity));
  };

  return { subscribe, notify, listeners };
}

interface RenderWithHAOptions extends Omit<RenderOptions, 'wrapper'> {
  hass?: HomeAssistant;
  subscribeFn?: MockSubscribeFn;
}

export function renderWithHA(ui: ComponentChildren, options: RenderWithHAOptions = {}) {
  const {
    hass = makeHass(),
    subscribeFn = createMockSubscribe().subscribe,
    ...renderOptions
  } = options;

  function Wrapper({ children }: { children: ComponentChildren }) {
    return (
      <HAProvider hass={hass} subscribeToEntity={subscribeFn}>
        {children}
      </HAProvider>
    );
  }

  return {
    ...render(ui as any, { wrapper: Wrapper as any, ...renderOptions }),
    hass,
  };
}
