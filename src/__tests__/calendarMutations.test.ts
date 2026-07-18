import { describe, expect, it, vi } from 'vitest';
import { createCalendarEvent, deleteCalendarEvent, updateCalendarEvent } from '../calendars';
import type { HomeAssistant } from '../types';

function makeHassWithSend(sendMessagePromise = vi.fn().mockResolvedValue({})) {
  const hass = {
    connection: { sendMessagePromise },
  } as unknown as HomeAssistant;
  return { hass, sendMessagePromise };
}

const flagEvent = {
  dtstart: '2026-07-17',
  dtend: '2026-07-18',
  summary: 'Dentist',
  description: '{"app":"x"}',
};

describe('createCalendarEvent', () => {
  it('sends calendar/event/create with the exact payload', async () => {
    const { hass, sendMessagePromise } = makeHassWithSend();
    await createCalendarEvent(hass, 'calendar.highlights', flagEvent);
    expect(sendMessagePromise).toHaveBeenCalledWith({
      type: 'calendar/event/create',
      entity_id: 'calendar.highlights',
      event: flagEvent,
    });
  });

  it('throws when hass has no connection', async () => {
    await expect(createCalendarEvent(undefined, 'calendar.highlights', flagEvent)).rejects.toThrow(
      'Home Assistant connection not available',
    );
  });

  it('propagates WS errors unchanged', async () => {
    const wsError = { code: 'unauthorized', message: 'Unauthorized' };
    const { hass } = makeHassWithSend(vi.fn().mockRejectedValue(wsError));
    await expect(createCalendarEvent(hass, 'calendar.highlights', flagEvent)).rejects.toBe(wsError);
  });
});

describe('deleteCalendarEvent', () => {
  it('sends calendar/event/delete with uid only by default', async () => {
    const { hass, sendMessagePromise } = makeHassWithSend();
    await deleteCalendarEvent(hass, 'calendar.highlights', 'abc-123');
    expect(sendMessagePromise).toHaveBeenCalledWith({
      type: 'calendar/event/delete',
      entity_id: 'calendar.highlights',
      uid: 'abc-123',
    });
  });

  it('includes recurrence fields when provided', async () => {
    const { hass, sendMessagePromise } = makeHassWithSend();
    await deleteCalendarEvent(hass, 'calendar.highlights', 'abc-123', {
      recurrenceId: '20260717T100000',
      recurrenceRange: 'THISANDFUTURE',
    });
    expect(sendMessagePromise).toHaveBeenCalledWith({
      type: 'calendar/event/delete',
      entity_id: 'calendar.highlights',
      uid: 'abc-123',
      recurrence_id: '20260717T100000',
      recurrence_range: 'THISANDFUTURE',
    });
  });
});

describe('updateCalendarEvent', () => {
  it('sends calendar/event/update with uid and event', async () => {
    const { hass, sendMessagePromise } = makeHassWithSend();
    await updateCalendarEvent(hass, 'calendar.highlights', 'abc-123', flagEvent);
    expect(sendMessagePromise).toHaveBeenCalledWith({
      type: 'calendar/event/update',
      entity_id: 'calendar.highlights',
      uid: 'abc-123',
      event: flagEvent,
    });
  });
});
