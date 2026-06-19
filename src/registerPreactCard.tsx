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

// Grace period before a disconnected card is torn down. HA detaches and
// re-attaches cards transiently (scroll virtualization, edit mode); only a card
// that stays gone past this window is genuinely removed, so we defer the
// Preact unmount — and the effect cleanups it triggers (timers, subscriptions)
// — until then. A reconnect within the window cancels the teardown.
const TEARDOWN_GRACE_MS = 5000;

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

  // Shared host-element plumbing: config/hass storage, connect/disconnect
  // lifecycle, deferred teardown, and the render skeleton. Subclasses supply
  // the render root and the tree to render, and may override hass behavior.
  abstract class BaseHACard extends HTMLElement {
    protected _hass?: HomeAssistant;
    protected _config?: TConfig;
    private _teardownTimer?: ReturnType<typeof setTimeout>;

    protected abstract _getRenderRoot(): Element | ShadowRoot;
    protected abstract _renderTree(): void;
    protected _renderUnconfigured(): void {}

    connectedCallback() {
      if (this._teardownTimer !== undefined) {
        clearTimeout(this._teardownTimer);
        this._teardownTimer = undefined;
      }
      this._maybeRenderOnConnect();
    }

    protected _maybeRenderOnConnect() {
      if (this._hass && this._config) {
        this._render();
      }
    }

    disconnectedCallback() {
      if (this._teardownTimer !== undefined) clearTimeout(this._teardownTimer);
      this._teardownTimer = setTimeout(() => {
        // Unmount the Preact tree, running effect cleanups (clears timers and
        // entity subscriptions). Scheduled, never synchronous, so a transient
        // disconnect+reconnect leaves the tree intact.
        render(null, this._getRenderRoot());
        this._teardownTimer = undefined;
      }, TEARDOWN_GRACE_MS);
    }

    setConfig(config: TConfig) {
      this._config = config;
      if (this._hass && this.isConnected) {
        this._render();
      }
    }

    protected _render() {
      if (!this._config || !this._hass) {
        this._renderUnconfigured();
        return;
      }
      this._renderTree();
    }
  }

  class HACard extends BaseHACard {
    private _shadowRoot: ShadowRoot;
    private _entityChangeListeners = new Map<string, Set<(entity: any) => void>>();
    private _hassChangeListeners = new Set<() => void>();

    constructor() {
      super();
      this._shadowRoot = this.attachShadow({ mode: 'open' });
    }

    protected _getRenderRoot() {
      return this._shadowRoot;
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

      // Notify non-entity (config/themes) subscribers on every update. This does
      // not re-render the whole card — useHassValue re-renders only its own
      // consumer, and only when its selected slice actually changes.
      this._hassChangeListeners.forEach((listener) => listener());

      if (!prevStates && this._config && this.isConnected) {
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

    private _subscribeToHass = (callback: () => void) => {
      this._hassChangeListeners.add(callback);
      return () => {
        this._hassChangeListeners.delete(callback);
      };
    };

    protected _renderTree() {
      render(
        <HAProvider
          hass={this._hass}
          subscribeToEntity={this._subscribeToEntity}
          subscribeToHass={this._subscribeToHass}
        >
          <style>{getAllStyles()}</style>
          <Component config={this._config!} />
        </HAProvider>,
        this._shadowRoot,
      );
    }

    protected _renderUnconfigured() {
      if (UnconfiguredComponent) {
        render(<UnconfiguredComponent />, this._shadowRoot);
      }
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

    class HACardEditor extends BaseHACard {
      protected _getRenderRoot() {
        return this;
      }

      // The editor re-renders on every hass update: it passes `hass` straight to
      // HA's <ha-form>/<ha-selector>, whose entity pickers need a fresh hass to
      // stay current. (Unlike the card, which renders once then subscribes.)
      set hass(hass: HomeAssistant) {
        this._hass = hass;
        this._render();
      }

      // Render whenever config arrives, regardless of connection — HA may set
      // config/hass before connecting the editor element.
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

      // Render to light DOM so HA's custom elements (ha-form etc.) work.
      protected _renderTree() {
        render(
          <EditorComponent
            hass={this._hass!}
            config={this._config!}
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
