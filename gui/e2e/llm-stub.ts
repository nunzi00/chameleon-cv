/**
 * Doble local del proveedor de IA para la E2E (docs/gui-mvp.md §5): un servidor compatible con la API de OpenAI que
 * anuncia un modelo y responde a cada tarea con JSON fijo (una propuesta fiel para improve y summarize, una etiqueta
 * del diccionario para suggest-tags). Determinista, sin red y sin modelo: prueba el flujo, no la calidad (C12).
 */
import { createServer, type Server } from 'node:http';

export interface LlmStub {
  readonly url: string;
  readonly model: string;
  close(): Promise<void>;
}

interface Body {
  readonly messages?: readonly { readonly role: string; readonly content: string }[];
}

function answer(input: Record<string, unknown>): unknown {
  if (Array.isArray(input['tags'])) {
    // «offer map» (T-9.10): una etiqueta del vocabulario recibido con una frase literal de la oferta del banco.
    const tags = input['tags'] as readonly string[];
    return { mappings: [{ tag: tags.includes('gestion') ? 'gestion' : tags[0], emphasis: 'desirable', evidence: 'mentoría' }] };
  }
  if (Array.isArray(input['dictionary'])) {
    const dictionary = input['dictionary'] as readonly string[];
    return { suggestions: [{ tag: dictionary[0] ?? 'php', reason: 'aparece en el texto' }] };
  }
  if (typeof input['text'] === 'string') {
    return { proposals: [{ text: `Logré: ${input['text'].replace(/\*\*/g, '')}`, rationale: 'fiel al original' }] };
  }
  return { proposals: [{ text: 'Ingeniera de software con experiencia en plataformas de pago con PHP, Symfony y Kubernetes.', rationale: 'síntesis del perfil' }] };
}

export function startLlmStub(model = 'stub-model'): Promise<LlmStub> {
  const server: Server = createServer((request, response) => {
    let raw = '';
    request.on('data', (chunk: Buffer) => {
      raw += chunk.toString('utf8');
    });
    request.on('end', () => {
      const reply = (status: number, payload: unknown): void => {
        response.writeHead(status, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify(payload));
      };
      if (request.method === 'GET' && request.url === '/v1/models') {
        reply(200, { object: 'list', data: [{ id: model, object: 'model' }] });
        return;
      }
      if (request.method === 'POST' && request.url === '/v1/chat/completions') {
        const body = JSON.parse(raw === '' ? '{}' : raw) as Body;
        const user = body.messages?.find((message) => message.role === 'user')?.content ?? '{}';
        let input: Record<string, unknown> = {};
        try {
          input = JSON.parse(user) as Record<string, unknown>;
        } catch {
          input = {};
        }
        reply(200, { id: 'chatcmpl-stub', object: 'chat.completion', model, choices: [{ index: 0, message: { role: 'assistant', content: JSON.stringify(answer(input)) }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 8, total_tokens: 20 } });
        return;
      }
      reply(404, { error: { message: `no existe ${request.method ?? ''} ${request.url ?? ''}` } });
    });
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      resolve({ url: `http://127.0.0.1:${port}`, model, close: () => new Promise((done) => server.close(() => done())) });
    });
  });
}
