import type { HassEntityAttributeBase, HassEntityBase } from 'home-assistant-js-websocket';

/**
 * Sun entity - provides sunrise/sunset and elevation information.
 */
export interface SunEntity extends HassEntityBase {
  entity_id: 'sun.sun';
  state: 'above_horizon' | 'below_horizon';
  attributes: HassEntityAttributeBase & {
    next_dawn?: string;
    next_dusk?: string;
    next_midnight?: string;
    next_noon?: string;
    next_rising?: string;
    next_setting?: string;
    elevation?: number;
    azimuth?: number;
    rising?: boolean;
  };
}
