/**
 * Corpus del spike (T-8.4, docs/pdf-import-spike.md §4.1): PDF sintéticos con verdad conocida, regenerados desde
 * fuentes versionadas en `build/spike/pdf-import/corpus/` (los PDF no se versionan: los de pdfkit dependen de la
 * zlib de la máquina).
 *
 * - A · propios: el perfil del banco con pdfkit y con los cinco temas de Typst (más `default` en inglés).
 * - B · ajenos: el mismo perfil maquetado con las plantillas «ajenas» de `tests/spike/pdf-import/layouts/`.
 * - C · límites: un PDF solo imagen, uno de 60 páginas y uno con columnas entrelazadas.
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { crc32, deflateSync } from 'node:zlib';

import PDFDocument from 'pdfkit';

import type { MasterProfile } from '../../../src/core/schema';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../../src/parsers';
import { renderPdfCv } from '../../../src/renderers/pdf';
import { renderTypstCv } from '../../../src/renderers/typst';
import { builtinThemeRoot, listThemes, loadTheme, type LoadedTheme, type ThemeRoot } from '../../../src/themes';

export const ROOT = resolve(__dirname, '..', '..', '..');
export const CORPUS_ROOT = join(ROOT, 'build', 'spike', 'pdf-import', 'corpus');
export const LAYOUTS_DIRECTORY = join(ROOT, 'tests', 'spike', 'pdf-import', 'layouts');
const BENCH_SOURCES = join(ROOT, 'tests', 'acceptance', 'bench', 'workspace', 'data', 'sources');
/** Fecha fija para los PDF (reproducibilidad). */
const CREATED_AT = new Date(Date.UTC(2026, 7, 15, 9, 0, 0));

export type Group = 'a' | 'b' | 'c';

export interface CorpusEntry {
  readonly group: Group;
  readonly name: string;
  readonly pdf: string;
  /** Perfil del que salió el PDF (grupos A y B); los del grupo C no tienen verdad. */
  readonly truth: string | undefined;
  readonly locale: string;
}

export async function benchProfile(): Promise<MasterProfile> {
  const dataset = await loadDataset(BENCH_SOURCES, { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error(`Banco inválido: ${dataset.errors.map((error) => `${error.file}: ${error.message}`).join('; ')}`);
  }
  return dataset.profile;
}

export function layoutRoot(): ThemeRoot {
  return { directory: LAYOUTS_DIRECTORY, fileSystem: new NodeFileSystem(), builtin: false };
}

export async function layoutNames(): Promise<string[]> {
  return listThemes([layoutRoot()]);
}

async function themeOrThrow(name: string, roots: readonly ThemeRoot[]): Promise<LoadedTheme> {
  const loaded = await loadTheme(name, roots);
  if (!loaded.ok) {
    throw new Error(loaded.message);
  }
  return loaded.theme;
}

async function typstPdf(profile: MasterProfile, theme: LoadedTheme, locale: string): Promise<Buffer> {
  const result = await renderTypstCv(profile, { theme, locale, createdAt: CREATED_AT });
  if (!result.ok) {
    throw new Error(`${theme.name}: ${result.error.message}`);
  }
  return result.pdf;
}

/** Un PNG de 8×8 gris, escrito a mano (firma, IHDR, IDAT y IEND): para el PDF «solo imagen» sin dependencias. */
export function tinyPng(): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(8, 0);
  header.writeUInt32BE(8, 4);
  header[8] = 8; // bits por muestra
  header[9] = 0; // escala de grises
  const raw = Buffer.concat(Array.from({ length: 8 }, (_, row) => Buffer.from([0, ...Array.from({ length: 8 }, (_unused, column) => ((row + column) % 2 === 0 ? 40 : 200))])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

function pdfkitDocument(build: (doc: PDFKit.PDFDocument) => void): Promise<Buffer> {
  return new Promise((resolvePdf, reject) => {
    const doc = new PDFDocument({ size: 'A4', pdfVersion: '1.7', info: { CreationDate: CREATED_AT, ModDate: CREATED_AT, Producer: 'spike', Creator: 'spike' } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', reject);
    build(doc);
    doc.end();
  });
}

/** Solo una imagen: sin capa de texto (el OCR queda fuera; el spike debe decirlo, no inventar). */
export function imageOnlyPdf(): Promise<Buffer> {
  return pdfkitDocument((doc) => {
    doc.image(tinyPng(), 72, 72, { width: 400 });
  });
}

/** Sesenta páginas con texto: por encima del límite de 50 del extractor. */
export function sixtyPagesPdf(): Promise<Buffer> {
  return pdfkitDocument((doc) => {
    doc.font(join(ROOT, 'templates', 'fonts', 'SourceSans3-Regular.ttf')).fontSize(12);
    for (let page = 1; page <= 60; page += 1) {
      if (page > 1) {
        doc.addPage();
      }
      doc.text(`Página ${page} de un CV imposible de largo.`);
    }
  });
}

export interface GeneratedFile {
  readonly group: Group;
  readonly name: string;
  readonly path: string;
  readonly bytes: number;
}

/** Genera el corpus completo; devuelve lo escrito. Exige Typst (CHAMELEON_TYPST o la caché de `cv typst install`). */
export async function generateCorpus(root: string = CORPUS_ROOT): Promise<GeneratedFile[]> {
  const profile = await benchProfile();
  const written: GeneratedFile[] = [];
  const save = (group: Group, name: string, bytes: Buffer, truth: MasterProfile | undefined, locale: string): void => {
    const directory = join(root, group);
    mkdirSync(directory, { recursive: true });
    const pdf = join(directory, `${name}.pdf`);
    writeFileSync(pdf, bytes);
    const entry: CorpusEntry = { group, name, pdf, truth: truth === undefined ? undefined : join(directory, `${name}.truth.json`), locale };
    if (truth !== undefined) {
      writeFileSync(entry.truth!, `${JSON.stringify(truth, null, 2)}\n`);
    }
    writeFileSync(join(directory, `${name}.entry.json`), `${JSON.stringify(entry, null, 2)}\n`);
    written.push({ group, name, path: pdf, bytes: bytes.length });
  };

  // A · propios
  save('a', 'pdfkit', await renderPdfCv(profile, { createdAt: CREATED_AT }), profile, 'es-ES');
  const builtin = [builtinThemeRoot()];
  for (const name of await listThemes(builtin)) {
    save('a', `typst-${name}`, await typstPdf(profile, await themeOrThrow(name, builtin), 'es-ES'), profile, 'es-ES');
  }
  save('a', 'typst-default-en', await typstPdf(profile, await themeOrThrow('default', builtin), 'en-US'), profile, 'en-US');

  // B · ajenos (plantillas del spike) y C · columnas entrelazadas (también una plantilla)
  const layouts = [layoutRoot()];
  for (const name of await layoutNames()) {
    const theme = await themeOrThrow(name, layouts);
    const locale = name.endsWith('-en') ? 'en-US' : 'es-ES';
    if (name === 'interleaved') {
      save('c', 'interleaved', await typstPdf(profile, theme, locale), profile, locale);
    } else {
      save('b', name, await typstPdf(profile, theme, locale), profile, locale);
    }
  }

  // C · límites
  save('c', 'image-only', await imageOnlyPdf(), undefined, 'es-ES');
  save('c', 'sixty-pages', await sixtyPagesPdf(), undefined, 'es-ES');
  return written;
}

/** Las entradas del corpus ya generado (por grupo y nombre). */
export function readCorpus(root: string = CORPUS_ROOT): CorpusEntry[] {
  const entries: CorpusEntry[] = [];
  for (const group of ['a', 'b', 'c'] as const) {
    let files: string[];
    try {
      files = readdirSync(join(root, group));
    } catch {
      continue;
    }
    for (const file of files.filter((name) => name.endsWith('.entry.json')).sort()) {
      entries.push(JSON.parse(require('node:fs').readFileSync(join(root, group, file), 'utf8')) as CorpusEntry);
    }
  }
  return entries;
}
