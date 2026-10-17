export interface ServerSentEvent {
  event?: string;
  data: string;
  id?: string;
}

export async function* parseSSE(response: Response): AsyncGenerator<ServerSentEvent> {
  const reader = response.body?.getReader();
  if (!reader) return;

  const decoder = new TextDecoder();
  let buffer = '';
  let skipLeadingLF = false;
  let event: Partial<ServerSentEvent> = {};

  const processLine = (line: string): ServerSentEvent | undefined => {
    if (line === '') {
      const completed = event.data !== undefined
        ? { data: event.data, event: event.event, id: event.id }
        : undefined;
      event = {};
      return completed;
    }

    if (line.startsWith(':')) return undefined;

    const colonIndex = line.indexOf(':');
    if (colonIndex === -1) return undefined;

    const field = line.slice(0, colonIndex);
    const value = line.slice(colonIndex + 1).trimStart();

    switch (field) {
      case 'data':
        event.data = event.data !== undefined ? `${event.data}\n${value}` : value;
        break;
      case 'event':
        event.event = value;
        break;
      case 'id':
        event.id = value;
        break;
    }

    return undefined;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      let chunk = decoder.decode(value, { stream: true });
      if (chunk.length === 0) continue;

      // A CR completes its line immediately; swallow a paired LF in the next chunk.
      if (skipLeadingLF) {
        if (chunk.startsWith('\n')) chunk = chunk.slice(1);
        skipLeadingLF = false;
      }
      buffer += chunk;
      skipLeadingLF = buffer.endsWith('\r');

      const lines = buffer.split(/\r\n|\r|\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const completed = processLine(line);
        if (completed) {
          yield completed;
        }
      }
    }

    buffer += decoder.decode();

    if (buffer.length > 0) {
      const completed = processLine(buffer);
      if (completed) {
        yield completed;
      }
    }

    if (event.data !== undefined) {
      yield { data: event.data, event: event.event, id: event.id };
    }
  } finally {
    reader.releaseLock();
  }
}
