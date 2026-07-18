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
  /**
   * Authenticated REST call against HA (`path` has no leading `api/`).
   * Present on the runtime hass object; optional here so test mocks that
   * don't need REST access keep compiling.
   */
  callApi?: <T = unknown>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    data?: object,
  ) => Promise<T>;
  themes?: {
    darkMode?: boolean;
    theme?: string;
  };
}

export type FetchStatus = 'loading' | 'cached' | 'ready' | 'refreshing';
