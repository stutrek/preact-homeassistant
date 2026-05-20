import { act, render } from '@testing-library/preact';
import { useRef } from 'preact/hooks';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { type ElementSize, useResizeObserver } from '../useResizeObserver';

// jsdom doesn't implement ResizeObserver. Provide a controllable stub so we
// can drive size changes deterministically.
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

function Probe({
  callback,
  deps,
  initialWidth = 400,
  initialHeight = 80,
}: {
  callback: (size: ElementSize) => void;
  deps?: unknown[];
  initialWidth?: number;
  initialHeight?: number;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // Apply size to the element synchronously before useResizeObserver's effect
  // runs by relying on the callback ref pattern: the ref is populated before
  // useEffect fires.
  useResizeObserver(
    ref,
    (size) => {
      callback(size);
    },
    deps,
  );
  return (
    <div
      ref={(el) => {
        if (el) {
          ref.current = el;
          setSize(el, initialWidth, initialHeight);
        }
      }}
    />
  );
}

describe('useResizeObserver', () => {
  it('fires once with the current size after mount', () => {
    const cb = vi.fn();
    render(<Probe callback={cb} initialWidth={300} initialHeight={150} />);
    act(() => liveObservers[0].trigger());
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith({ width: 300, height: 150 });
  });

  it('fires again when the element resizes', () => {
    const cb = vi.fn();
    const { container } = render(<Probe callback={cb} />);
    act(() => liveObservers[0].trigger());
    cb.mockClear();

    const el = container.firstChild as HTMLElement;
    setSize(el, 500, 100);
    act(() => liveObservers[0].trigger());

    expect(cb).toHaveBeenCalledWith({ width: 500, height: 100 });
  });

  it('delivers zero dimensions to the callback (consumer decides)', () => {
    const cb = vi.fn();
    render(<Probe callback={cb} initialWidth={0} initialHeight={80} />);
    act(() => liveObservers[0].trigger());
    expect(cb).toHaveBeenCalledWith({ width: 0, height: 80 });
  });

  it('does not fire when the element is detached', () => {
    const cb = vi.fn();
    const { container, unmount } = render(<Probe callback={cb} />);
    const el = container.firstChild as HTMLElement;
    setSize(el, 400, 80);

    // Detach without unmounting Preact (simulates HA moving the host).
    el.remove();
    act(() => liveObservers[0]?.trigger());

    expect(cb).not.toHaveBeenCalled();
    unmount();
  });

  it('re-fires when deps change', () => {
    const cb = vi.fn();
    const { rerender } = render(<Probe callback={cb} deps={[1]} />);
    act(() => liveObservers[0].trigger());
    cb.mockClear();

    rerender(<Probe callback={cb} deps={[2]} />);
    expect(cb).toHaveBeenCalledWith({ width: 400, height: 80 });
  });

  it('does not re-fire on the mount run of the deps effect', () => {
    // The observer fires once on .observe(). The deps effect's first-mount run
    // must not double-fire with the same dimensions.
    const cb = vi.fn();
    render(<Probe callback={cb} deps={[1]} />);
    act(() => liveObservers[0].trigger());
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it('disconnects the observer on unmount', () => {
    const cb = vi.fn();
    const { unmount } = render(<Probe callback={cb} />);
    const observer = liveObservers[0];
    expect(observer.disconnect).not.toHaveBeenCalled();
    unmount();
    expect(observer.disconnect).toHaveBeenCalled();
  });
});
