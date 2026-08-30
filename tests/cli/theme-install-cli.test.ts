/**
 * `cv theme install`, `cv theme verify` y `cv theme list --verify` (T-8.3, docs/theme-gallery.md §4.2–§4.3): salida,
 * códigos y el consentimiento antes de la única descarga (`--yes`, pregunta s/N, sin terminal).
 */
import { describe, expect, it } from 'vitest';

import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache } from '../../src/llm';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { defaultAssets } from '../../src/shared/assets';
import { ORIGIN_FILE, sha256Hex } from '../../src/themes';
import { installTypst, typstStatus, type FetchedResponse, type Fetcher } from '../../src/typst';
import { themeToml } from '../fixtures/theme';
import { buildZip } from '../helpers/archives';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

const TYP = '#let cv(d, theme) = d.fullName\n';
const TOML = themeToml('comunidad').replace('name = "comunidad"', 'name = "comunidad"\ndescription = "Tema de la comunidad"\nauthor = "Ada"\nlicense = "MIT"');
const ZIP = buildZip([
  { path: 'comunidad/' },
  { path: 'comunidad/theme.toml', data: TOML },
  { path: 'comunidad/template.typ', data: TYP },
  { path: 'comunidad/fonts/' },
  { path: 'comunidad/fonts/libre-1.ttf', data: new Uint8Array([1, 2, 3]) },
]);
const NOW = new Date('2026-08-30T10:00:00.000Z');

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

function harness(tree: Record<string, string | MemoryEntry> = {}, overrides: Partial<CliContext> = {}): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem({ '/work/themes/comunidad.zip': { kind: 'file', content: '', bytes: ZIP }, ...tree });
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
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: () => Promise.reject(new Error('no usado')),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor en las pruebas' }),
    llmCache: new MemoryLlmCache(),
    assets: defaultAssets(),
    now: () => NOW,
    fetcher: () => Promise.reject(new Error('la red no debe tocarse en esta prueba')),
    ...overrides,
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

async function* once(bytes: Uint8Array): AsyncGenerator<Uint8Array> {
  yield bytes;
}

function respond(bytes: Uint8Array, overrides: Partial<FetchedResponse> = {}): Fetcher {
  return () => Promise.resolve({ ok: true, status: 200, url: 'https://cdn.example/comunidad.zip', body: once(bytes), contentLength: bytes.length, ...overrides });
}

describe('cv theme install desde un origen local', () => {
  it('instala, lista los ficheros con sus huellas, fija el origen y recuerda cómo usarlo y verificarlo', async () => {
    const h = harness();
    expect(await runCli(['theme', 'install', 'themes/comunidad.zip'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(
      [
        'Tema «comunidad» instalado en /work/themes/comunidad desde el archivo /work/themes/comunidad.zip',
        `  fonts/libre-1.ttf         3 bytes  ${sha256Hex(new Uint8Array([1, 2, 3]))}`,
        `  template.typ       ${String(TYP.length).padStart(8)} bytes  ${sha256Hex(Buffer.from(TYP))}`,
        `  theme.toml         ${String(TOML.length).padStart(8)} bytes  ${sha256Hex(Buffer.from(TOML))}`,
        `Huella del archivo (SHA-256): ${sha256Hex(ZIP)}`,
        'Origen fijado en /work/themes/comunidad/.origin.json. Úsalo con «cv generate-cv --format pdf --engine typst --theme comunidad» y compruébalo con «cv theme verify comunidad»; el tema se ejecuta contenido, como todos.',
        '',
      ].join('\n'),
    );
    expect(h.stderr()).toBe('');
    expect(h.fs.file(`/work/themes/comunidad/${ORIGIN_FILE}`)?.content).toContain('"kind": "archive"');
  });

  it('--dry-run muestra el plan sin escribir (y avisa de lo que --replace apartaría); --sha256 se confirma en la salida', async () => {
    const h = harness();
    expect(await runCli(['theme', 'install', 'themes/comunidad.zip', '--dry-run', '--sha256', sha256Hex(ZIP)], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Plan (--dry-run): el tema «comunidad» se instalaría en /work/themes/comunidad desde el archivo /work/themes/comunidad.zip\n');
    expect(h.stdout()).toContain(`Huella del archivo (SHA-256): ${sha256Hex(ZIP)} · coincide con --sha256\n`);
    expect(h.stdout()).toContain('No se ha escrito nada (--dry-run)\n');
    expect(h.fs.file('/work/themes/comunidad/theme.toml')).toBeUndefined();
    const occupied = harness({ '/work/themes/comunidad/theme.toml': themeToml('comunidad'), '/work/themes/comunidad/template.typ': TYP });
    expect(await runCli(['theme', 'install', 'themes/comunidad.zip', '--dry-run'], occupied.context)).toBe(EXIT_OK);
    expect(occupied.stdout()).toContain('No se ha escrito nada (--dry-run); con --replace se apartaría /work/themes/comunidad a una copia .bak\n');
    expect(await runCli(['theme', 'install', 'themes/comunidad.zip'], occupied.context)).toBe(EXIT_DATA_ERROR);
    expect(occupied.stderr()).toContain('Ya existe /work/themes/comunidad: usa --replace');
    expect(await runCli(['theme', 'install', 'themes/comunidad.zip', '--replace', '--as', 'default'], occupied.context)).toBe(EXIT_OK);
    expect(occupied.stderr()).toContain('Aviso: «default» también es un tema distribuido; el del proyecto prevalecerá\n');
    const replaced = harness({ '/work/themes/comunidad/theme.toml': themeToml('comunidad'), '/work/themes/comunidad/template.typ': TYP });
    expect(await runCli(['theme', 'install', 'themes/comunidad.zip', '--replace'], replaced.context)).toBe(EXIT_OK);
    expect(replaced.stderr()).toMatch(/^El tema anterior se ha apartado a \/work\/themes\/comunidad\.\d{8}-\d{6}\.bak\n$/);
  });

  it('un directorio local se instala con la huella de su contenido; los orígenes rechazados y los archivos malos dan código 1 o 2', async () => {
    const h = harness({ '/work/themes/mio/theme.toml': themeToml('mio'), '/work/themes/mio/template.typ': TYP });
    expect(await runCli(['theme', 'install', 'themes/mio', '--as', 'copia-mio'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('Tema «copia-mio» instalado en /work/themes/copia-mio desde el directorio /work/themes/mio\n');
    expect(h.stdout()).toContain('Huella del contenido (SHA-256): ');
    const http = harness();
    expect(await runCli(['theme', 'install', 'http://cdn.example/tema.zip'], http.context)).toBe(EXIT_DATA_ERROR);
    expect(http.stderr()).toBe('Origen no admitido «http://cdn.example/tema.zip»: solo URL https:// o rutas locales (nada de http://)\n');
    const missing = harness();
    expect(await runCli(['theme', 'install', 'themes/nada.zip'], missing.context)).toBe(EXIT_FAILURE);
    expect(missing.stderr()).toBe('No existe «/work/themes/nada.zip»\n');
    const escape = harness({ '/work/themes/escapa.zip': { kind: 'file', content: '', bytes: buildZip([{ path: '../fuera', data: 'x' }]) } });
    expect(await runCli(['theme', 'install', 'themes/escapa.zip'], escape.context)).toBe(EXIT_DATA_ERROR);
    expect(escape.stderr()).toBe('El archivo «/work/themes/escapa.zip» no es un tema instalable: La entrada «../fuera» sale del tema («..»): no se admite\n');
  });
});

describe('cv theme install desde una URL https: consentimiento antes de descargar', () => {
  const ANNOUNCEMENT = 'Se descargará «https://cdn.example/descargas/comunidad.zip» (host cdn.example, máximo 8 MiB) para instalarlo como themes/<nombre del tema>/; la huella se mostrará antes de instalar\n';

  it('sin terminal y sin --yes cancela sin tocar la red; con la pregunta respondida «no» también', async () => {
    const h = harness();
    expect(await runCli(['theme', 'install', 'https://cdn.example/descargas/comunidad.zip'], h.context)).toBe(EXIT_FAILURE);
    expect(h.stderr()).toBe(`${ANNOUNCEMENT}Operación cancelada: no se ha descargado nada: sin terminal interactiva, confirma con --yes\n`);
    expect(h.stdout()).toBe('');
    const questions: string[] = [];
    const refused = harness({}, {
      confirm: (question) => {
        questions.push(question);
        return Promise.resolve(false);
      },
    });
    expect(await runCli(['theme', 'install', 'https://cdn.example/descargas/comunidad.zip'], refused.context)).toBe(EXIT_FAILURE);
    expect(questions).toEqual(['¿Descargar e instalar el tema? [s/N] ']);
    expect(refused.stderr()).toBe(`${ANNOUNCEMENT}Operación cancelada: no se ha descargado nada\n`);
  });

  it('con «sí» o con --yes descarga con el doble, instala desde la URL final y anuncia el nombre pedido con --as', async () => {
    const accepted = harness({}, { confirm: () => Promise.resolve(true), fetcher: respond(ZIP) });
    expect(await runCli(['theme', 'install', 'https://cdn.example/descargas/comunidad.zip'], accepted.context)).toBe(EXIT_OK);
    expect(accepted.stderr()).toBe(ANNOUNCEMENT);
    expect(accepted.stdout()).toContain('Tema «comunidad» instalado en /work/themes/comunidad desde la URL https://cdn.example/comunidad.zip\n');
    expect(accepted.fs.file(`/work/themes/comunidad/${ORIGIN_FILE}`)?.content).toContain('"source": "https://cdn.example/comunidad.zip"');
    const yes = harness({}, { fetcher: respond(ZIP) });
    expect(await runCli(['theme', 'install', 'https://cdn.example/descargas/comunidad.zip', '--yes', '--as', 'otra'], yes.context)).toBe(EXIT_OK);
    expect(yes.stderr()).toBe(`${ANNOUNCEMENT.replace('themes/<nombre del tema>/', 'themes/otra/')}Confirmado con --yes\n`);
    expect(yes.stdout()).toContain('Tema «otra» instalado en /work/themes/otra desde la URL https://cdn.example/comunidad.zip\n');
    const failed = harness({}, { fetcher: respond(ZIP, { ok: false, status: 404 }) });
    expect(await runCli(['theme', 'install', 'https://cdn.example/descargas/comunidad.zip', '--yes'], failed.context)).toBe(EXIT_FAILURE);
    expect(failed.stderr()).toContain('La descarga de «https://cdn.example/descargas/comunidad.zip» respondió HTTP 404\n');
  });
});

describe('cv theme verify y cv theme list --verify', () => {
  it('informa de intacto, sin origen y modificado (código 1), y list marca el origen y su estado', async () => {
    const h = harness({ '/work/themes/mio/theme.toml': themeToml('mio'), '/work/themes/mio/template.typ': TYP });
    expect(await runCli(['theme', 'install', 'themes/comunidad.zip'], h.context)).toBe(EXIT_OK);
    const intact = harness({}, { datasetFileSystem: h.fs, artifactFileSystem: h.fs });
    expect(await runCli(['theme', 'verify'], intact.context)).toBe(EXIT_OK);
    expect(intact.stdout()).toBe('comunidad: intacto (origen /work/themes/comunidad.zip, instalado el 2026-08-30T10:00:00.000Z)\nmio: sin origen registrado (tema creado o copiado a mano)\n');
    const listed = harness({}, { datasetFileSystem: h.fs, artifactFileSystem: h.fs });
    expect(await runCli(['theme', 'list', '--verify'], listed.context)).toBe(EXIT_OK);
    expect(listed.stdout()).toContain('comunidad  del proyecto  Tema de la comunidad · autor: Ada · licencia: MIT · origen: /work/themes/comunidad.zip, intacto\n');
    expect(listed.stdout()).toContain('mio        del proyecto  sin descripción\n');
    await h.fs.writeFile('/work/themes/comunidad/template.typ', '#let cv(d, theme) = [cambiado]', 0o644);
    await h.fs.writeFile('/work/themes/comunidad/README.md', 'nuevo', 0o644);
    const modified = harness({}, { datasetFileSystem: h.fs, artifactFileSystem: h.fs });
    expect(await runCli(['theme', 'verify', 'comunidad'], modified.context)).toBe(EXIT_DATA_ERROR);
    expect(modified.stdout()).toBe('comunidad: modificado localmente: README.md (añadido), template.typ (modificado) (origen /work/themes/comunidad.zip, instalado el 2026-08-30T10:00:00.000Z)\n');
    const relisted = harness({}, { datasetFileSystem: h.fs, artifactFileSystem: h.fs });
    expect(await runCli(['theme', 'list', '--verify'], relisted.context)).toBe(EXIT_OK);
    expect(relisted.stdout()).toContain('origen: /work/themes/comunidad.zip, MODIFICADO LOCALMENTE\n');
    const plain = harness({}, { datasetFileSystem: h.fs, artifactFileSystem: h.fs });
    expect(await runCli(['theme', 'list'], plain.context)).toBe(EXIT_OK);
    expect(plain.stdout()).toContain('origen: /work/themes/comunidad.zip\n');
    await h.fs.writeFile(`/work/themes/comunidad/${ORIGIN_FILE}`, '{', 0o644);
    const broken = harness({}, { datasetFileSystem: h.fs, artifactFileSystem: h.fs });
    expect(await runCli(['theme', 'verify', 'comunidad'], broken.context)).toBe(EXIT_DATA_ERROR);
    expect(broken.stdout()).toMatch(/^comunidad: modificado localmente: \.origin\.json no es JSON válido: /);
  });

  it('sin temas en el proyecto lo dice; un tema distribuido o inexistente se explica con su código', async () => {
    const empty = harness();
    expect(await runCli(['theme', 'verify'], empty.context)).toBe(EXIT_OK);
    expect(empty.stdout()).toBe('No hay temas en themes/ del proyecto\n');
    const builtin = harness();
    expect(await runCli(['theme', 'verify', 'classic'], builtin.context)).toBe(EXIT_DATA_ERROR);
    expect(builtin.stderr()).toBe('«classic» es un tema distribuido: no tiene origen que verificar (solo los de themes/ del proyecto)\n');
    const missing = harness();
    expect(await runCli(['theme', 'verify', 'nada'], missing.context)).toBe(EXIT_FAILURE);
    expect(missing.stderr()).toBe('No existe el tema «nada» en /work/themes\n');
  });
});
