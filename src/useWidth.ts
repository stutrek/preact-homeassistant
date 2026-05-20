import type { RefObject } from 'preact';
import { useState } from 'preact/hooks';
import { useResizeObserver } from './useResizeObserver';

/**
 * Track the current width of a referenced element in CSS pixels.
 *
 * Returns `undefined` until the first non-zero measurement is observed, then
 * a positive number that updates as the element resizes. Once a real width
 * is captured the hook will never report `undefined` or `0` again, even
 * during HA layout transitions (dashboard switch, edit-mode toggle) — the
 * underlying ResizeObserver firings are silently dropped while the element
 * is detached or transiently zero-width, so the component renders with the
 * last good value instead of flashing through a degenerate state.
 *
 * Use this when you need a width value in JSX (responsive layout, prop to a
 * sized child). If you only need the value imperatively inside a draw
 * callback, prefer `useResizeObserver` directly — it doesn't allocate
 * component state or cause re-renders.
 *
 * @example
 * const ref = useRef<HTMLDivElement>(null);
 * const width = useWidth(ref);
 * return (
 *   <div ref={ref}>
 *     {width !== undefined && <Chart width={width} />}
 *   </div>
 * );
 */
export function useWidth<T extends HTMLElement>(ref: RefObject<T>): number | undefined {
  const [width, setWidth] = useState<number | undefined>(undefined);
  useResizeObserver(ref, (size) => {
    if (size.width === 0) return;
    setWidth((prev) => (prev === size.width ? prev : size.width));
  });
  return width;
}
