import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import { useContext, useEffect, useMemo, useRef, useState } from 'preact/hooks';

import { loadFromCache, saveToCache } from './cacheUtils';
import type {
  CalendarEvent,
  CalendarEventWithSource,
  EntityForId,
  FetchStatus,
  ForecastType,
  HomeAssistant,
  WeatherForecast,
} from './types';
import { useCallbackStable } from './useCallbackStable';

interface HAStore {
  hass: HomeAssistant | undefined;
  getHass: () => HomeAssistant | undefined;
  subscribeToEntity: (entityId: string, callback: (entity: any) => void) => () => void;
}

const HAContext = createContext<HAStore | null>(null);

interface HAProviderProps {
  hass: HomeAssistant | undefined;
  subscribeToEntity: (entityId: string, callback: (entity: any) => void) => () => void;
  children: ComponentChildren;
}

export function HAProvider({ hass, subscribeToEntity, children }: HAProviderProps) {
  const hassRef = useRef(hass);
  hassRef.current = hass;

  const getHass = useCallbackStable(() => hassRef.current);

  const store = useMemo<HAStore>(
    () => ({
      hass: hassRef.current,
      getHass,
      subscribeToEntity,
    }),
    [getHass, subscribeToEntity],
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
    const current = store.hass?.states[entityId] as EntityForId<T> | undefined;
    if (current) return current;
    return loadFromCache<EntityForId<T>>(cacheKey);
  });

  useEffect(() => {
    const unsubscribe = store.subscribeToEntity(entityId, (newEntity) => {
      setEntity(newEntity as EntityForId<T>);
      saveToCache(cacheKey, newEntity);
    });
    return unsubscribe;
  }, [entityId, store.subscribeToEntity, cacheKey]);

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
  const [data, setData] = useState<T | undefined>(() => loadFromCache<T>(cacheKey));
  const [isFresh, setIsFresh] = useState(false);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

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
        saveToCache(cacheKey, result);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  events: CalendarEvent[] | undefined;
  loading: boolean;
  error: Error | undefined;
  refetch: () => void;
}

/**
 * Fetch calendar events for a date range from a single calendar.
 */
export function useCalendarEvents(
  entityId: `calendar.${string}`,
  options: { start: Date; end: Date },
): UseCalendarEventsResult {
  const { getHass } = useHass();
  const [events, setEvents] = useState<CalendarEvent[] | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  const fetchIdRef = useRef(0);

  const fetchEvents = useCallbackStable(async () => {
    const hass = getHass();
    if (!hass?.connection) {
      setError(new Error('Home Assistant connection not available'));
      return;
    }

    const fetchId = ++fetchIdRef.current;
    setLoading(true);
    setError(undefined);

    try {
      const result = await hass.connection.sendMessagePromise<{
        response: { [entityId: string]: { events: CalendarEvent[] } };
      }>({
        type: 'call_service',
        domain: 'calendar',
        service: 'get_events',
        service_data: {
          start_date_time: options.start.toISOString(),
          end_date_time: options.end.toISOString(),
        },
        target: { entity_id: entityId },
        return_response: true,
      });

      if (fetchId === fetchIdRef.current) {
        const entityEvents = result.response?.[entityId]?.events ?? [];
        setEvents(entityEvents);
        setLoading(false);
      }
    } catch (err) {
      if (fetchId === fetchIdRef.current) {
        setError(err instanceof Error ? err : new Error(String(err)));
        setLoading(false);
      }
    }
  });

  useEffect(() => {
    fetchEvents();
  }, [entityId, options.start.getTime(), options.end.getTime(), fetchEvents]);

  return { events, loading, error, refetch: fetchEvents };
}

interface UseMultiCalendarEventsResult {
  events: CalendarEventWithSource[] | undefined;
  status: FetchStatus;
  error: Error | undefined;
  refetch: () => void;
}

/**
 * Fetch events from multiple calendars for a date range, with localStorage
 * caching. Events are tagged with their source calendar ID.
 */
export function useMultiCalendarEvents(
  entityIds: `calendar.${string}`[],
  options: { start: Date; end: Date },
): UseMultiCalendarEventsResult {
  const store = useHAStore();
  const { getHass } = useHass();

  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const entityIdsKey = entityIds.join(',');
  const dateRangeKey = `${options.start.getTime()}-${options.end.getTime()}`;
  const cacheKey = `events:${entityIdsKey}:${dateRangeKey}`;

  const fetcher = useCallbackStable(async () => {
    const hass = getHass();
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
              start_date_time: options.start.toISOString(),
              end_date_time: options.end.toISOString(),
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
  });

  const {
    data: events,
    status,
    error,
    refetch,
  } = useCachedFetch(cacheKey, fetcher, [entityIdsKey, dateRangeKey]);

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

  return { events, status, error, refetch };
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
