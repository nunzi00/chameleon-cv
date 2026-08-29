/**
 * La CLI con un AssetStore en memoria (T-6.2): lo que en el ejecutable autónomo sale del binario
 * —package.json, plantilla Markdown, prompts, dataset de ejemplo, temas— llega por la capa de assets,
 * sin ninguna ruta fija al repositorio.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { serializeProfile } from '../../src/artifact';
import { EXIT_OK, builtinThemesRoot, projectThemeRoots, runCli, type CliContext } from '../../src/cli';
import { MemoryLlmCache } from '../../src/llm';
import { NodeFileSystem, defaultSourceParsers, loadDataset, type FileSystem } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { MemoryAssets } from '../../src/shared/assets';
import { installTypst, typstStatus } from '../../src/typst';
import { themeToml } from '../fixtures/theme';
import { MemoryFileSystem } from '../helpers/memory-file-system';

let materializeRoot = '';
let artifact = '';

beforeAll(async () => {
  materializeRoot = await mkdtemp(join(tmpdir(), 'chameleon-assets-cli-'));
  const dataset = await loadDataset(join(__dirname, '../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) throw new Error('dataset');
  artifact = serializeProfile(dataset.profile);
});
afterAll(async () => {
  await rm(materializeRoot, { recursive: true, force: true });
});

function memoryAssets(): MemoryAssets {
  return new MemoryAssets(
    {
      'package.json': '{"name":"chameleon-cv","version":"7.7.7"}',
      'templates/cv.md.hbs': '# {{fullName}} (plantilla en memoria)\n',
      'prompts/improve.v1.md': 'Prompt en memoria.\n',
      'templates/dataset/profile.md': '---\nfullName: Memo Ejemplo\n---\n',
      'templates/dataset/README.md': 'dataset en memoria\n',
      'themes/mini/theme.toml': themeToml('mini'),
      'themes/mini/template.typ': '#let cv(d, theme) = d.fullName',
    },
    materializeRoot,
  );
}

function harness(): { context: CliContext; fs: MemoryFileSystem; stdout: () => string; stderr: () => string } {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem({ '/work/data/dist/profile.json': { kind: 'file', content: artifact, mode: 0o600, mtimeMs: 500 } });
  // Lo materializado vive en el disco real; el proyecto de la usuaria, en memoria (en producción ambos son el disco).
  const disk = new NodeFileSystem();
  const pick = (path: string): FileSystem => (path.startsWith(materializeRoot) ? disk : fs);
  const reads: FileSystem = {
    readDirectory: (path) => pick(path).readDirectory(path),
    stat: (path) => pick(path).stat(path),
    realPath: (path) => pick(path).realPath(path),
    readTextFile: (path) => pick(path).readTextFile(path),
    readBinaryFile: (path) => pick(path).readBinaryFile(path),
  };
  const context: CliContext = {
    cwd: '/work',
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => Promise.resolve(''),
    datasetFileSystem: reads,
    artifactFileSystem: fs,
    parsers: defaultSourceParsers(),
    pdfExtractor: (bytes) => extractPdfText(bytes),
    typstRenderer: (profile, options) => renderTypstCv(profile, options),
    typstInstall: (options, report) => installTypst(options, report),
    typstStatus: (options) => typstStatus(options),
    llmStatus: () => Promise.reject(new Error('no usado')),
    llmProvider: () => Promise.resolve({ ok: false as const, message: 'sin proveedor' }),
    llmCache: new MemoryLlmCache(),
    assets: memoryAssets(),
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('la CLI lee sus assets por la capa (T-6.2)', () => {
  it('versión, plantilla Markdown y prompt salen del AssetStore, no del repositorio', async () => {
    const version = harness();
    expect(await runCli(['--version'], version.context)).toBe(EXIT_OK);
    expect(version.stdout()).toBe('7.7.7\n');
    const markdown = harness();
    expect(await runCli(['generate-cv', '-s', 'backend', '--stdout'], markdown.context)).toBe(EXIT_OK);
    expect(markdown.stdout()).toBe('# Ada Ejemplo (plantilla en memoria)\n');
    const prompt = harness();
    expect(await runCli(['improve', '--show-prompt'], prompt.context)).toBe(EXIT_OK);
    expect(prompt.stdout()).toBe('Prompt en memoria.\n');
  });

  it('cv init copia el dataset de ejemplo materializado por la capa y los temas distribuidos salen de su directorio real', async () => {
    const init = harness();
    expect(await runCli(['init'], init.context)).toBe(EXIT_OK);
    expect(init.fs.file('/work/data/sources/profile.md')?.content).toBe('---\nfullName: Memo Ejemplo\n---\n');
    expect(init.fs.file('/work/data/sources/README.md')?.content).toBe('dataset en memoria\n');
    const themes = harness();
    expect(await runCli(['theme', 'list'], themes.context)).toBe(EXIT_OK);
    expect(themes.stdout()).toBe('mini  distribuido   sin descripción\n');
    expect(themes.stderr()).toContain(`1 tema en /work/themes y ${join(materializeRoot, 'themes')};`);
    const path = harness();
    expect(await runCli(['theme', 'path', 'mini'], path.context)).toBe(EXIT_OK);
    expect(path.stdout()).toBe(`${join(materializeRoot, 'themes', 'mini')}\n`);
    expect((await builtinThemesRoot(path.context)).directory).toBe(join(materializeRoot, 'themes'));
    expect((await projectThemeRoots(path.context)).map((root) => root.directory)).toEqual(['/work/themes', join(materializeRoot, 'themes')]);
  });
});
