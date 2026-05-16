import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerPreactCard } from '../registerPreactCard';
import type { HomeAssistant } from '../types';

// Track renders and config
let lastConfig: any = undefined;
let renderCount = 0;

function TestComponent({ config }: { config: { entities: string[] } }) {
  renderCount++;
  lastConfig = config;
  return <div>test</div>;
}

function UnconfiguredComponent() {
  return <div>unconfigured</div>;
}

// Use a unique tag name per test to avoid collisions
let tagCounter = 0;
function uniqueType() {
  return `test-card-${++tagCounter}`;
}

function makeHass(states: Record<string, any>): HomeAssistant {
  return {
    states,
    config: {} as any,
    services: {} as any,
    connection: {} as any,
    callService: vi.fn(),
  };
}

describe('registerPreactCard', () => {
  beforeEach(() => {
    lastConfig = undefined;
    renderCount = 0;
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('registers the custom element and HA card entry', () => {
    const type = uniqueType();
    registerPreactCard({
      type,
      name: 'Test Card',
      description: 'A test card',
      Component: TestComponent,
    });

    expect(customElements.get(type)).toBeDefined();

    const win = window as any;
    expect(win.customCards).toContainEqual({
      type,
      name: 'Test Card',
      description: 'A test card',
    });
  });

  it('renders when both config and hass are set', () => {
    const type = uniqueType();
    registerPreactCard({
      type,
      name: 'Test',
      description: 'Test',
      Component: TestComponent,
    });

    const card = document.createElement(type) as any;
    document.body.appendChild(card);

    card.setConfig({ entities: ['sensor.temp'] });
    expect(renderCount).toBe(0); // no hass yet

    card.hass = makeHass({ 'sensor.temp': { state: '72' } });
    expect(renderCount).toBe(1);
    expect(lastConfig).toEqual({ entities: ['sensor.temp'] });
  });

  it('re-renders when config changes after hass is set', () => {
    const type = uniqueType();
    registerPreactCard({
      type,
      name: 'Test',
      description: 'Test',
      Component: TestComponent,
    });

    const card = document.createElement(type) as any;
    document.body.appendChild(card);

    card.setConfig({ entities: ['sensor.temp'] });
    card.hass = makeHass({ 'sensor.temp': { state: '72' } });
    expect(renderCount).toBe(1);

    card.setConfig({ entities: ['sensor.temp', 'sensor.humidity'] });
    expect(renderCount).toBe(2);
  });

  it('notifies entity subscribers when state changes', () => {
    const type = uniqueType();
    registerPreactCard({
      type,
      name: 'Test',
      description: 'Test',
      Component: TestComponent,
    });

    const card = document.createElement(type) as any;
    document.body.appendChild(card);

    card.setConfig({ entities: ['sensor.temp'] });

    // Access the subscribe function via the internal API
    const callback = vi.fn();
    card['_subscribeToEntity']('sensor.temp', callback);

    card.hass = makeHass({ 'sensor.temp': { state: '72' } });
    expect(callback).toHaveBeenCalledWith({ state: '72' });

    // Different state = notification
    callback.mockClear();
    card.hass = makeHass({ 'sensor.temp': { state: '73' } });
    expect(callback).toHaveBeenCalledWith({ state: '73' });
  });

  it('notifies for any subscribed entity (no _getEntityIds filter)', () => {
    const type = uniqueType();
    registerPreactCard({
      type,
      name: 'Test',
      description: 'Test',
      Component: TestComponent,
    });

    const card = document.createElement(type) as any;
    document.body.appendChild(card);

    card.setConfig({ entities: ['sensor.temp'] });

    // Subscribe to an entity NOT in config - should still get notified
    const callback = vi.fn();
    card['_subscribeToEntity']('sensor.other', callback);

    card.hass = makeHass({
      'sensor.temp': { state: '72' },
      'sensor.other': { state: 'on' },
    });

    expect(callback).toHaveBeenCalledWith({ state: 'on' });
  });

  it('clears all listeners on disconnect', () => {
    const type = uniqueType();
    registerPreactCard({
      type,
      name: 'Test',
      description: 'Test',
      Component: TestComponent,
    });

    const card = document.createElement(type) as any;
    document.body.appendChild(card);

    card.setConfig({ entities: ['sensor.temp'] });
    const callback = vi.fn();
    card['_subscribeToEntity']('sensor.temp', callback);

    card.hass = makeHass({ 'sensor.temp': { state: '72' } });
    expect(callback).toHaveBeenCalledTimes(1);

    card.disconnectedCallback();
    callback.mockClear();

    card.hass = makeHass({ 'sensor.temp': { state: '73' } });
    expect(callback).not.toHaveBeenCalled();
  });

  it('registers editor element when ConfigComponent is provided', () => {
    const type = uniqueType();
    function TestEditor() {
      return <div>editor</div>;
    }

    registerPreactCard({
      type,
      name: 'Test',
      description: 'Test',
      Component: TestComponent,
      ConfigComponent: TestEditor,
    });

    expect(customElements.get(`${type}-editor`)).toBeDefined();
  });

  it('returns stub config from getStubConfig', () => {
    const type = uniqueType();
    registerPreactCard({
      type,
      name: 'Test',
      description: 'Test',
      Component: TestComponent,
      getStubConfig: () => ({ entities: [] }),
    });

    const CardClass = customElements.get(type) as any;
    expect(CardClass.getStubConfig()).toEqual({ entities: [] });
  });
});
