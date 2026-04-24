import { describe, it, expect, afterEach } from 'bun:test';
import { parseSSE, type ServerSentEvent } from '../../src/client/stream';
import { createMockServer, type MockServer } from '../helpers/mock-server';

/**
 * Build a raw SSE body string from an array of event objects.
 * Each event becomes: (optional comment) + (optional id) + (optional event) +
 * data lines + blank line. The terminating [DONE] event is added at the end.
 */
function buildSSE(events: Array<{
  data?: string;
  event?: string;
  id?: string;
  comment?: string;
}>): string {
  const lines: string[] = [];
  for (const ev of events) {
    if (ev.comment) lines.push(`: ${ev.comment}`);
    if (ev.id) lines.push(`id: ${ev.id}`);
    if (ev.event) lines.push(`event: ${ev.event}`);
    if (ev.data !== undefined) {
      for (const dl of ev.data.split('\n')) lines.push(`data: ${dl}`);
    }
    lines.push(''); // blank line terminates this event
  }
  // [DONE] terminator — sent as a normal data event that callers check for
  lines.push('data: [DONE]');
  return lines.join('\n');
}

function sseResponse(events: Parameters<typeof buildSSE>[0]): Response {
  return new Response(buildSSE(events), {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

describe('parseSSE', () => {
  let server: MockServer;

  afterEach(() => {
    server?.close();
  });

  // -------------------------------------------------------------------------
  // Basic parsing
  // -------------------------------------------------------------------------

  it('parses a single event with data', async () => {
    server = createMockServer({
      routes: { '/stream': () => sseResponse([{ data: 'hello' }]) },
    });

    const response = await fetch(`${server.url}/stream`);
    const events = await collectEvents(response);

    expect(events.length).toBe(2);
    expect(events[0].data).toBe('hello');
    expect(events[1].data).toBe('[DONE]');
  });

  it('parses multiple sequential events', async () => {
    server = createMockServer({
      routes: {
        '/stream': () => sseResponse([
          { data: 'first' },
          { data: 'second' },
          { data: 'third' },
        ]),
      },
    });

    const response = await fetch(`${server.url}/stream`);
    const events = await collectEvents(response);

    expect(events.length).toBe(4);
    expect(events[0].data).toBe('first');
    expect(events[1].data).toBe('second');
    expect(events[2].data).toBe('third');
    expect(events[3].data).toBe('[DONE]');
  });

  it('parses event with event type field', async () => {
    server = createMockServer({
      routes: {
        '/stream': () => sseResponse([
          { event: 'message', data: 'payload' },
        ]),
      },
    });

    const response = await fetch(`${server.url}/stream`);
    const events = await collectEvents(response);

    expect(events[0].data).toBe('payload');
    expect(events[0].event).toBe('message');
    expect(events[1].data).toBe('[DONE]');
  });

  it('parses event with id field', async () => {
    server = createMockServer({
      routes: {
        '/stream': () => sseResponse([{ id: '42', data: 'item 42' }]),
      },
    });

    const response = await fetch(`${server.url}/stream`);
    const events = await collectEvents(response);

    expect(events[0].data).toBe('item 42');
    expect(events[0].id).toBe('42');
    expect(events[1].data).toBe('[DONE]');
  });

  it('parses event with all fields set', async () => {
    server = createMockServer({
      routes: {
        '/stream': () => sseResponse([
          { id: '1', event: 'update', data: 'all fields' },
        ]),
      },
    });

    const response = await fetch(`${server.url}/stream`);
    const events = await collectEvents(response);

    expect(events[0]).toEqual({ data: 'all fields', event: 'update', id: '1' });
    expect(events[1].data).toBe('[DONE]');
  });

  // -------------------------------------------------------------------------
  // Field value handling
  // -------------------------------------------------------------------------

  it('skips comment lines (starting with colon)', async () => {
    server = createMockServer({
      routes: {
        '/stream': () => sseResponse([
          { comment: 'this is a comment' },
          { data: 'after comment' },
        ]),
      },
    });

    const response = await fetch(`${server.url}/stream`);
    const events = await collectEvents(response);

    // Comment event produces no yield; only the data event is yielded
    expect(events[0].data).toBe('after comment');
    expect(events[1].data).toBe('[DONE]');
  });

  it('concatenates multi-line data with newline separator', async () => {
    server = createMockServer({
      routes: {
        '/stream': () => sseResponse([{ data: 'line1\nline2\nline3' }]),
      },
    });

    const response = await fetch(`${server.url}/stream`);
    const events = await collectEvents(response);

    expect(events[0].data).toBe('line1\nline2\nline3');
    expect(events[1].data).toBe('[DONE]');
  });

  it('skips lines without a colon (malformed field)', async () => {
    // A field with no colon is skipped per the spec.
    // "data: valid" starts an event; "no_colon_here" is skipped;
    // "data: second" appends to the same event (SSE concatenates with \n);
    // "\n" terminates the event.
    const body = 'data: valid\nno_colon_here\ndata: second\n\ndata: [DONE]\n\n';
    server = createMockServer({
      routes: {
        '/stream': () => new Response(body, {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      },
    });

    const response = await fetch(`${server.url}/stream`);
    const events = await collectEvents(response);

    // "valid" + "\n" + "second" = "valid\nsecond" (SSE multi-line data concatenation)
    expect(events[0].data).toBe('valid\nsecond');
    expect(events[1].data).toBe('[DONE]');
  });

  it('handles empty data field (data: with no value)', async () => {
    // Per SSE spec, "data:" with no value after it is valid
    const body = 'data:\n\ndata: [DONE]\n\n';
    server = createMockServer({
      routes: {
        '/stream': () => new Response(body, {
          headers: { 'Content-Type': 'text/event-stream' },
        }),
      },
    });

    const response = await fetch(`${server.url}/stream`);
    const events = await collectEvents(response);

    // Empty data field is yielded as ''
    expect(events[0].data).toBe('');
    expect(events[1].data).toBe('[DONE]');
  });

  // -------------------------------------------------------------------------
  // Streaming / buffering edge cases
  // -------------------------------------------------------------------------

  it('handles response with no body (null body)', async () => {
    server = createMockServer({
      routes: {
        '/stream': () => new Response(null, { status: 204 }),
      },
    });

    const response = await fetch(`${server.url}/stream`);
    const events = await collectEvents(response);

    // Should yield nothing — no error
    expect(events).toEqual([]);
  });

  it('releases reader lock after iteration completes', async () => {
    server = createMockServer({
      routes: {
        '/stream': () => sseResponse([{ data: 'test' }]),
      },
    });

    // First request — consume all events
    const response1 = await fetch(`${server.url}/stream`);
    for await (const _ of parseSSE(response1)) { /* consume */ }

    // Second request — should work since lock released
    const response2 = await fetch(`${server.url}/stream`);
    const events2 = await collectEvents(response2);

    expect(events2[0].data).toBe('test');
    expect(events2[1].data).toBe('[DONE]');
  });

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  async function collectEvents(response: Response): Promise<ServerSentEvent[]> {
    const events: ServerSentEvent[] = [];
    for await (const event of parseSSE(response)) {
      events.push(event);
    }
    return events;
  }
});
