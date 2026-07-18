import type { HassEntityAttributeBase, HassEntityBase } from 'home-assistant-js-websocket';

/**
 * Calendar entity - only exposes the current/next event.
 * Use useCalendarEvents() to fetch a list of events.
 */
export interface CalendarEntity extends HassEntityBase {
  entity_id: `calendar.${string}`;
  state: 'on' | 'off' | 'unavailable' | 'unknown';
  attributes: HassEntityAttributeBase & {
    message?: string;
    description?: string;
    start_time?: string;
    end_time?: string;
    location?: string;
    all_day?: boolean;
  };
}

/**
 * Calendar event as normalized by useCalendarEvents. uid/recurrence_id/rrule
 * are only present when fetched via the REST API (GET /api/calendars/…) —
 * the calendar.get_events service response omits them.
 */
export interface CalendarEvent {
  start: string;
  end: string;
  summary: string;
  description?: string;
  location?: string;
  uid?: string;
  recurrence_id?: string;
  rrule?: string;
}

/**
 * Calendar event with its source calendar entity ID attached. Used by
 * useMultiCalendarEvents() to disambiguate events from multiple calendars.
 */
export interface CalendarEventWithSource extends CalendarEvent {
  calendarId: string;
}
