import { describe, expect, it } from 'vitest';

import { bodyChunks, sseEvents } from './sse';

async function* chunks(...parts: (string | Uint8Array)[]): AsyncGenerator<string | Uint8Array, void, undefined> {
  for (const part of parts) {
    yield part;
  }
}

async function collect(source: AsyncIterable<string | Uint8Array>): Promise<Array<{ event: string; data: unknown }>> {
  const events: Array<{ event: string; data: unknown }> = [];
  for await (const item of sseEvents(source)) {
    events.push({ event: item.event, data: item.data });
  }
  return events;
}

describe('cliente SSE sobre fetch', () => {
  it('analiza bloques event/data partidos entre trozos, con CRLF, comentarios y campos ignorados', async () => {
    const events = await collect(chunks(': chameleon-cv\n\nevent: status\ndata: {"status":"run', 'ning"}\n\r\nid: 7\nretry: 1000\nevent: line\ndata: {"line":"[1/2] a"}\r\n\r\n', 'data: primera\ndata: segunda\n\n'));
    expect(events).toEqual([
      { event: 'status', data: { status: 'running' } },
      { event: 'line', data: { line: '[1/2] a' } },
      { event: 'message', data: 'primera\nsegunda' },
    ]);
  });

  it('acepta bytes UTF-8 partidos por la mitad de un carácter, un bloque final sin salto de línea y datos que no son JSON', async () => {
    const encoded = new TextEncoder().encode('event: line\ndata: {"line":"ñandú"}\n\nevent: status\ndata: fin');
    const half = Math.floor(encoded.length / 2);
    const events = await collect(chunks(encoded.subarray(0, half), encoded.subarray(half)));
    expect(events).toEqual([
      { event: 'line', data: { line: 'ñandú' } },
      { event: 'status', data: 'fin' },
    ]);
  });

  it('un evento sin data no se emite, una línea sin dos puntos es un campo vacío y el evento vuelve a «message»', async () => {
    const events = await collect(chunks('event: solo\n\nevento-sin-dos-puntos\ndata:sin-espacio\n\n'));
    expect(events).toEqual([{ event: 'message', data: 'sin-espacio' }]);
  });

  it('bodyChunks entrega el cuerpo de la respuesta o nada', async () => {
    const response = new Response('data: x\n\n');
    const events = await collect(bodyChunks(response));
    expect(events).toEqual([{ event: 'message', data: 'x' }]);
    expect(await collect(bodyChunks({ body: null }))).toEqual([]);
  });
});
