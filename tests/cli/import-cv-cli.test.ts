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
    expect(h.fs.file('/work/import/ada-ejemplo/README.md')?.content).toContain('# Informe del borrador importado');
  });

  it('--name elige la carpeta y --replace permite sustituir; sin él, el borrador existente se respeta', async () => {
    const existing: Record<string, MemoryEntry> = { '/work/import/mio': { kind: 'directory' }, '/work/import/mio/README.md': { kind: 'file', content: 'anterior' } };
    const denied = harness(existing);
    expect(await runCli(['import-cv', 'cv.pdf', '--name', 'mio'], denied.context)).toBe(EXIT_DATA_ERROR);
    expect(denied.stderr()).toContain('Ya existe import/mio');
    const replaced = harness(existing);
    expect(await runCli(['import-cv', 'cv.pdf', '--name', 'mio', '--replace'], replaced.context)).toBe(EXIT_OK);
    expect(replaced.fs.file('/work/import/mio/profile.md')?.content).toContain('Ada Ejemplo');
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
