/**
 * Ofertas por URL en la CLI (T-8.5 S1, docs/offers-from-url.md §4.3): --allow-remote obligatorio, confirmación por
 * petición (o --yes), descarga con el doble de red (sin DNS: IP literal pública), procedencia por stderr,
 * --save-offer con cabecera de origen y --replace, y el listado de offers/ sin argumento o con --list.
 */
import { describe, expect, it } from 'vitest';

import { defaultAssets } from '../../src/shared/assets';
import { serializeProfile } from '../../src/artifact';
import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache, llmStatus } from '../../src/llm';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import type { FetchedResponse } from '../../src/typst/download';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';
import { join } from 'node:path';

let artifact = '';
const OFFER_URL = 'https://203.0.113.10/ofertas/backend-senior';

const PAGE = `<html><head><title>t</title></head><body><script type="application/ld+json">${JSON.stringify({
  '@type': 'JobPosting',
  title: 'Backend Senior',
  hiringOrganization: { name: 'Acme' },
  description: '<p>APIs REST con PHP y PostgreSQL; despliegues con Docker y Kubernetes; guardias y SLO. '.repeat(12) + '</p>',
})}</script></body></html>`;

function page(content: string, contentType = 'text/html; charset=utf-8'): FetchedResponse {
  const bytes = new TextEncoder().encode(content);
  return {
    ok: true,
    status: 200,
    url: OFFER_URL,
    body: (async function* () {
      yield bytes;
    })(),
    contentLength: bytes.byteLength,
    contentType,
  };
}

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

async function loadArtifact(): Promise<string> {
  if (artifact === '') {
    const dataset = await loadDataset(join(__dirname, '../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
    if (!dataset.ok) {
      throw new Error('dataset');
    }
    artifact = serializeProfile(dataset.profile);
  }
  return artifact;
}

async function harness(extra: Record<string, string | MemoryEntry> = {}, overrides: Partial<CliContext> = {}): Promise<Harness> {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem({
    '/work/data/sources/profile.md': { kind: 'file', content: '---\nfullName: Ada\n---\n', mtimeMs: 100 },
    '/work/data/dist/profile.json': { kind: 'file', content: await loadArtifact(), mode: 0o600, mtimeMs: 500 },
    ...extra,
  });
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
    typstRenderer: () => Promise.reject(new Error('no usado')),
    typstInstall: () => Promise.reject(new Error('no usado')),
    typstStatus: () => Promise.reject(new Error('no usado')),
    llmStatus: (options) => llmStatus(options),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
    fetcher: async () => page(PAGE),
    ...overrides,
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('cv analyze-offer con URL (T-8.5)', () => {
  it('sin --allow-remote se niega con la alternativa; una URL http es un error de datos', async () => {
    const h = await harness();
    expect(await runCli(['analyze-offer', OFFER_URL], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('exige --allow-remote');
    const insecure = await harness();
    expect(await runCli(['analyze-offer', 'http://203.0.113.10/x', '--allow-remote', '--yes'], insecure.context)).toBe(EXIT_DATA_ERROR);
    expect(insecure.stderr()).toContain('https');
  });

  it('con --allow-remote pide confirmación: sin terminal exige --yes, y un «no» cancela sin descargar', async () => {
    const noTty = await harness();
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote'], noTty.context)).toBe(EXIT_FAILURE);
    expect(noTty.stderr()).toContain('confirma con --yes');
    let asked = '';
    const refused = await harness({}, {
      confirm: async (question) => {
        asked = question;
        return false;
      },
    });
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote'], refused.context)).toBe(EXIT_FAILURE);
    expect(asked).toContain('host 203.0.113.10');
    expect(asked).toContain('máximo 2 MB');
    expect(refused.stderr()).toContain('Descarga cancelada');
    const accepted = await harness({}, { confirm: async () => true });
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote'], accepted.context)).toBe(EXIT_OK);
    expect(accepted.stderr()).toContain('procedencia: json-ld');
  });

  it('descarga con --yes, imprime la procedencia por stderr y analiza con el nombre de la oferta', async () => {
    const h = await harness();
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain(`Oferta descargada de ${OFFER_URL}`);
    expect(h.stderr()).toContain('procedencia: json-ld');
    expect(h.stdout()).toContain('backend-senior-acme');
  });

  it('--save-offer guarda en offers/ con cabecera de origen; sin --replace no sobrescribe; con él, sí', async () => {
    const h = await harness();
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes', '--save-offer'], h.context)).toBe(EXIT_OK);
    const saved = h.fs.file('/work/offers/backend-senior-acme.txt');
    expect(saved?.content).toContain(`# Origen: ${OFFER_URL}`);
    expect(saved?.content).toContain('Título: Backend Senior');
    expect(saved?.mode).toBe(0o600);
    const again = await harness({ '/work/offers/backend-senior-acme.txt': 'anterior' });
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes', '--save-offer'], again.context)).toBe(EXIT_DATA_ERROR);
    expect(again.stderr()).toContain('usa --replace');
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes', '--save-offer', '--replace'], again.context)).toBe(EXIT_OK);
    const named = await harness();
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes', '--save-offer', 'julio/acme.md'], named.context)).toBe(EXIT_OK);
    expect(named.fs.file('/work/offers/julio/acme.md')?.content).toContain('# Origen:');
    const bare = await harness();
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes', '--save-offer', 'notas/breve'], bare.context)).toBe(EXIT_OK);
    expect(bare.fs.file('/work/offers/notas/breve.txt')?.content).toContain('# Origen:');
    const outside = await harness();
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes', '--save-offer', '../fuera'], outside.context)).toBe(EXIT_DATA_ERROR);
    expect(outside.stderr()).toContain('dentro de offers/');
  });

  it('sin argumento lista offers/ y sale con 2; --list sale con 0; vacío lo dice', async () => {
    const h = await harness({ '/work/offers/acme.txt': { kind: 'file', content: 'x', mtimeMs: 2000 }, '/work/offers/vieja/zeta.pdf': { kind: 'file', content: 'y', mtimeMs: 1000 }, '/work/offers/notas.ini': 'no es una oferta' });
    expect(await runCli(['analyze-offer'], h.context)).toBe(EXIT_FAILURE);
    const lines = h.stdout().split('\n').filter((line) => line !== '');
    expect(lines[0]).toContain('offers/acme.txt');
    expect(lines[1]).toContain('offers/vieja/zeta.pdf');
    expect(h.stderr()).toContain('2 ofertas en offers/');
    const listed = await harness({ '/work/offers/acme.txt': 'x' });
    expect(await runCli(['analyze-offer', '--list'], listed.context)).toBe(EXIT_OK);
    const empty = await harness();
    expect(await runCli(['analyze-offer'], empty.context)).toBe(EXIT_FAILURE);
    expect(empty.stderr()).toContain('No hay ofertas en offers/');
  });

  it('imprime los avisos de extracción por stderr (descripción corta: el cuerpo sustituye al JSON-LD)', async () => {
    const body = 'Buscamos backend senior con PHP, PostgreSQL, Docker y Kubernetes para pagos. '.repeat(30);
    const short = `<html><head><title>t</title></head><body><script type="application/ld+json">${JSON.stringify({
      '@type': 'JobPosting',
      title: 'Backend Senior',
      hiringOrganization: { name: 'Acme' },
      description: '<p>Vacante de backend en Acme.</p>',
    })}</script><main><p>${body}</p></main></body></html>`;
    const h = await harness({}, { fetcher: async () => page(short) });
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toMatch(/Aviso: la descripción del JSON-LD tiene \d+ palabras/);
    expect(h.stderr()).toContain('procedencia: json-ld+cuerpo');
  });

  it('si offers/ no se puede escribir, --save-offer falla con el motivo y sale con 2', async () => {
    const h = await harness();
    h.fs.writeFile = () => Promise.reject(new Error('disco lleno'));
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes', '--save-offer'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('No se pudo guardar la oferta en offers/backend-senior-acme.txt: disco lleno');
    const plain = await harness();
    plain.fs.writeFile = () => Promise.reject('sin espacio');
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes', '--save-offer'], plain.context)).toBe(EXIT_FAILURE);
    expect(plain.stderr()).toContain('sin espacio');
  });

  it('el listado se detiene en 500 entradas', async () => {
    const many = Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`/work/offers/m${String(i).padStart(3, '0')}.txt`, 'x']));
    const h = await harness(many);
    expect(await runCli(['analyze-offer'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('500 ofertas en offers/');
  });

  it('el listado ignora lo que está a más de tres niveles de offers/', async () => {
    const h = await harness({ '/work/offers/a/b/c/d/honda.txt': 'x' });
    expect(await runCli(['analyze-offer'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stdout()).not.toContain('honda.txt');
    expect(h.stderr()).toContain('No hay ofertas en offers/');
  });

  it('una URL https irresoluble es un error de datos', async () => {
    const h = await harness();
    expect(await runCli(['analyze-offer', 'https://', '--allow-remote', '--yes'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toContain('no es una URL válida');
  });

  it('sin doble de red, el guardia corta una URL de loopback antes de descargar nada', async () => {
    const h = await harness({}, { fetcher: undefined });
    expect(await runCli(['analyze-offer', 'https://127.0.0.1/oferta', '--allow-remote', '--yes'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toContain('127.0.0.1');
  });

  it('una oferta en PDF pasa por el extractor del contexto; si el PDF no se puede leer, lo dice', async () => {
    const text = 'Backend senior en Acme: APIs REST con PHP y PostgreSQL, despliegues con Docker y Kubernetes, guardias y SLO. '.repeat(8);
    const ok = await harness({}, {
      fetcher: async () => page('%PDF-1.4 finto', 'application/pdf'),
      pdfExtractor: async () => ({ ok: true as const, text, pages: 1 }),
    });
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes', '--save-offer'], ok.context)).toBe(EXIT_OK);
    expect(ok.stderr()).toContain('pdf');
    expect(ok.fs.file('/work/offers/backend-senior.txt')?.content).toContain('# Origen:');
    const ko = await harness({}, {
      fetcher: async () => page('%PDF-1.4 finto', 'application/pdf'),
      pdfExtractor: async () => ({ ok: false as const, message: 'PDF cifrado' }),
    });
    expect(await runCli(['analyze-offer', OFFER_URL, '--allow-remote', '--yes'], ko.context)).toBe(EXIT_FAILURE);
    expect(ko.stderr()).toContain('PDF cifrado');
  });

  it('con offers/ vacío, --list sale con 0', async () => {
    const h = await harness();
    expect(await runCli(['analyze-offer', '--list'], h.context)).toBe(EXIT_OK);
    expect(h.stderr()).toContain('No hay ofertas en offers/');
  });
});

describe('cv generate-cv -f con URL (T-8.5)', () => {
  it('sin --allow-remote se niega; con --yes descarga y el CV lleva el sufijo de la oferta', async () => {
    const denied = await harness();
    expect(await runCli(['generate-cv', '-f', OFFER_URL], denied.context)).toBe(EXIT_FAILURE);
    expect(denied.stderr()).toContain('exige --allow-remote');
    const h = await harness();
    expect(await runCli(['generate-cv', '-f', OFFER_URL, '--allow-remote', '--yes'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toMatch(/CV escrito en \/work\/output\/cv-[a-z-]+-backend-senior-acme\.md/);
  });
});
