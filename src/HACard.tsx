import { type ComponentChildren, createElement } from 'preact';

// `align` controls how content sits within the height HA assigns. Friendly
// aliases map to flex justify-content; any raw flex value also passes through.
// Default 'top' keeps content compact at the top (today's look, but the card
// box now fills the slot). Use 'center', 'bottom', or 'space-between' to spread.
export type HACardAlign =
  | 'top'
  | 'center'
  | 'bottom'
  | 'flex-start'
  | 'flex-end'
  | 'space-between'
  | 'space-around'
  | 'space-evenly';

const ALIGN_ALIASES: Record<string, string> = { top: 'flex-start', bottom: 'flex-end' };

interface HACardProps {
  align?: HACardAlign;
  class?: string;
  children?: ComponentChildren;
}

// Drop-in replacement for a raw <ha-card> that fills the height Home Assistant
// assigns. In the sections (grid) layout HA gives the card's host element a
// definite height; a plain ha-card collapses to natural content height and
// renders slightly short. HACard makes the host and ha-card fill that height
// and flex-distributes content per `align`.
//
// `ha-card` is created via createElement (rather than as a JSX intrinsic) so
// the component carries no dependency on consumers declaring it in their JSX
// IntrinsicElements — it just works when imported.
export function HACard({ align = 'top', class: className, children }: HACardProps) {
  const justify = ALIGN_ALIASES[align] ?? align;
  return (
    <>
      {/* Host must have a definite height for ha-card's 100% to resolve. In
          masonry/auto-row layouts the parent height is auto, so this safely
          collapses back to natural height. */}
      <style>{':host{display:block;height:100%;box-sizing:border-box;}'}</style>
      {createElement(
        'ha-card',
        {
          class: className,
          style: {
            height: '100%',
            boxSizing: 'border-box',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: justify,
          },
        },
        children,
      )}
    </>
  );
}
