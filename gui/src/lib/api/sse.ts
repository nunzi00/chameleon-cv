/**
 * Cliente de Server-Sent Events sobre `fetch` (docs/gui-mvp.md §4.5): `EventSource` no admite cabeceras y el token
 * nunca va en la URL. Analiza bloques `event:`/`data:` de un flujo de trozos (partidos donde sea, con CRLF o LF),
 * ignora comentarios e `id`/`retry`, y entrega el `data` como JSON cuando lo es (si no, el texto tal cual).
 */
export interface SseEvent {
  readonly event: string;
  readonly data: unknown;
  readonly raw: string;
}

function parseData(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return raw;
  }
}

/** Los eventos completos de un flujo de trozos (texto o bytes UTF-8). */
export async function* sseEvents(source: AsyncIterable<Uint8Array | string>): AsyncGenerator<SseEvent, void, undefined> {
  const decoder = new TextDecoder();
  let buffer = '';
  let event = 'message';
  let data: string[] = [];
  const dispatch = (): SseEvent | undefined => {
    const complete = data.length > 0 ? { event, data: parseData(data.join('\n')), raw: data.join('\n') } : undefined;
    event = 'message';
    data = [];
    return complete;
  };
  const consume = (line: string): SseEvent | undefined => {
    if (line === '') {
      return dispatch();
    }
    if (line.startsWith(':')) {
      return undefined;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      data.push(value);
    }
    return undefined;
  };
  for await (const chunk of source) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true });
    let newline = buffer.indexOf('\n');
    while (newline !== -1) {
      const complete = consume(buffer.slice(0, newline).replace(/\r$/, ''));
      buffer = buffer.slice(newline + 1);
      if (complete !== undefined) {
        yield complete;
      }
      newline = buffer.indexOf('\n');
    }
  }
  buffer += decoder.decode();
  if (buffer !== '') {
    consume(buffer.replace(/\r$/, ''));
  }
  const last = dispatch();
  if (last !== undefined) {
    yield last;
  }
}

/** El cuerpo de una respuesta como trozos (con su lector); sin cuerpo, nada. */
export async function* bodyChunks(response: Pick<Response, 'body'>): AsyncGenerator<Uint8Array, void, undefined> {
  if (response.body === null) {
    return;
  }
  const reader = response.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        return;
      }
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
