# preact-homeassistant

Preact hooks and helpers for building Home Assistant custom cards. Handles the
web-component lifecycle, Shadow DOM, entity subscriptions, and data fetching so
you can focus on your card's UI.

## Install

```bash
pnpm add preact preact-homeassistant
```

`preact` is a peer dependency.

## Quick start

```tsx
import { registerPreactCard, useEntity, css } from 'preact-homeassistant';

css`
  .my-card { padding: 16px; }
  .my-card .temperature { font-size: 2em; }
`;

function MyCardContent({ config }: { config: { entity: string } }) {
  const weather = useEntity(config.entity);

  return (
    <ha-card>
      <div class="card-content my-card">
        <span class="temperature">{weather?.state ?? '...'}</span>
      </div>
    </ha-card>
  );
}

function MyCardEditor({ hass, config, onConfigChanged }) {
  const entities = Object.keys(hass.states).filter((e) => e.startsWith('weather.'));

  return (
    <div style={{ padding: '16px' }}>
      <ha-select
        label="Weather entity"
        value={config.entity}
        naturalMenuWidth
        fixedMenuPosition
        onChange={(e) => onConfigChanged({ ...config, entity: (e.target as HTMLSelectElement).value })}
        onclosed={(e) => e.stopPropagation()}
      >
        {entities.map((id) => (
          <ha-list-item key={id} value={id}>
            {hass.states[id]?.attributes?.friendly_name ?? id}
          </ha-list-item>
        ))}
      </ha-select>
    </div>
  );
}

registerPreactCard({
  type: 'my-weather-card',
  name: 'My Weather Card',
  description: 'A simple weather card',
  Component: MyCardContent,
  ConfigComponent: MyCardEditor,
  getStubConfig: () => ({ entity: '' }),
});
```

That's it. `registerPreactCard` creates the web component, registers the custom
element with Home Assistant, sets up Shadow DOM, injects registered styles, and
wraps your component in the data provider. Your component receives `config` as a
prop and uses hooks for everything else.

## `registerPreactCard(options)`

| Option | Type | Required | Description |
|---|---|---|---|
| `type` | `string` | Yes | Custom element tag name (e.g. `'my-weather-card'`) |
| `name` | `string` | Yes | Display name in the HA card picker |
| `description` | `string` | Yes | Description in the HA card picker |
| `Component` | `ComponentType<{ config: T }>` | Yes | Main card Preact component |
| `ConfigComponent` | `ComponentType<{ hass, config, onConfigChanged }>` | No | Visual editor. Receives `hass`, the current `config`, and an `onConfigChanged` callback. Registered as `${type}-editor`. |
| `UnconfiguredComponent` | `ComponentType<{}>` | No | Shown before config/hass are available |
| `getStubConfig` | `() => Partial<T>` | No | Default config for the card picker |

The card renders into a Shadow DOM root. The editor renders into the light DOM
(required for HA's own custom elements like `<ha-select>` to work).

## Hooks

### `useEntity(entityId)`

Subscribe to a specific entity. Only re-renders when that entity's state changes.

```tsx
const sensor = useEntity('sensor.temperature');
// sensor?.state === '72'
```

Returns a strict type based on the domain prefix:
- `'calendar.*'` → `CalendarEntity`
- `'weather.*'` → `WeatherEntity`
- `'sun.sun'` → `SunEntity`
- `'fan.*'` → `FanEntity`
- Other domains → `HassEntity` (the loose type from `home-assistant-js-websocket`)

The mapping comes from the `DomainEntityMap` interface. To add a new domain,
see the *Contributing types* section below.

### `useService(entityId)`

Returns a stable function that calls services on a specific entity. The
service domain is parsed from the entity ID prefix and `entity_id` is
auto-injected into every call. Service names and data shapes are
strongly typed via `DomainServiceMap` when the domain is registered.

```tsx
const fanService = useService(config.entity);   // config.entity: `fan.${string}`
await fanService('toggle');                     // entity_id auto-injected
await fanService('set_percentage', { percentage: 67 });
```

For registered domains (currently `fan`), TypeScript autocompletes service
names and validates the data shape. For other domains the hook still works,
just without per-service autocomplete — useful for ad-hoc calls until the
domain is added to `DomainServiceMap`.

The returned function is a no-op if the entity ID is empty (common while the
card config is being set up) or if `hass` isn't connected yet.

### `useHass()`

Access the full `hass` object for reading config or making service calls that
`useService` doesn't cover (different entity per call, no entity, custom
`return_response`, etc.). Does not re-render on entity changes.

```tsx
const { getHass } = useHass();
await getHass()?.callService('script', 'morning_routine');
```

### `useCalendarEvents(entityId, { start, end })`

Fetch calendar events for a date range from a single calendar.

### `useMultiCalendarEvents(entityIds, { start, end })`

Fetch events from multiple calendars. Events are returned with `calendarId`
attached. Caches to localStorage and debounce-refetches when entities change.

```tsx
const { events, status, error, refetch } = useMultiCalendarEvents(
  ['calendar.family', 'calendar.work'],
  { start, end },
);
// status: 'loading' | 'cached' | 'ready' | 'refreshing'
```

### `useWeatherForecast(entityId, type)`

Fetch weather forecast data. Caches to localStorage, debounce-refetches on
entity changes, and auto-refetches at the top of each hour.

```tsx
const { forecast, status, error, refetch } = useWeatherForecast('weather.home', 'hourly');
```

### `useCachedFetch(cacheKey, fetcher, deps)`

Generic hook for fetching data with localStorage caching. The domain-specific
hooks above are built on this.

## Styles

Styles are registered globally via the `css\`\`` tagged template and
auto-injected into each card's Shadow DOM by `registerPreactCard`. Use
`.styles.ts` files imported as side effects.

```tsx
// MyCard.styles.ts
import { css } from 'preact-homeassistant';

css`
  .my-card { padding: 16px; }
`;

// MyCard.tsx
import './MyCard.styles'; // registers styles on import
```

### `registerRawStyles(cssString)`

Register a raw CSS string, e.g. from a Vite `?inline` import.

## Cache utilities

`loadFromCache(key)` / `saveToCache(key, data)` — localStorage wrapper with
24-hour expiry. Used internally by the data hooks.

## Other utilities

### `useCallbackStable(fn)`

Returns a stable callback ref that always calls the latest `fn`. Avoids effect
re-runs while keeping the closure current.

## Types

All HA domain types live in [`src/types/`](src/types/):

- [`calendar.ts`](src/types/calendar.ts) — `CalendarEntity`, `CalendarEvent`, `CalendarEventWithSource`
- [`weather.ts`](src/types/weather.ts) — `WeatherEntity`, `WeatherForecast`, `ForecastType`
- [`sun.ts`](src/types/sun.ts) — `SunEntity`
- [`fan.ts`](src/types/fan.ts) — `FanEntity`, `FanServices`
- [`common.ts`](src/types/common.ts) — `HomeAssistant`, `FetchStatus`
- [`index.ts`](src/types/index.ts) — `DomainEntityMap`, `EntityForId<T>`, `DomainServiceMap`, `ServicesForId<T>`

Re-exported from the package root:

```ts
import type {
  HomeAssistant,
  CalendarEntity,
  WeatherEntity,
  SunEntity,
  FanEntity,
  FanServices,
  WeatherForecast,
  EntityForId,
  DomainEntityMap,
  DomainServiceMap,
  ServicesForId,
  /* ... */
} from 'preact-homeassistant';
```

## Contributing types

The HA domain types in this package are intentionally minimal — only the
domains the maintainers have actually needed. If your card needs strict types
for another domain (light, climate, media_player, cover, etc.), PRs are very
welcome.

1. Look up the domain in the [Home Assistant frontend repo](https://github.com/home-assistant/frontend/tree/dev/src/data) — most domains have a `data/<domain>.ts` file with TypeScript types.
2. Add `src/types/<domain>.ts`. Include an entity interface that extends `HassEntityBase` / `HassEntityAttributeBase` from `home-assistant-js-websocket`, plus a services interface mapping each service name to its data shape (or `undefined` for services that take no payload beyond `entity_id`). See [`src/types/fan.ts`](src/types/fan.ts) for the shape.
3. In [`src/types/index.ts`](src/types/index.ts), add the entity to `DomainEntityMap` and the services to `DomainServiceMap`, and re-export the new types.
4. Add a quick test under `src/__tests__/` if you're feeling thorough.
5. PR.

Both the entity types and the service types are opt-in: until a domain
appears in `DomainEntityMap`, `useEntity('light.foo')` falls back to
`HassEntity`; until it appears in `DomainServiceMap`, `useService('light.foo')`
still works but without per-service autocomplete.

We err toward including only fields that are well-documented; speculative
attributes can land later.

## Development

```bash
pnpm install
pnpm test       # vitest run
pnpm build      # tsc --noEmit && vite build
pnpm lint       # biome check
```

## Publishing

Releases are published to npm manually from a local machine (no CI publish):

```bash
pnpm test && pnpm build && pnpm typecheck
git tag v0.X.Y && git push origin v0.X.Y
pnpm publish --access public --provenance
```

The `--provenance` flag attaches SLSA build attestation. A GitHub release with
release notes + the packaged tarball is created automatically when the tag is
pushed (see [`.github/workflows/release.yml`](.github/workflows/release.yml)).

## License

MIT
