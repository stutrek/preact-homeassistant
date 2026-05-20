import { act } from '@testing-library/preact';
import { useEffect, useRef } from 'preact/hooks';
import { describe, expect, it, vi } from 'vitest';
import { useService } from '../HAContext';
import { makeHass, renderWithHA } from './testHelpers';

function ServiceCallProbe({
  entityId,
  onReady,
}: {
  entityId: string;
  onReady: (call: ReturnType<typeof useService>) => void;
}) {
  const call = useService(entityId);
  useEffect(() => {
    onReady(call);
  }, [call, onReady]);
  return null;
}

describe('useService', () => {
  it('calls hass.callService with the parsed domain, service, and injected entity_id', async () => {
    const callService = vi.fn().mockResolvedValue(undefined);
    const hass = makeHass({}, { callService });

    let invoke: ReturnType<typeof useService> | undefined;
    renderWithHA(
      <ServiceCallProbe
        entityId="fan.bedroom"
        onReady={(call) => {
          invoke = call;
        }}
      />,
      { hass },
    );

    await act(async () => {
      await invoke!('set_percentage', { percentage: 67 });
    });

    expect(callService).toHaveBeenCalledWith('fan', 'set_percentage', {
      entity_id: 'fan.bedroom',
      percentage: 67,
    });
  });

  it('calls services that take no data with just the injected entity_id', async () => {
    const callService = vi.fn().mockResolvedValue(undefined);
    const hass = makeHass({}, { callService });

    let invoke: ReturnType<typeof useService> | undefined;
    renderWithHA(
      <ServiceCallProbe
        entityId="fan.bedroom"
        onReady={(call) => {
          invoke = call;
        }}
      />,
      { hass },
    );

    await act(async () => {
      await invoke!('turn_off');
    });

    expect(callService).toHaveBeenCalledWith('fan', 'turn_off', {
      entity_id: 'fan.bedroom',
    });
  });

  it('returns a stable function reference across renders', () => {
    const hass = makeHass({}, { callService: vi.fn() });

    const refs: Array<ReturnType<typeof useService>> = [];

    function Probe() {
      const call = useService('fan.bedroom');
      const renderCount = useRef(0);
      renderCount.current++;
      refs.push(call);
      return <div data-testid="renders">{renderCount.current}</div>;
    }

    const { rerender } = renderWithHA(<Probe />, { hass });
    rerender(<Probe />);
    rerender(<Probe />);

    // All captured refs should be the same function.
    expect(new Set(refs).size).toBe(1);
  });

  it('is a no-op when the entity ID is empty', async () => {
    const callService = vi.fn();
    const hass = makeHass({}, { callService });

    let invoke: ReturnType<typeof useService> | undefined;
    renderWithHA(
      <ServiceCallProbe
        entityId=""
        onReady={(call) => {
          invoke = call;
        }}
      />,
      { hass },
    );

    await act(async () => {
      await invoke!('turn_off' as never);
    });

    expect(callService).not.toHaveBeenCalled();
  });
});
