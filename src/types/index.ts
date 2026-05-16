import type { HassEntity } from 'home-assistant-js-websocket';
import type { CalendarEntity } from './calendar';
import type { SunEntity } from './sun';
import type { WeatherEntity } from './weather';

export type { HomeAssistant, FetchStatus } from './common';
export type {
  CalendarEntity,
  CalendarEvent,
  CalendarEventWithSource,
} from './calendar';
export type { WeatherEntity, WeatherForecast, ForecastType } from './weather';
export type { SunEntity } from './sun';

/**
 * Map of known HA domains to their strict entity types. Contributors adding
 * new domain types should add a new file under `src/types/` and extend this map.
 */
export interface DomainEntityMap {
  calendar: CalendarEntity;
  weather: WeatherEntity;
  sun: SunEntity;
}

type KnownDomain = keyof DomainEntityMap;

/**
 * Infers the strict entity type from an entity ID literal type.
 *
 *   EntityForId<'calendar.family'> -> CalendarEntity
 *   EntityForId<'weather.home'>    -> WeatherEntity
 *   EntityForId<'sensor.foo'>      -> HassEntity  (fallback)
 */
export type EntityForId<T extends string> = T extends `${infer D}.${string}`
  ? D extends KnownDomain
    ? DomainEntityMap[D]
    : HassEntity
  : HassEntity;
