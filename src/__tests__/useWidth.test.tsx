import { act, render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWidth } from '../useWidth';

// Controllable ResizeObserver stub (same shape as useResizeObserver.test).
type StubObserver = {
  observe: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  trigger: () => void;
};
const liveObservers: StubObserver[] = [];

beforeEach(() => {
  liveObservers.length = 0;
  (globalThis as any).ResizeObserver = class {
    private cb: () => void;
    public observe: any;
    public disconnect: any;
    constructor(cb: () => void) {
      this.cb = cb;
      this.observe = vi.fn();
      this.disconnect = vi.fn(() => {
        const idx = liveObservers.findIndex((o) => o.observe === this.observe);
        if (idx !== -1) liveObservers.splice(idx, 1);
      });
      liveObservers.push({
        observe: this.observe,
        disconnect: this.disconnect,
        trigger: () => this.cb(),
      });
    }
  };
});

afterEach(() => {
  (globalThis as any).ResizeObserver = undefined;
  document.body.innerHTML = '';
});

function setSize(el: HTMLElement, width: number, height: number) {
  Object.defineProperty(el, 'offsetWidth', { configurable: true, value: width });
  Object.defineProperty(el, 'offsetHeight', { configurable: true, value: height });
}

let lastWidth: number | undefined;

function Probe({ initialWidth = 400 }: { initialWidth?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  lastWidth = useWidth(ref);
  return (
    <div
      ref={(el) => {
        if (el) {
          ref.current = el;
          setSize(el, initialWidth, 80);
        }
      }}
    />
  );
}

describe('useWidth', () => {
  beforeEach(() => {
    lastWidth = undefined;
  });

  it('returns undefined until the first measurement', () => {
    render(<Probe />);
    expect(lastWidth).toBeUndefined();
  });

  it('returns the observed width after the first non-zero measurement', () => {
    const { container } = render(<Probe initialWidth={400} />);
    act(() => liveObservers[0].trigger());
    expect(lastWidth).toBe(400);

    const el = container.firstChild as HTMLElement;
    setSize(el, 500, 80);
    act(() => liveObservers[0].trigger());
    expect(lastWidth).toBe(500);
  });

  it('ignores zero-width measurements (keeps last good value)', () => {
    const { container } = render(<Probe initialWidth={400} />);
    act(() => liveObservers[0].trigger());
    expect(lastWidth).toBe(400);

    const el = container.firstChild as HTMLElement;
    setSize(el, 0, 80);
    act(() => liveObservers[0].trigger());
    expect(lastWidth).toBe(400);

    setSize(el, 450, 80);
    act(() => liveObservers[0].trigger());
    expect(lastWidth).toBe(450);
  });

  it('does not update while the element is detached', () => {
    const { container } = render(<Probe initialWidth={400} />);
    act(() => liveObservers[0].trigger());
    expect(lastWidth).toBe(400);

    const el = container.firstChild as HTMLElement;
    el.remove();
    setSize(el, 999, 80);
    act(() => liveObservers[0]?.trigger());
    expect(lastWidth).toBe(400);
  });
});
