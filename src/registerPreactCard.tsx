import { type ComponentType, render } from 'preact';
import { HAProvider } from './HAContext';
import { getAllStyles } from './styleRegistry';
import type { HomeAssistant } from './types';

interface RegisterPreactCardOptions<TConfig> {
  type: string;
  name: string;
  description: string;
  Component: ComponentType<{ config: TConfig }>;
  ConfigComponent?: ComponentType<{
    hass: HomeAssistant;
    config: TConfig;
    onConfigChanged: (config: TConfig) => void;
  }>;
  UnconfiguredComponent?: ComponentType<{}>;
  getStubConfig?: () => Partial<TConfig>;
}

declare global {
  interface Window {
    customCards?: Array<{ type: string; name: string; description: string }>;
  }
}

export function registerPreactCard<TConfig>(options: RegisterPreactCardOptions<TConfig>) {
  const {
    type,
    name,
    description,
    Component,
    ConfigComponent,
    UnconfiguredComponent,
    getStubConfig,
  } = options;

  class HACard extends HTMLElement {
    private _hass?: HomeAssistant;
    private _config?: TConfig;
    private _shadowRoot: ShadowRoot;
    private _hasRendered = false;
    private _entityChangeListeners = new Map<string, Set<(entity: any) => void>>();

    constructor() {
      super();
      this._shadowRoot = this.attachShadow({ mode: 'open' });
    }

    connectedCallback() {
      // HA disconnects + reconnects the element during edit-mode toggling.
      // Re-rendering on each connect causes Preact to lose its diff anchor and
      // append a duplicate tree, so only render once per attachment cycle.
      if (this._hass && this._config && !this._hasRendered) {
        this._render();
      }
    }

    disconnectedCallback() {
      this._entityChangeListeners.clear();
    }

    set hass(hass: HomeAssistant) {
      const prevStates = this._hass?.states;
      this._hass = hass;

      for (const [entityId, listeners] of this._entityChangeListeners) {
        const newState = hass.states[entityId];
        const oldState = prevStates?.[entityId];
        if (newState !== oldState) {
          listeners.forEach((listener) => listener(newState));
        }
      }

      // Render only when attached. HA may set hass/config before insertion;
      // rendering into a detached shadow root then again on connect duplicates
      // the tree. connectedCallback handles the detached-first-render case.
      if (!prevStates && this._config && this.isConnected) {
        this._render();
      }
    }

    setConfig(config: TConfig) {
      this._config = config;
      if (this._hass && this.isConnected) {
        this._render();
      }
    }

    private _subscribeToEntity = (entityId: string, callback: (entity: any) => void) => {
      if (!this._entityChangeListeners.has(entityId)) {
        this._entityChangeListeners.set(entityId, new Set());
      }
      this._entityChangeListeners.get(entityId)!.add(callback);

      return () => {
        const listeners = this._entityChangeListeners.get(entityId);
        if (listeners) {
          listeners.delete(callback);
          if (listeners.size === 0) {
            this._entityChangeListeners.delete(entityId);
          }
        }
      };
    };

    private _render() {
      if (!this._config || !this._hass) {
        if (UnconfiguredComponent) {
          render(<UnconfiguredComponent />, this._shadowRoot);
        }
        return;
      }

      render(
        <HAProvider hass={this._hass} subscribeToEntity={this._subscribeToEntity}>
          <style>{getAllStyles()}</style>
          <Component config={this._config} />
        </HAProvider>,
        this._shadowRoot,
      );
      this._hasRendered = true;
    }

    static getConfigElement() {
      if (ConfigComponent) {
        return document.createElement(`${type}-editor`);
      }
      return undefined;
    }

    static getStubConfig() {
      return getStubConfig?.() ?? {};
    }
  }

  customElements.define(type, HACard);

  if (ConfigComponent) {
    const EditorComponent = ConfigComponent;

    class HACardEditor extends HTMLElement {
      private _hass?: HomeAssistant;
      private _config?: TConfig;

      set hass(hass: HomeAssistant) {
        this._hass = hass;
        this._render();
      }

      setConfig(config: TConfig) {
        this._config = config;
        this._render();
      }

      private _fireConfigChanged = (config: TConfig) => {
        this.dispatchEvent(
          new CustomEvent('config-changed', {
            detail: { config },
            bubbles: true,
            composed: true,
          }),
        );
      };

      private _render() {
        if (!this._hass || !this._config) return;

        // Render to light DOM so HA's custom elements (ha-select etc.) work.
        render(
          <EditorComponent
            hass={this._hass}
            config={this._config}
            onConfigChanged={this._fireConfigChanged}
          />,
          this,
        );
      }
    }

    customElements.define(`${type}-editor`, HACardEditor);
  }

  window.customCards = window.customCards || [];
  window.customCards.push({ type, name, description });

  console.info(
    `%c ${name.toUpperCase()} %c loaded `,
    'background: #3b82f6; color: white; font-weight: bold',
    '',
  );
}
