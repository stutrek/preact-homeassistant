import type { HassEntityAttributeBase, HassEntityBase } from 'home-assistant-js-websocket';

/**
 * Fan entity - speed is reported as percentage (0-100) with percentage_step
 * giving the smallest discrete increment the fan supports.
 */
export interface FanEntity extends HassEntityBase {
  state: 'on' | 'off' | 'unavailable' | 'unknown';
  attributes: HassEntityAttributeBase & {
    percentage?: number;
    percentage_step?: number;
    preset_modes?: string[];
    preset_mode?: string;
    oscillating?: boolean;
    direction?: 'forward' | 'reverse';
    supported_features?: number;
  };
}

/**
 * Data payload shapes for each service in the `fan` domain.
 * `undefined` means the service accepts no payload beyond `entity_id`.
 * See https://www.home-assistant.io/integrations/fan/#actions
 */
export interface FanServices {
  turn_on: { percentage?: number; preset_mode?: string };
  turn_off: undefined;
  toggle: undefined;
  set_percentage: { percentage: number };
  set_preset_mode: { preset_mode: string };
  oscillate: { oscillating: boolean };
  set_direction: { direction: 'forward' | 'reverse' };
  increase_speed: { percentage_step?: number };
  decrease_speed: { percentage_step?: number };
}
