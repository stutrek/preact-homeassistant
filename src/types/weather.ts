import type { HassEntityAttributeBase, HassEntityBase } from 'home-assistant-js-websocket';

/**
 * Weather entity - current conditions only.
 * Use useWeatherForecast() to fetch forecast data.
 */
export interface WeatherEntity extends HassEntityBase {
  entity_id: `weather.${string}`;
  state: string;
  attributes: HassEntityAttributeBase & {
    temperature?: number;
    apparent_temperature?: number;
    dew_point?: number;
    humidity?: number;
    pressure?: number;
    wind_speed?: number;
    wind_gust_speed?: number;
    wind_bearing?: number;
    visibility?: number;
    supported_features?: number;
  };
}

/**
 * Weather forecast item returned by the weather/get_forecasts websocket call.
 */
export interface WeatherForecast {
  datetime: string;
  condition?: string;
  temperature?: number;
  templow?: number;
  precipitation_probability?: number;
  precipitation?: number;
  humidity?: number;
  wind_speed?: number;
  wind_bearing?: number;
  cloud_coverage?: number;
  uv_index?: number;
  is_daytime?: boolean;
}

export type ForecastType = 'daily' | 'hourly' | 'twice_daily';
