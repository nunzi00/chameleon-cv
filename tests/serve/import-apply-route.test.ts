/**
 * POST /import/apply (T-9.5): mover una línea sin situar del borrador a la sección que se indique. Síncrona y
 * sin modelo — el co-piloto ya propuso; aquí decide y aplica quien revisa (C2)—: 200 con lo escrito y el informe
 * al día, 422 cuando falta un dato obligatorio y 404 cuando la línea ya no está pendiente.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startServer, type ServerHandle } from '../../src/serve';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const TOKEN = 'token-de-pruebas-fijo';

const PROFILE = '---\nschemaVersion: 1\nlocale: es-ES\nfullName: Ada Ejemplo\nlinks: []\n---\n';

const REPORT = [
  '# Informe del borrador importado',
  '',
  '- Origen: cv.pdf',
  '',
  '## Sin situar (revísalo a mano)',
  '',
  '- línea 31: Kubernetes',
  '- línea 32: Finance Chair, Green Club',
  '',
].join('\n');

describe('cv serve: POST /import/apply', () => {
  let handle: ServerHandle;
  let fs: MemoryFileSystem;

  const apply = (body: unknown): Promise<Response> =>
    fetch(`${handle.url}api/v1/import/apply`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    });

  beforeAll(async () => {
    fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n',
      '/work/import/mio/profile.md': PROFILE,
      '/work/import/mio/README.md': REPORT,
    });
    handle = await startServer({
      host: '127.0.0.1',
      port: 0,
      data: 'data/sources',
      profile: 'data/dist/profile.json',
      version: '9.9.9',
      apiOnly: true,
      allowedHosts: [],
      token: TOKEN,
      allowRemote: false,
      context: appContext(fs),
    });
  });

  afterAll(async () => {
    await handle.close();
  });

  it('200 con el fichero escrito y el informe ya sin la línea pendiente', async () => {
    const response = await apply({ name: 'mio', line: 31, section: 'habilidad' });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { name: string; section: string; written: readonly string[]; report: string };
    expect(body).toMatchObject({ name: 'mio', section: 'habilidad', line: 31, text: 'Kubernetes' });
    expect(body.written).toContain('skills.csv');
    expect(body.report).toContain('## Aplicado');
    expect(body.report).not.toContain('- línea 31: Kubernetes');
    expect(await fs.readTextFile('/work/import/mio/skills.csv')).toContain('Kubernetes');
  });

  it('404 cuando la línea ya no está pendiente y 422 cuando falta un dato que solo pone la persona', async () => {
    const repeated = await apply({ name: 'mio', line: 31, section: 'habilidad' });
    expect(repeated.status).toBe(404);
    const incomplete = await apply({ name: 'mio', line: 32, section: 'experiencia' });
    expect(incomplete.status).toBe(422);
    expect(((await incomplete.json()) as { error: { message: string } }).error.message).toContain('empresa, puesto y fecha de inicio');
  });

  it('con los campos que faltaban, la experiencia entra en el borrador', async () => {
    const response = await apply({ name: 'mio', line: 32, section: 'experiencia', fields: { company: 'Green Club', role: 'Finance Chair', start: '2018-09' } });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { written: readonly string[] };
    expect(body.written.some((path) => path.startsWith('experience/'))).toBe(true);
  });

  it('400 cuando el cuerpo no cumple el contrato', async () => {
    expect((await apply({ name: 'mio' })).status).toBe(400);
    expect((await apply({ name: 'mio', line: -1, section: 'habilidad' })).status).toBe(400);
    expect((await apply({ name: 'mio', line: 1, section: 'habilidad', fields: { inventado: 'x' } })).status).toBe(400);
  });
});
