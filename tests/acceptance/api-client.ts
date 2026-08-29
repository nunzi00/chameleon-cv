/**
 * Cliente mínimo de la API para el arnés de aceptación (escenario «serve», T-7.4a): arranca
 * `cv serve --port 0 --api-only` con el binario bajo prueba sobre la copia del banco, ejecuta una secuencia
 * fija de peticiones y devuelve por «stdout» las respuestas normalizadas (JSON con claves ordenadas, sin
 * fechas de ficheros ni datos de máquina; los binarios como tamaño y SHA-256) para que el runner las compare
 * byte a byte con lo esperado. Termina el servidor con POST /shutdown y devuelve su código de salida.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

import { canonicalPdf } from './compare';

export interface ClientResult {
  readonly status: number;
  readonly stdout: string;
  readonly stderr: string;
}

interface Call {
  readonly method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
  readonly headers?: Readonly<Record<string, string>>;
  /** Sin token (para provocar el 401). */
  readonly anonymous?: boolean;
  /** Reduce la respuesta a lo determinista antes de imprimirla. */
  readonly render?: (body: unknown) => unknown;
}

const OFFER = 'Senior Backend Engineer\n\nRequisitos:\n- PHP y Symfony en producción.\n- Kubernetes y Kafka.\n\nDeseable:\n- Contract testing.\n';
const NEW_PROJECT = '---\nname: Proyecto por la API\nrole: Autora\nstart: 2026-08\ntags: [typescript]\n---\n\nCreado con PUT /sources.\n';

type Json = Record<string, unknown>;
const object = (value: unknown): Json => value as Json;
const summarizeStatus = (body: unknown): unknown => ({ ...object(body), typst: { usable: object(object(body)['typst'])['usable'] }, llm: { usable: object(object(body)['llm'])['usable'] } });
/** Los tamaños de los PDF dependen de la zlib del Node que los generó: no se imprimen. */
const withoutPdfBytes = (body: unknown): unknown => {
  const value = object(body);
  const output = value['output'];
  if (typeof output === 'object' && output !== null && object(output)['kind'] === 'pdf') {
    const { bytes: _bytes, ...rest } = object(output);
    return { ...value, output: rest };
  }
  if (Array.isArray(value['files'])) {
    return { ...value, files: (value['files'] as Json[]).map((file) => (String(file['name']).endsWith('.pdf') ? { name: file['name'] } : file)) };
  }
  return body;
};
const summarizeProfile = (body: unknown): unknown => {
  const profile = object(body);
  const personal = object(profile['personal']);
  const ids = (key: string): unknown => (profile[key] as Array<Json>).map((item) => item['id']);
  return { fullName: personal['fullName'], specialties: ids('specialties'), experience: ids('experience'), projects: ids('projects') };
};

const CALLS: readonly Call[] = [
  { method: 'GET', path: '/status', render: summarizeStatus },
  { method: 'GET', path: '/sources' },
  { method: 'GET', path: '/sources/profile.md' },
  { method: 'PUT', path: '/sources/projects/api-proyecto.md', body: { content: NEW_PROJECT }, headers: { 'If-Match': '*' } },
  { method: 'PUT', path: '/sources/projects/api-proyecto.md', body: { content: NEW_PROJECT }, headers: { 'If-Match': '*' } },
  { method: 'PUT', path: '/sources/projects/api-proyecto.md', body: { content: 'otro' }, headers: { 'If-Match': '"0000000000000000000000000000000000000000000000000000000000000000"' } },
  { method: 'PUT', path: '/sources/projects/api-proyecto.md', body: { content: 'x' } },
  { method: 'GET', path: '/sources/..%2Ffuera.md' },
  { method: 'POST', path: '/validate', body: {} },
  { method: 'GET', path: '/profile' },
  { method: 'POST', path: '/build', body: {} },
  { method: 'GET', path: '/profile', render: summarizeProfile },
  { method: 'POST', path: '/generate', body: { specialty: 'backend' } },
  { method: 'POST', path: '/generate', body: { specialty: 'backend', format: 'pdf', offer: { workspaceFile: 'offers/nexo-senior-backend.txt' }, compact: true }, render: withoutPdfBytes },
  { method: 'GET', path: '/output', render: withoutPdfBytes },
  { method: 'GET', path: '/output/cv-lucia-ferrer-montalban-backend-nexo-senior-backend.pdf' },
  { method: 'POST', path: '/analyze-offer', body: { offer: { text: OFFER }, specialty: 'backend' } },
  { method: 'GET', path: '/themes' },
  { method: 'POST', path: '/themes', body: { name: 'api-tema', from: 'classic' } },
  { method: 'POST', path: '/generate', body: { format: 'docx' } },
  { method: 'GET', path: '/nope' },
  { method: 'DELETE', path: '/status' },
  { method: 'GET', path: '/status', anonymous: true },
  { method: 'POST', path: '/validate', body: {}, headers: { Origin: 'http://evil.example' } },
];

/** Claves ordenadas y sin fechas de modificación: el JSON queda determinista. */
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonical);
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.keys(value as Json)
        .filter((key) => key !== 'mtimeMs')
        .sort()
        .map((key) => [key, canonical((value as Json)[key])]),
    );
  }
  return value;
}

async function render(response: Response, call: Call): Promise<string> {
  const type = response.headers.get('content-type') ?? '';
  if (type.startsWith('application/json')) {
    const body: unknown = await response.json();
    return JSON.stringify(canonical(call.render === undefined ? body : call.render(body)), null, 2);
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (type === 'application/pdf') {
    return `<pdf · sha256 canónico ${createHash('sha256').update(canonicalPdf(bytes)).digest('hex')}>`;
  }
  return `<${bytes.length} bytes · sha256 ${createHash('sha256').update(bytes).digest('hex')} · ${type}>`;
}

export async function runApiClient(command: readonly string[], workspace: string, env: NodeJS.ProcessEnv): Promise<ClientResult> {
  const [file, ...leading] = command;
  const child = spawn(String(file), [...leading, 'serve', '--port', '0', '--api-only'], { cwd: workspace, env, stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stdout.on('data', () => undefined);
  const exited = new Promise<number>((resolve) => child.once('exit', (code) => resolve(code ?? -1)));
  const started = await new Promise<{ url: string; token: string } | undefined>((resolve) => {
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
      const match = /Token: (http:\/\/127\.0\.0\.1:\d+\/)#token=(\S+)/.exec(stderr);
      if (match !== null) {
        resolve({ url: String(match[1]), token: String(match[2]) });
      }
    });
    void exited.then(() => resolve(undefined));
    setTimeout(() => resolve(undefined), 20_000).unref();
  });
  const normalizeStderr = (): string => stderr.replace(/http:\/\/127\.0\.0\.1:\d+\//g, 'http://127.0.0.1:<PORT>/').replace(/#token=\S+/g, '#token=<TOKEN>');
  if (started === undefined) {
    child.kill();
    return { status: 2, stdout: '', stderr: `el servidor no arrancó\n${normalizeStderr()}` };
  }
  const lines: string[] = [];
  try {
    for (const call of CALLS) {
      const response = await fetch(`${started.url}api/v1${call.path}`, {
        method: call.method,
        headers: { ...(call.anonymous === true ? {} : { Authorization: `Bearer ${started.token}` }), ...(call.body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(call.headers ?? {}) },
        ...(call.body === undefined ? {} : { body: JSON.stringify(call.body) }),
      });
      lines.push(`### ${call.method} ${call.path}${call.anonymous === true ? ' (sin token)' : ''} → ${response.status}`, await render(response, call), '');
    }
    const shutdown = await fetch(`${started.url}api/v1/shutdown`, { method: 'POST', headers: { Authorization: `Bearer ${started.token}` } });
    lines.push(`### POST /shutdown → ${shutdown.status}`, JSON.stringify(await shutdown.json()), '');
  } catch (error) {
    child.kill();
    return { status: 1, stdout: lines.join('\n'), stderr: `${normalizeStderr()}\ncliente: ${error instanceof Error ? error.message : String(error)}` };
  }
  const exit = await exited;
  return { status: exit === 0 ? 0 : 1, stdout: lines.join('\n'), stderr: normalizeStderr() };
}
