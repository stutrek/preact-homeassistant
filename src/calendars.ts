import { useEffect, useRef } from 'preact/hooks';

import { useCachedFetch, useHAStore, useHass } from './HAContext';
import { writeCache } from './cacheUtils';
import { readPersisted, writePersisted } from './persistentCache';
import type { CalendarEvent, CalendarEventWithSource, FetchStatus, HomeAssistant } from './types';
import { useCallbackStable } from './useCallbackStable';

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

/**
 * Persistent (localStorage) key for one calendar's events over a range. Stored
 * per entity rather than per entity set, so any combination of calendars —
 * across cards, or the same card's regular vs highlight calendars — shares it.
 */
function entityEventsPersistKey(
  entityId: `calendar.${string}`,
  range: { start: Date; end: Date },
): string {
  return `events:${entityId}:${range.start.getTime()}-${range.end.getTime()}`;
}

/** Assemble a range from persisted per-entity entries; undefined unless all are present. */
function readPersistedRange(
  entityIds: `calendar.${string}`[],
  range: { start: Date; end: Date },
): CalendarEventWithSource[] | undefined {
  if (entityIds.length === 0) return undefined;
  const result: CalendarEventWithSource[] = [];
  for (const entityId of entityIds) {
    const events = readPersisted<CalendarEvent[]>(entityEventsPersistKey(entityId, range));
    if (!events) return undefined;
    for (const event of events) result.push({ ...event, calendarId: entityId });
  }
  return result;
}

/** Event shape returned by the REST view GET /api/calendars/{entity_id}. */
interface ApiCalendarEvent {
  summary: string;
  description?: string | null;
  location?: string | null;
  uid?: string | null;
  recurrence_id?: string | null;
  rrule?: string | null;
  start: { dateTime?: string; date?: string };
  end: { dateTime?: string; date?: string };
}

/** Flatten the REST API's {dateTime}/{date} start/end into our string form. */
function apiDateString(value: { dateTime?: string; date?: string }): string {
  return value.dateTime ?? value.date ?? '';
}

async function fetchEntityEventsRest(
  hass: HomeAssistant,
  entityId: `calendar.${string}`,
  range: { start: Date; end: Date },
): Promise<CalendarEvent[]> {
  const query =
    `start=${encodeURIComponent(range.start.toISOString())}` +
    `&end=${encodeURIComponent(range.end.toISOString())}`;
  const apiEvents = await hass.callApi!<ApiCalendarEvent[]>(
    'GET',
    `calendars/${entityId}?${query}`,
  );
  return apiEvents.map((event) => ({
    start: apiDateString(event.start),
    end: apiDateString(event.end),
    summary: event.summary,
    ...(event.description != null && { description: event.description }),
    ...(event.location != null && { location: event.location }),
    ...(event.uid != null && { uid: event.uid }),
    ...(event.recurrence_id != null && { recurrence_id: event.recurrence_id }),
    ...(event.rrule != null && { rrule: event.rrule }),
  }));
}

async function fetchEntityEventsWs(
  hass: HomeAssistant,
  entityId: `calendar.${string}`,
  range: { start: Date; end: Date },
): Promise<CalendarEvent[]> {
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

  return result.response?.[entityId]?.events ?? [];
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
        // Prefer the REST view: unlike the calendar.get_events service
        // response (filtered to LIST_EVENT_FIELDS in HA core), it includes
        // uid/recurrence_id/rrule. The WS service call remains as a fallback
        // for environments without callApi (test mocks, Storybook).
        const calendarEvents = hass.callApi
          ? await fetchEntityEventsRest(hass, entityId, range)
          : await fetchEntityEventsWs(hass, entityId, range);
        // Persist only successful fetches; a failure must not cache as "no events".
        writePersisted(entityEventsPersistKey(entityId, range), calendarEvents);
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
 * (per-card) caching and stale-while-revalidate behavior. Each calendar's
 * events are also persisted to localStorage per entity, so a reload renders
 * immediately. Events are tagged with their source calendar ID. Returns
 * `prefetch` to warm adjacent ranges.
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
  } = useCachedFetch(cacheKey, fetcher, [entityIdsKey, dateRangeKey], {
    seed: () => readPersistedRange(entityIds, options),
  });

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

/**
 * Event payload for the calendar mutation WebSocket commands. Dates are either
 * date-only strings ("2026-07-17", all-day) or ISO datetimes.
 */
export interface CalendarMutationEvent {
  dtstart: string;
  dtend: string;
  summary: string;
  description?: string;
  location?: string;
  rrule?: string;
}

function requireConnection(hass: HomeAssistant | undefined): HomeAssistant {
  if (!hass?.connection) {
    throw new Error('Home Assistant connection not available');
  }
  return hass;
}

/**
 * Create an event on a calendar that supports mutation (e.g. Local Calendar).
 * Requires entity control permission, not admin. WS errors reject unchanged so
 * callers can inspect `err.code` (e.g. 'unauthorized').
 */
export async function createCalendarEvent(
  hass: HomeAssistant | undefined,
  entityId: `calendar.${string}`,
  event: CalendarMutationEvent,
): Promise<void> {
  await requireConnection(hass).connection.sendMessagePromise({
    type: 'calendar/event/create',
    entity_id: entityId,
    event,
  });
}

/** Delete a calendar event by its uid. */
export async function deleteCalendarEvent(
  hass: HomeAssistant | undefined,
  entityId: `calendar.${string}`,
  uid: string,
  opts?: { recurrenceId?: string; recurrenceRange?: string },
): Promise<void> {
  await requireConnection(hass).connection.sendMessagePromise({
    type: 'calendar/event/delete',
    entity_id: entityId,
    uid,
    ...(opts?.recurrenceId !== undefined && { recurrence_id: opts.recurrenceId }),
    ...(opts?.recurrenceRange !== undefined && { recurrence_range: opts.recurrenceRange }),
  });
}

/** Replace a calendar event's content by its uid. */
export async function updateCalendarEvent(
  hass: HomeAssistant | undefined,
  entityId: `calendar.${string}`,
  uid: string,
  event: CalendarMutationEvent,
): Promise<void> {
  await requireConnection(hass).connection.sendMessagePromise({
    type: 'calendar/event/update',
    entity_id: entityId,
    uid,
    event,
  });
}
