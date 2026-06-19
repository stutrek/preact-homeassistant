import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { type Cache, readCache, writeCache } from './cacheUtils';
import type {
  CalendarEvent,
  CalendarEventWithSource,
  EntityForId,
  FetchStatus,
  ForecastType,
  HomeAssistant,
  ServicesForId,
  WeatherForecast,
} from './types';
import { useCallbackStable } from './useCallbackStable';

type SubscribeToHass = (callback: () => void) => () => void;

// Default for providers that don't wire up hass-value notifications (Storybook,
// tests). useHassValue then simply returns its initial value and never updates.
const noopSubscribeToHass: SubscribeToHass = () => () => {};

interface HAStore {
  getHass: () => HomeAssistant | undefined;
  subscribeToEntity: (entityId: string, callback: (entity: any) => void) => () => void;
  subscribeToHass: SubscribeToHass;
  // Per-card cache (events, forecasts, entities). Owned by the provider so its
  // lifetime is the card's — GC'd with the store when the card is torn down.
  cache: Cache;
}

const HAContext = createContext<HAStore | null>(null);

interface HAProviderProps {
  hass: HomeAssistant | undefined;
  subscribeToEntity: (entityId: string, callback: (entity: any) => void) => () => void;
  subscribeToHass?: SubscribeToHass;
  // Optional injected cache (tests seed/inspect it); defaults to a fresh
  // per-provider Map held stable across re-renders.
  cache?: Cache;
  children: ComponentChildren;
}

export function HAProvider({
  hass,
  subscribeToEntity,
  subscribeToHass,
  cache,
  children,
}: HAProviderProps) {
  const hassRef = useRef(hass);
  hassRef.current = hass;

  const getHass = useCallbackStable(() => hassRef.current);

  const cacheRef = useRef<Cache>();
  if (!cacheRef.current) cacheRef.current = cache ?? new Map();

  const resolvedSubscribeToHass = subscribeToHass ?? noopSubscribeToHass;

  const store = useMemo<HAStore>(
    () => ({
      getHass,
      subscribeToEntity,
      subscribeToHass: resolvedSubscribeToHass,
      cache: cacheRef.current!,
    }),
    [getHass, subscribeToEntity, resolvedSubscribeToHass],
  );

  return <HAContext.Provider value={store}>{children}</HAContext.Provider>;
}

function useHAStore(): HAStore {
  const store = useContext(HAContext);
  if (!store) {
    throw new Error('useEntity/useHass must be used within an HAProvider');
  }
  return store;
}

/**
 * Subscribe to a specific entity by ID. Re-renders only when that entity changes.
 *
 * Returns a typed entity based on the domain prefix:
 *   - 'calendar.xyz' -> CalendarEntity
 *   - 'weather.xyz' -> WeatherEntity
 *   - 'sun.sun'     -> SunEntity
 *   - other domains -> HassEntity (fallback)
 */
export function useEntity<T extends string>(entityId: T): EntityForId<T> | undefined {
  const store = useHAStore();
  const cacheKey = `entity:${entityId}`;

  const [entity, setEntity] = useState<EntityForId<T> | undefined>(() => {
    const current = store.getHass()?.states[entityId] as EntityForId<T> | undefined;
    if (current) return current;
    return readCache<EntityForId<T>>(store.cache, cacheKey);
  });

  useEffect(() => {
    const unsubscribe = store.subscribeToEntity(entityId, (newEntity) => {
      setEntity(newEntity as EntityForId<T>);
      writeCache(store.cache, cacheKey, newEntity);
    });
    return unsubscribe;
  }, [entityId, store.subscribeToEntity, store.cache, cacheKey]);

  return entity;
}

/**
 * Get access to the full hass object for calling services / accessing config.
 * Does NOT re-render on entity changes. Use useEntity for that.
 */
export function useHass(): { getHass: () => HomeAssistant | undefined } {
  const store = useHAStore();
  return { getHass: store.getHass };
}

/**
 * Subscribe to a derived slice of the `hass` object (e.g. config, themes) and
 * re-render only when that slice changes. Use this for non-entity values —
 * entity state goes through `useEntity`. The selector runs on every hass update
 * but only re-renders the consumer when `isEqual` reports a change, so it's
 * cheap for rarely-changing values like config/themes.
 */
export function useHassValue<T>(
  selector: (hass: HomeAssistant | undefined) => T,
  isEqual: (a: T, b: T) => boolean = Object.is,
): T {
  const store = useHAStore();

  const selectorRef = useRef(selector);
  selectorRef.current = selector;
  const isEqualRef = useRef(isEqual);
  isEqualRef.current = isEqual;

  const [value, setValue] = useState<T>(() => selectorRef.current(store.getHass()));

  useEffect(() => {
    const unsubscribe = store.subscribeToHass(() => {
      const next = selectorRef.current(store.getHass());
      setValue((prev) => (isEqualRef.current(prev, next) ? prev : next));
    });
    return unsubscribe;
  }, [store.subscribeToHass, store.getHass]);

  return value;
}

/** Re-renders when `hass.config` changes (units, latitude/longitude, etc.). */
export function useHassConfig(): HomeAssistant['config'] | undefined {
  return useHassValue((hass) => hass?.config);
}

/** Re-renders when the active theme's dark mode flips. */
export function useDarkMode(): boolean {
  return useHassValue((hass) => hass?.themes?.darkMode ?? false);
}

type ServiceCaller<T extends string> = <S extends keyof ServicesForId<T> & string>(
  service: S,
  ...args: ServicesForId<T>[S] extends undefined
    ? []
    : Record<string, never> extends Exclude<ServicesForId<T>[S], undefined>
      ? [data?: ServicesForId<T>[S]]
      : [data: ServicesForId<T>[S]]
) => Promise<void>;

/**
 * Returns a stable function that calls services on a specific HA entity.
 * The service domain is parsed from the entity ID prefix and `entity_id` is
 * auto-injected into every call. Service names and data shapes are strongly
 * typed via DomainServiceMap when the domain is registered. No-ops if hass
 * is not yet available or the entity ID is empty.
 *
 *   const fanService = useService(config.entity);   // `fan.${string}`
 *   await fanService('turn_off');
 *   await fanService('set_percentage', { percentage: 67 });
 */
export function useService<T extends string>(entityId: T): ServiceCaller<T> {
  const { getHass } = useHass();
  return useCallbackStable(((service: string, data?: object) => {
    const hass = getHass();
    if (!hass || !entityId.includes('.')) return Promise.resolve();
    const domain = entityId.split('.', 1)[0];
    return hass.callService(domain, service, { entity_id: entityId, ...data });
  }) as ServiceCaller<T>);
}

interface UseCachedFetchResult<T> {
  data: T | undefined;
  status: FetchStatus;
  error: Error | undefined;
  refetch: () => void;
}

/**
 * Generic hook for fetching data with localStorage caching. Returns a cache-aware
 * status string to distinguish cached vs fresh data.
 */
export function useCachedFetch<T>(
  cacheKey: string,
  fetcher: () => Promise<T>,
  deps: unknown[],
): UseCachedFetchResult<T> {
  const store = useHAStore();
  const [data, setData] = useState<T | undefined>(() => readCache<T>(store.cache, cacheKey));
  const [isFresh, setIsFresh] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Stale-while-revalidate, key-change aware. When `cacheKey` changes we swap to
  // the new key's cached value synchronously (SWR hit) or keep the previously
  // rendered data (keep-previous-data on a cold key) — never blanking to a
  // loading state. The `deps` effect below issues the background refetch; the
  // only `'loading'` state is a true cold start (nothing cached, nothing fetched).
  const dataKeyRef = useRef(cacheKey);
  if (cacheKey !== dataKeyRef.current) {
    dataKeyRef.current = cacheKey;
    setIsFresh(false);
    setError(undefined);
    const cached = readCache<T>(store.cache, cacheKey);
    if (cached !== undefined) setData(cached);
    // cache miss: leave `data` as-is (keep-previous-data)
  }

  const fetchIdRef = useRef(0);

  const doFetch = useCallbackStable(async () => {
    const fetchId = ++fetchIdRef.current;
    setIsFetching(true);
    setError(undefined);

    try {
      const result = await fetcher();
      if (fetchId === fetchIdRef.current) {
        setData(result);
        setIsFresh(true);
        writeCache(store.cache, cacheKey, result);
      }
    } catch (err) {
      if (fetchId === fetchIdRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
      }
    } finally {
      if (fetchId === fetchIdRef.current) {
        setIsFetching(false);
      }
    }
  });

  useEffect(() => {
    doFetch();
  }, deps);

  const status: FetchStatus = useMemo(() => {
    if (!data && isFetching) return 'loading';
    if (data && !isFresh && isFetching) return 'cached';
    if (data && isFresh && isFetching) return 'refreshing';
    return 'ready';
  }, [data, isFresh, isFetching]);

  return { data, status, error, refetch: doFetch };
}

interface UseCalendarEventsResult {
  events: CalendarEventWithSource[] | undefined;
  status: FetchStatus;
  error: Error | undefined;
  refetch: () => void;
  /**
   * Warm the cache for an arbitrary range (e.g. adjacent months) without
   * touching component state. Best-effort: skips ranges already cached and
   * swallows failures.
   */
  prefetch: (range: { start: Date; end: Date }) => void;
}

function calendarEventsCacheKey(
  entityIds: `calendar.${string}`[],
  range: { start: Date; end: Date },
): string {
  return `events:${entityIds.join(',')}:${range.start.getTime()}-${range.end.getTime()}`;
}

async function fetchCalendarRange(
  hass: HomeAssistant | undefined,
  entityIds: `calendar.${string}`[],
  range: { start: Date; end: Date },
): Promise<CalendarEventWithSource[]> {
  if (!hass?.connection) {
    throw new Error('Home Assistant connection not available');
  }
  if (entityIds.length === 0) {
    return [];
  }

  const results = await Promise.all(
    entityIds.map(async (entityId) => {
      try {
        const result = await hass.connection.sendMessagePromise<{
          response: { [key: string]: { events: CalendarEvent[] } };
        }>({
          type: 'call_service',
          domain: 'calendar',
          service: 'get_events',
          service_data: {
            start_date_time: range.start.toISOString(),
            end_date_time: range.end.toISOString(),
          },
          target: { entity_id: entityId },
          return_response: true,
        });

        const calendarEvents = result.response?.[entityId]?.events ?? [];
        return calendarEvents.map(
          (event): CalendarEventWithSource => ({ ...event, calendarId: entityId }),
        );
      } catch (err) {
        console.error(`Failed to fetch events for ${entityId}:`, err);
        return [];
      }
    }),
  );

  return results.flat();
}

/**
 * Fetch events from one or more calendars for a date range, with in-memory
 * (per-card) caching and stale-while-revalidate behavior. Events are tagged
 * with their source calendar ID. Returns `prefetch` to warm adjacent ranges.
 */
export function useCalendarEvents(
  entityIds: `calendar.${string}`[],
  options: { start: Date; end: Date },
): UseCalendarEventsResult {
  const store = useHAStore();
  const { getHass } = useHass();

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entityIdsKey = entityIds.join(',');
  const dateRangeKey = `${options.start.getTime()}-${options.end.getTime()}`;
  const cacheKey = `events:${entityIdsKey}:${dateRangeKey}`;

  const fetcher = useCallbackStable(() => fetchCalendarRange(getHass(), entityIds, options));

  const {
    data: events,
    status,
    error,
    refetch,
  } = useCachedFetch(cacheKey, fetcher, [entityIdsKey, dateRangeKey]);

  const prefetch = useCallbackStable((range: { start: Date; end: Date }) => {
    const key = calendarEventsCacheKey(entityIds, range);
    if (store.cache.has(key)) return; // already warm
    fetchCalendarRange(getHass(), entityIds, range)
      .then((result) => writeCache(store.cache, key, result))
      .catch(() => {
        // best-effort prefetch; ignore failures
      });
  });

  const debouncedRefetch = useCallbackStable(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => refetch(), 500);
  });

  useEffect(() => {
    const unsubscribes = entityIds.map((entityId) =>
      store.subscribeToEntity(entityId, debouncedRefetch),
    );
    return () => {
      unsubscribes.forEach((unsub) => unsub());
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [entityIdsKey, store.subscribeToEntity, debouncedRefetch]);

  return { events, status, error, refetch, prefetch };
}

interface UseWeatherForecastResult {
  forecast: WeatherForecast[] | undefined;
  status: FetchStatus;
  error: Error | undefined;
  refetch: () => void;
}

/**
 * Fetch weather forecast data with localStorage caching. Auto-refetches at the
 * top of each hour and when the underlying entity changes (debounced).
 */
export function useWeatherForecast(
  entityId: `weather.${string}`,
  type: ForecastType,
): UseWeatherForecastResult {
  const store = useHAStore();
  const { getHass } = useHass();
  const cacheKey = `forecast:${entityId}:${type}`;

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hourlyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetcher = useCallbackStable(async () => {
    const hass = getHass();
    if (!hass?.connection) {
      throw new Error('Home Assistant connection not available');
    }

    const result = await hass.connection.sendMessagePromise<{
      response: { [entityId: string]: { forecast: WeatherForecast[] } };
    }>({
      type: 'call_service',
      domain: 'weather',
      service: 'get_forecasts',
      service_data: { type },
      target: { entity_id: entityId },
      return_response: true,
    });

    return result.response?.[entityId]?.forecast ?? [];
  });

  const {
    data: forecast,
    status,
    error,
    refetch,
  } = useCachedFetch(cacheKey, fetcher, [entityId, type]);

  const debouncedRefetch = useCallbackStable(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => refetch(), 500);
  });

  const scheduleHourlyRefetch = useCallbackStable(() => {
    if (hourlyTimerRef.current) {
      clearTimeout(hourlyTimerRef.current);
    }
    const now = new Date();
    const nextHour = new Date(now);
    nextHour.setHours(now.getHours() + 1, 0, 0, 0);
    const msUntilNextHour = nextHour.getTime() - now.getTime();

    hourlyTimerRef.current = setTimeout(() => {
      refetch();
      scheduleHourlyRefetch();
    }, msUntilNextHour);
  });

  useEffect(() => {
    scheduleHourlyRefetch();
  }, [entityId, type, scheduleHourlyRefetch]);

  useEffect(() => {
    const unsubscribe = store.subscribeToEntity(entityId, debouncedRefetch);
    return () => {
      unsubscribe();
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (hourlyTimerRef.current) {
        clearTimeout(hourlyTimerRef.current);
      }
    };
  }, [entityId, store.subscribeToEntity, debouncedRefetch]);

  return { forecast, status, error, refetch };
}
