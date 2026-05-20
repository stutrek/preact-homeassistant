---
name: preact-homeassistant
description: API usage patterns and gotchas for the preact-homeassistant library — building Home Assistant Lovelace cards as Preact components. Trigger when code imports from `preact-homeassistant`, when adding a new HA card or editor, or when the user mentions Home Assistant custom cards, Lovelace, or `registerPreactCard`.
---

# Using preact-homeassistant

`preact-homeassistant` wraps the boilerplate of building Home Assistant custom
cards: it registers the custom element, sets up Shadow DOM, injects styles, and
provides a Preact context so hooks can read `hass`. A card is a Preact
component plus one call to `registerPreactCard`.

This skill covers the gotchas a consumer hits regardless of project layout. For
the full API, see the package README.

## Preact, not React

- Use `class` not `className`. Use `onInput` not `onChange` for text fields.
- Don't import `react` or `react-dom`. The peer dep is `preact`.
- JSX renders Preact VNodes; HA's own web components (`<ha-card>`, `<ha-select>`, etc.) work directly as JSX tags.

## Card vs editor render targets

This is load-bearing and easy to get backwards:

- **Card `Component`** renders into the card's **Shadow DOM**. Registered styles are injected here.
- **`ConfigComponent`** (the editor) renders into the **light DOM**. HA's own elements (`<ha-select>`, `<ha-list-item>`, etc.) need this to position popups correctly.

Symptom of getting it backwards: select dropdowns render in the wrong place, styles bleed, or HA elements behave strangely in the editor.

## `registerPreactCard`

```ts
registerPreactCard<MyConfig>({
  type: 'my-card',              // becomes the custom-element tag
  name: 'My Card',
  description: 'shown in the picker',
  Component: MyCard,            // renders inside <ha-card> in shadow DOM
  ConfigComponent: MyCardEditor, // optional, registered as `${type}-editor`
  UnconfiguredComponent: MyEmpty, // optional, shown before hass/config arrive
  getStubConfig: () => ({ /* minimal valid config */ }),
});
```

The call has side effects (registers a custom element with the browser), so it
belongs at the top level of your card's entry file. Don't wrap it in
`useEffect` or call it conditionally.

## The `<ha-card>` wrapper

Wrap the card body in `<ha-card>` — HA's CSS expects it for borders, elevation,
and theming. Put padding inside `<div class="card-content">`:

```tsx
<ha-card>
  <div class="card-content">
    {/* your UI */}
  </div>
</ha-card>
```

## Hooks

### `useEntity(entityId)` — subscribed

Re-renders only when *that* entity's state changes. Return type narrows by
domain prefix:

- `'calendar.*'` → `CalendarEntity`
- `'weather.*'` → `WeatherEntity`
- `'sun.sun'` → `SunEntity`
- other domains → `HassEntity` (the loose type from `home-assistant-js-websocket`)

If you need strict types for a new domain (light, climate, media_player, etc.),
the package's domain types are intentionally minimal — you'd add a type file
under `src/types/` and extend `DomainEntityMap`. See the README's
"Contributing types" section.

### `useHass()` — unsubscribed

Use this when you need `hass` directly for config reads, or for service calls
that aren't tied to a single entity, but **don't want to re-render on every
entity change**:

```tsx
const { getHass } = useHass();
await getHass()?.callService('notify', 'mobile_app_phone', { message: 'hi' });
```

`getHass()` returns the current `hass` object (or `undefined` if not yet
connected). Don't destructure `hass` from `useHass()` and capture it in a
closure — it'll be stale. Always call `getHass()` at the call site.

For entity-targeted service calls, prefer `useService` (next section) — it's
typed and auto-injects `entity_id`.

### `useService(entityId)` — entity-targeted actions

Returns a stable function that calls services (HA "actions") on a specific
entity. The domain is parsed from the entity ID prefix and `entity_id` is
auto-injected — don't pass it yourself:

```tsx
const fanService = useService(config.entity); // entity is `fan.bedroom`
await fanService('turn_off');
await fanService('set_percentage', { percentage: 67 });
```

- Service name and data payload are strongly typed when the entity's domain is registered in `DomainServiceMap`. Currently only `fan` is mapped; adding more is the same pattern as `DomainEntityMap` (new file under `src/types/`, extend the map). PRs welcome.
- For unmapped domains, the service name is loosely typed as `string` and the data shape is `Record<string, unknown> | undefined`. Calls still work, you just lose autocomplete.
- The returned function is **stable across renders** — safe to pass to effects or memoized children without re-running.
- No-op (resolves to `void`) if `hass` is not yet connected or `entityId` is empty / has no domain prefix. Don't gate the call yourself.
- Returns `Promise<void>`. Service calls in HA don't return data; await it if you need to chain UI state after the call completes.

Don't pass `entity_id` in the data payload — it's already injected. Don't call
`useService` conditionally; it's a hook.

### Data hooks

- `useCalendarEvents(entityId, { start, end })` — events from one calendar.
- `useMultiCalendarEvents(entityIds, { start, end })` — events from many calendars; events come back with `calendarId` attached, cached in localStorage with debounced refetch on entity changes.
- `useWeatherForecast(entityId, type)` — `type` is `'daily' | 'hourly' | 'twice_daily'`. Cached in localStorage, auto-refetches at the top of each hour.
- `useCachedFetch(cacheKey, fetcher, deps)` — generic localStorage-cached fetcher; the domain hooks above are built on this.

All return `{ status, error, refetch, ...data }` where `status` is
`'loading' | 'cached' | 'ready' | 'refreshing'`. `'cached'` means data from
localStorage is showing while a fresh fetch is in flight — render it.

## Styles

Styles are registered globally via the `css\`\`` tagged template and injected
into each card's Shadow DOM at render time. The idiomatic pattern is a
side-effect import:

```ts
// MyCard.styles.ts
import { css } from 'preact-homeassistant';

css`
  .my-card { padding: 16px; color: var(--primary-text-color); }
`;
```

```tsx
// MyCard.tsx
import './MyCard.styles'; // side-effect import registers the styles
```

Do **not** put styles inside the component as a `<style>` tag — they won't
participate in the registry and won't get injected into other cards. Use
`registerRawStyles(cssString)` if you have CSS from a `?inline` Vite import.

### Theme variables

Use HA's CSS variables so cards adapt to the user's theme:

- `--primary-text-color`, `--secondary-text-color`
- `--primary-color`, `--accent-color`
- `--card-background-color`, `--ha-card-background`
- `--divider-color`

## HA element quirks

### `<ha-select>` in the editor

```tsx
<ha-select
  label="Entity"
  value={config.entity}
  naturalMenuWidth
  fixedMenuPosition
  onChange={(e) => onConfigChanged({ ...config, entity: (e.target as HTMLSelectElement).value })}
  onclosed={(e) => e.stopPropagation()}
>
  {entities.map((id) => (
    <ha-list-item key={id} value={id}>{label(id)}</ha-list-item>
  ))}
</ha-select>
```

- `naturalMenuWidth` + `fixedMenuPosition` make the dropdown size and position correctly.
- `onclosed={(e) => e.stopPropagation()}` is required — HA's `closed` event bubbles out of the editor and triggers scroll glitches in the dashboard editor.
- The event handler is lowercase `onclosed`, not `onClosed`, because it's a custom DOM event from the underlying web component.

## Shadow DOM portal gotcha

The card renders into Shadow DOM. Anything you render into `document.body`
(modals, full-page overlays, tooltips attached to body) **won't be styled by
your registered `css\`\``** because those styles live inside the shadow root.
Either render overlays inside the card tree or inject overlay styles into
`document.head` explicitly.

## Editor → card config flow

The editor must call `onConfigChanged(newConfig)` with the *complete* new
config (spread the old one):

```tsx
onConfigChanged({ ...config, entity: nextEntity });
```

HA persists the returned object as the card's YAML. Don't mutate `config` in
place.

## Don't

- Don't call `registerPreactCard` lazily — it must run at module load.
- Don't render the editor into the shadow root.
- Don't destructure `hass` from `useHass()` and reuse it across renders; call `getHass()` each time.
- Don't use `className` — it's `class`.
- Don't add a `<style>` tag inside the component; use the `css\`\`` registry.
