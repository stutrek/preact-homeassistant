import type {
  Connection,
  HassConfig,
  HassEntities,
  HassServices,
} from 'home-assistant-js-websocket';

/**
 * Subset of the Home Assistant `hass` object passed to custom cards.
 */
export interface HomeAssistant {
  states: HassEntities;
  config: HassConfig;
  services: HassServices;
  connection: Connection;
  callService: (domain: string, service: string, data?: object) => Promise<void>;
  themes?: {
    darkMode?: boolean;
    theme?: string;
  };
}

export type FetchStatus = 'loading' | 'cached' | 'ready' | 'refreshing';
