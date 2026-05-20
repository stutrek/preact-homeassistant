import type { RefObject } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export interface ElementSize {
  width: number;
  height: number;
}

export type ResizeCallback = (size: ElementSize) => void;

/**
 * Observe an element's size via ResizeObserver. The callback fires:
 *
 *   1. Once after mount, with the element's current size.
 *   2. Whenever the element's size changes.
 *   3. Whenever `deps` change, re-firing with the current size — so callers
 *      can re-run draws when their inputs change without re-creating the
 *      observer.
 *
 * The callback is suppressed only while the element is detached from the
 * document. Zero width/height is delivered to the callback as-is — consumers
 * that need to skip degenerate sizes (e.g. canvas painters where a 0-sized
 * drawImage throws InvalidStateError) should add their own early return.
 *
 * Sizes are read from `offsetWidth` / `offsetHeight` (CSS pixels, includes
 * padding + border). The callback is held in a ref, so passing a fresh
 * function each render is safe — it never re-creates the observer.
 *
 * @example
 * const containerRef = useRef<HTMLDivElement>(null);
 * const canvasRef = useRef<HTMLCanvasElement>(null);
 *
 * useResizeObserver(
 *   containerRef,
 *   ({ width, height }) => {
 *     if (width === 0 || height === 0) return; // optional, consumer's call
 *     drawChart(canvasRef.current, forecast, width, height);
 *   },
 *   [forecast],
 * );
 */
export function useResizeObserver<T extends HTMLElement>(
  ref: RefObject<T>,
  callback: ResizeCallback,
  deps: unknown[] = [],
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  // Set up the observer once per element. ResizeObserver fires once
  // synchronously-ish after `.observe()` with the current size, which
  // covers the initial draw.
  useEffect(() => {
    const element = ref.current;
    if (!element) return;

    const fire = () => {
      if (!element.isConnected) return;
      callbackRef.current({
        width: element.offsetWidth,
        height: element.offsetHeight,
      });
    };

    const observer = new ResizeObserver(fire);
    observer.observe(element);
    return () => observer.disconnect();
    // ref identity is stable across renders; observer setup runs once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-fire on dependency change. Skip the first render — the observer's
  // initial `.observe()` fire already delivers the mount-time size.
  const isFirstRun = useRef(true);
  useEffect(() => {
    if (isFirstRun.current) {
      isFirstRun.current = false;
      return;
    }
    const element = ref.current;
    if (!element || !element.isConnected) return;
    callbackRef.current({
      width: element.offsetWidth,
      height: element.offsetHeight,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
