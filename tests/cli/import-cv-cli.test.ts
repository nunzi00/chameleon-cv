/**
 * `cv import-cv` (T-8.4b, docs/cv-import.md §2): detección por cabecera (PDF/DOCX/desconocido), extracción
 * inyectada de items, borrador en import/<nombre>/ con README, --name/--replace, y los fallos de lectura,
 * extracción y escritura con su código de salida.
 */
import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import type { ItemsResult } from '../../src/import';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';
import { zipOf } from '../helpers/zip';

/** Items de un CV pequeño: nombre, sección de experiencia con fecha y una viñeta (layoutText reconstruye líneas). */
const ITEMS: ItemsResult = {
  ok: true,
  pages: 1,
  items: [
    { page: 1, text: 'Ada Ejemplo — Backend', x: 40, y: 700, width: 200, fontSize: 16 },
    { page: 1, text: 'Experiencia', x: 40, y: 660, width: 100, fontSize: 13 },
    { page: 1, text: 'Backend Senior · Acme · Valencia', x: 40, y: 630, width: 220, fontSize: 11 },
    { page: 1, text: 'mar 2020 – actualidad', x: 40, y: 615, width: 120, fontSize: 10 },
    { page: 1, text: '• Migré 14 servicios a Kubernetes.', x: 40, y: 600, width: 220, fontSize: 10 },
  ],
};

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function harness(extra: Record<string, string | MemoryEntry> = {}, overrides: Partial<CliContext> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem({ '/work/cv.pdf': '%PDF-1.4 finto', ...extra });
  const context: CliContext = {
    cwd: '/work',
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => Promise.resolve(''),
    datasetFileSystem: fs,
    artifactFileSystem: fs,
    parsers: defaultSourceParsers(),
    pdfExtractor: (bytes) => extractPdfText(bytes),
    itemsExtractor: async () => ITEMS,
    typstRenderer: () => Promise.reject(new Error('no usado')),
    typstInstall: () => Promise.reject(new Error('no usado')),
    typstStatus: () => Promise.reject(new Error('no usado')),
    llmStatus: (options) => llmStatus(options),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
    now: () => new Date('2026-08-30T21:00:00.000Z'),
    ...overrides,
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('cv import-cv (T-8.4b)', () => {
  it('un PDF pasa por el extractor de items y deja el borrador con README en import/<nombre>/', async () => {
    const h = harness();
    expect(await runCli(['import-cv', 'cv.pdf'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('import/ada-ejemplo\n');
    expect(h.stderr()).toContain('Borrador escrito en import/ada-ejemplo');
    const profile = h.fs.file('/work/import/ada-ejemplo/profile.md');
    expect(profile?.content).toContain('fullName: Ada Ejemplo');
    expect(profile?.mode).toBe(0o600);
    expect(h.fs.file('/work/import/ada-ejemplo/experience/backend-senior-acme.md')?.content).toContain('company: Acme');
    expect(h.fs.file('/work/import/ada-ejemplo/README.md')?.content).toContain('- Origen: cv.pdf');
  });

  it('--name elige la carpeta y --replace permite sustituir; sin él, el borrador existente se respeta', async () => {
    const existing: Record<string, MemoryEntry> = {
      '/work/import/mio': { kind: 'directory' },
      '/work/import/mio/README.md': { kind: 'file', content: 'anterior' },
      '/work/import/mio/experience/sobrante.md': { kind: 'file', content: '---\ncompany: Vieja\nrole: Antigua\nstart: 2001\n---\n' },
    };
    const denied = harness(existing);
    expect(await runCli(['import-cv', 'cv.pdf', '--name', 'mio'], denied.context)).toBe(EXIT_DATA_ERROR);
    expect(denied.stderr()).toContain('Ya existe import/mio');
    const replaced = harness(existing);
    expect(await runCli(['import-cv', 'cv.pdf', '--name', 'mio', '--replace'], replaced.context)).toBe(EXIT_OK);
    expect(replaced.fs.file('/work/import/mio/profile.md')?.content).toContain('Ada Ejemplo');
    // Sustituir es apartar y escribir de cero: si el CV nuevo trae menos entradas, las del anterior NO sobreviven
    // en la carpeta (antes se escribía encima fichero a fichero y `cv build --data` cargaba la suma de las pasadas).
    expect(replaced.fs.file('/work/import/mio/experience/sobrante.md')).toBeUndefined();
    // Y tampoco se pierden: el borrador anterior queda entero en su copia, que la CLI nombra (C9).
    const entries = await replaced.fs.readDirectory('/work/import');
    const backup = entries.map((entry) => entry.name).find((entry) => entry.startsWith('mio.') && entry.endsWith('.bak'));
    expect(backup).toBeDefined();
    expect(replaced.fs.file(`/work/import/${backup!}/experience/sobrante.md`)?.content).toContain('Vieja');
    expect(replaced.fs.file(`/work/import/${backup!}/README.md`)?.content).toBe('anterior');
    expect(replaced.stderr()).toContain(`se apartó completo en ${backup!}`);
  });

  it('los errores del extractor de PDF distinguen datos (invalid) de fallos (timeout…)', async () => {
    const invalid = harness({}, { itemsExtractor: async () => ({ ok: false as const, code: 'invalid' as const, message: 'no es un PDF' }) });
    expect(await runCli(['import-cv', 'cv.pdf'], invalid.context)).toBe(EXIT_DATA_ERROR);
    expect(invalid.stderr()).toContain('(invalid): no es un PDF');
    const failed = harness({}, { itemsExtractor: async () => ({ ok: false as const, code: 'timeout' as const, message: 'tardó demasiado' }) });
    expect(await runCli(['import-cv', 'cv.pdf'], failed.context)).toBe(EXIT_FAILURE);
  });

  it('un DOCX se extrae con el lector de zip; uno roto es un error de datos', async () => {
    const doc = '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>Ada Ejemplo</w:t></w:r></w:p></w:body></w:document>';
    const h = harness({ '/work/cv.docx': { kind: 'file', content: '', bytes: zipOf([['word/document.xml', doc]]) } });
    expect(await runCli(['import-cv', 'cv.docx'], h.context)).toBe(EXIT_OK);
    expect(h.fs.file('/work/import/ada-ejemplo/profile.md')?.content).toContain('Ada Ejemplo');
    const broken = harness({ '/work/roto.docx': { kind: 'file', content: '', bytes: new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3]) } });
    expect(await runCli(['import-cv', 'roto.docx'], broken.context)).toBe(EXIT_DATA_ERROR);
    expect(broken.stderr()).toContain('No se pudo extraer el DOCX');
  });

  it('cabecera desconocida y fichero ilegible tienen su mensaje y su código', async () => {
    const unknown = harness({ '/work/cv.txt': 'texto plano' });
    expect(await runCli(['import-cv', 'cv.txt'], unknown.context)).toBe(EXIT_DATA_ERROR);
    expect(unknown.stderr()).toContain('no es un PDF ni un DOCX');
    const missing = harness();
    expect(await runCli(['import-cv', 'no-existe.pdf'], missing.context)).toBe(EXIT_FAILURE);
    expect(missing.stderr()).toContain('No se pudo leer no-existe.pdf');
    const plain = harness();
    plain.fs.readBinaryFile = () => Promise.reject('permiso denegado');
    expect(await runCli(['import-cv', 'cv.pdf'], plain.context)).toBe(EXIT_FAILURE);
    expect(plain.stderr()).toContain('permiso denegado');
  });

  it('si la escritura falla, lo dice y sale con 2', async () => {
    const h = harness();
    h.fs.writeFile = () => Promise.reject(new Error('disco lleno'));
    expect(await runCli(['import-cv', 'cv.pdf'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('No se pudo escribir el borrador');
    const plano = harness();
    plano.fs.writeFile = () => Promise.reject('sin espacio');
    expect(await runCli(['import-cv', 'cv.pdf'], plano.context)).toBe(EXIT_FAILURE);
    expect(plano.stderr()).toContain('sin espacio');
  });

  it('sin nombre reconocible, la carpeta sale del fichero (y sin nada, «cv-importado»); los avisos remiten al README', async () => {
    const puntos = { itemsExtractor: async () => ({ ok: true as const, pages: 1, items: [{ page: 1, text: '· · ·', x: 0, y: 10, width: 10, fontSize: 10 }] }) };
    const h = harness({}, puntos);
    expect(await runCli(['import-cv', 'cv.pdf'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe('import/cv\n');
    const conAviso = harness({}, {
      itemsExtractor: async () => ({
        ok: true as const,
        pages: 1,
        items: [
          { page: 1, text: 'Ana', x: 0, y: 90, width: 30, fontSize: 16 },
          { page: 1, text: 'Experiencia', x: 0, y: 70, width: 80, fontSize: 13 },
          { page: 1, text: 'Freelance', x: 0, y: 50, width: 70, fontSize: 11 },
          { page: 1, text: 'ene 2020 – feb 2021', x: 0, y: 35, width: 110, fontSize: 10 },
        ],
      }),
    });
    expect(await runCli(['import-cv', 'cv.pdf'], conAviso.context)).toBe(EXIT_OK);
    expect(conAviso.stderr()).toContain('Revisa el README.md del borrador:');
    const sinNada = harness({ '/work/···.pdf': '%PDF-1.4 finto' }, { ...puntos, now: undefined });
    expect(await runCli(['import-cv', '···.pdf'], sinNada.context)).toBe(EXIT_OK);
    expect(sinNada.stdout()).toBe('import/cv-importado\n');
  });
});

describe('cv import-cv · informe sin avisos', () => {
  it('un CV limpio con una línea sin situar resume solo lo sin situar', async () => {
    const clean: ItemsResult = {
      ok: true,
      pages: 1,
      items: [
        { page: 1, text: 'Ada Ejemplo — Backend', x: 40, y: 700, width: 200, fontSize: 16 },
        { page: 1, text: 'Ingeniera de software con once años construyendo plataformas de pago en equipos pequeños, con foco en fiabilidad, observabilidad y entrega continua; ha liderado equipos de hasta ocho personas sin dejar de escribir código a diario.', x: 40, y: 680, width: 400, fontSize: 10 },
        { page: 1, text: 'Experiencia', x: 40, y: 660, width: 100, fontSize: 13 },
        { page: 1, text: 'Backend Senior · Acme · Valencia', x: 40, y: 630, width: 220, fontSize: 11 },
        { page: 1, text: 'mar 2020 – actualidad', x: 40, y: 615, width: 120, fontSize: 10 },
        { page: 1, text: '• Migré 14 servicios a Kubernetes.', x: 40, y: 600, width: 220, fontSize: 10 },
        { page: 1, text: 'V O L U N T A R I A D O', x: 40, y: 560, width: 180, fontSize: 12 },
        { page: 1, text: 'Cruz Roja, Valencia | 2019 – 2020', x: 40, y: 545, width: 200, fontSize: 10 },
      ],
    };
    const h = harness({}, { itemsExtractor: async () => clean });
    expect(await runCli(['import-cv', 'cv.pdf'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('Revisa el README.md del borrador: 0 avisos y 2 líneas sin situar');

    // Y sin nada que revisar (ni avisos ni líneas sueltas), el resumen no invita a abrir el informe.
    const perfect: ItemsResult = { ok: true, pages: 1, items: clean.ok ? clean.items.slice(0, 6) : [] };
    const clear = harness({}, { itemsExtractor: async () => perfect });
    expect(await runCli(['import-cv', 'cv.pdf'], clear.context)).toBe(EXIT_OK);
    expect(clear.stderr()).not.toContain('Revisa el README.md del borrador');
  });
});

describe('cv import-cv --copilot (T-8.4b F2)', () => {
  const copilotProvider = (json: unknown, floor?: number): CliContext['llmProvider'] => () =>
    Promise.resolve({
      ok: true as const,
      provider: {
        id: 'ollama',
        kind: 'local' as const,
        baseUrl: 'http://127.0.0.1:11434',
        model: 'qwen3:8b',
        ...(floor === undefined ? {} : { outputTokensFloor: floor }),
        complete: () => Promise.resolve({ ok: true as const, json, raw: JSON.stringify(json), model: 'qwen3:8b', usage: {}, elapsedMs: 3 }),
        health: () => Promise.resolve({ ok: true as const, version: undefined, models: ['qwen3:8b'], modelAvailable: true }),
      },
    });

  /** Un CV con una línea que el núcleo determinista no sabe situar. */
  const UNPLACED: ItemsResult = { ok: true, pages: 1, items: [...ITEMS.ok ? ITEMS.items : [], { page: 1, text: 'V O L U N T A R I A D O', x: 40, y: 560, width: 180, fontSize: 12 }, { page: 1, text: 'Cruz Roja, Valencia | 2019 – 2020', x: 40, y: 545, width: 200, fontSize: 10 }] };

  it('propone sección para las líneas sin situar y las deja en el README sin aplicarlas', async () => {
    const h = harness({}, { itemsExtractor: async () => UNPLACED, llmProvider: copilotProvider({ proposals: [{ n: 7, section: 'experiencia', reason: 'entidad con fechas' }] }) });
    expect(await runCli(['import-cv', 'cv.pdf', '--copilot'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('saldrán hacia ollama');
    expect(h.stderr()).toContain('El co-piloto propuso sección para 1 línea(s) sin situar');
    const readme = h.fs.file('/work/import/ada-ejemplo/README.md')?.content ?? '';
    expect(readme).toContain('## Propuestas del co-piloto (no aplicadas)');
    expect(readme).toContain('→ **experiencia**: Cruz Roja, Valencia | 2019 – 2020');
    expect(h.fs.file('/work/import/ada-ejemplo/experience/cruz-roja.md')).toBeUndefined();
  });

  it('avisa en el informe de las propuestas que el código rechaza y de los fallos del proveedor', async () => {
    const rejected = harness({}, { itemsExtractor: async () => UNPLACED, llmProvider: copilotProvider({ proposals: [{ n: 7, section: 'aficiones', reason: 'inventada' }] }) });
    expect(await runCli(['import-cv', 'cv.pdf', '--copilot'], rejected.context)).toBe(EXIT_OK);
    expect(rejected.fs.file('/work/import/ada-ejemplo/README.md')?.content).toContain('el co-piloto propuso 1 línea(s) que el código rechazó');
    const broken = harness(
      {},
      {
        itemsExtractor: async () => UNPLACED,
        llmProvider: () =>
          Promise.resolve({
            ok: true as const,
            provider: {
              id: 'ollama',
              kind: 'local' as const,
              baseUrl: 'http://127.0.0.1:11434',
              model: 'qwen3:8b',
              complete: () => Promise.resolve({ ok: false as const, code: 'timeout' as const, message: 'tardó demasiado' }),
              health: () => Promise.resolve({ ok: true as const, version: undefined, models: ['qwen3:8b'], modelAvailable: true }),
            },
          }),
      },
    );
    expect(await runCli(['import-cv', 'cv.pdf', '--copilot'], broken.context)).toBe(EXIT_OK);
    expect(broken.fs.file('/work/import/ada-ejemplo/README.md')?.content).toContain('el co-piloto no pudo proponer secciones (timeout)');
  });

  it('con un proveedor remoto pide consentimiento de coste antes de enviar y aborta sin confirmación', async () => {
    const remote: CliContext['llmProvider'] = () =>
      Promise.resolve({
        ok: true as const,
        provider: {
          id: 'groq',
          kind: 'remote' as const,
          baseUrl: 'https://api.groq.com/openai',
          model: 'llama-3.3-70b-versatile',
          complete: () => Promise.reject(new Error('no debe enviarse')),
          health: () => Promise.resolve({ ok: true as const, version: undefined, models: [], modelAvailable: true }),
        },
      });
    const h = harness({}, { itemsExtractor: async () => UNPLACED, llmProvider: remote });
    expect(await runCli(['import-cv', 'cv.pdf', '--copilot'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('Aviso de coste: 1 petición a groq');
    expect(h.stderr()).toContain('sin terminal interactiva, confirma con --yes');
    expect(h.fs.file('/work/import/ada-ejemplo/README.md')).toBeUndefined();
  });

  it('sin líneas sin situar no se envía nada, y un proveedor no disponible aborta con su código', async () => {
    let asked = 0;
    const quiet = harness(
      {},
      {
        llmProvider: () => {
          asked += 1;
          return copilotProvider({ proposals: [] })({ provider: undefined, model: undefined });
        },
      },
    );
    expect(await runCli(['import-cv', 'cv.pdf', '--copilot'], quiet.context)).toBe(EXIT_OK);
    expect(asked).toBe(1);
    expect(quiet.fs.file('/work/import/ada-ejemplo/README.md')?.content).not.toContain('Propuestas del co-piloto');
    const missing = harness({}, { llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor configurado' }) });
    expect(await runCli(['import-cv', 'cv.pdf', '--copilot'], missing.context)).toBe(EXIT_FAILURE);
    expect(missing.stderr()).toContain('sin proveedor configurado');
  });
});

describe('cv import-cv --all (T-9.14)', () => {
  it('importa todos los CV de una carpeta, uno por fichero, y los compara en una tabla', async () => {
    // Dos CV de la MISMA persona: con el nombre del perfil querrían la misma carpeta y solo entraría el primero.
    const h = harness({ '/work/corpus/uno.pdf': '%PDF-1.4 uno', '/work/corpus/dos.pdf': '%PDF-1.4 dos' });
    expect(await runCli(['import-cv', 'corpus', '--all'], h.context)).toBe(EXIT_OK);
    const filas = h.stdout().trim().split('\n');
    expect(filas[0]).toMatch(/^Fichero\s+Borrador\s+Exp\.\s+Form\.\s+Hab\.\s+Avisos\s+Sin situar$/);
    // Orden estable por nombre de fichero: «dos» antes que «uno».
    expect(filas[1]).toContain('import/dos');
    expect(filas[2]).toContain('import/uno');
    expect(h.stderr()).toContain('2 de 2 CV importados');
  });

  it('un CV que falla no detiene a los demás: se anota y la tabla sale igual', async () => {
    const h = harness({ '/work/corpus/bueno.pdf': '%PDF-1.4 uno', '/work/corpus/malo.pdf': 'esto no es un PDF' });
    expect(await runCli(['import-cv', 'corpus', '--all'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('import/bueno');
    expect(h.stderr()).toContain('No se pudo importar malo.pdf');
    expect(h.stderr()).toContain('1 de 2 CV importados');

    // Y si fallan todos, el código de salida lo dice.
    const ninguno = harness({ '/work/corpus/malo.pdf': 'esto no es un PDF' });
    expect(await runCli(['import-cv', 'corpus', '--all'], ninguno.context)).not.toBe(EXIT_OK);
    expect(ninguno.stderr()).toContain('0 de 1 CV importados');
  });

  it('una carpeta sin CV, o que no existe, se dice sin dejar nada a medias', async () => {
    const vacia = harness({ '/work/corpus/notas.txt': 'nada que importar' });
    expect(await runCli(['import-cv', 'corpus', '--all'], vacia.context)).not.toBe(EXIT_OK);
    expect(vacia.stderr()).toContain('No hay CV que importar');
    const ninguna = harness({});
    expect(await runCli(['import-cv', 'no-existe', '--all'], ninguna.context)).toBe(2);
    expect(ninguna.stderr()).toContain('No se pudo leer la carpeta');
  });

  it('un CV que ni siquiera se puede leer se anota como los demás, no revienta la tanda', async () => {
    const h = harness({ '/work/corpus/bueno.pdf': '%PDF-1.4 uno', '/work/corpus/ilegible.pdf': '%PDF-1.4 dos' });
    const disco = new Proxy(h.fs, {
      get: (target, key) =>
        key === 'readBinaryFile'
          ? (path: string) => (path.endsWith('ilegible.pdf') ? Promise.reject(new Error('permiso denegado')) : target.readBinaryFile(path))
          : Reflect.get(target, key, target),
    });
    expect(await runCli(['import-cv', 'corpus', '--all'], { ...h.context, datasetFileSystem: disco })).toBe(EXIT_OK);
    expect(h.stdout()).toContain('import/bueno');
    expect(h.stderr()).toContain('No se pudo importar ilegible.pdf: No se pudo leer corpus/ilegible.pdf: permiso denegado');
    expect(h.stderr()).toContain('1 de 2 CV importados');
  });

  it('--all no se combina con --copilot ni con --name', async () => {
    const h = harness({ '/work/corpus/uno.pdf': '%PDF-1.4 uno' });
    expect(await runCli(['import-cv', 'corpus', '--all', '--copilot'], h.context)).not.toBe(EXIT_OK);
    expect(h.stderr()).toContain('no se combinan');
    const conNombre = harness({ '/work/corpus/uno.pdf': '%PDF-1.4 uno' });
    expect(await runCli(['import-cv', 'corpus', '--all', '--name', 'mio'], conNombre.context)).not.toBe(EXIT_OK);
    expect(conNombre.stderr()).toContain('--name no aplica');
  });
});
