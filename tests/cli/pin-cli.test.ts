import { describe, expect, it } from 'vitest';

import { EXIT_DATA_ERROR, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { defaultSourceParsers } from '../../src/parsers';
import { extractPdfText } from '../../src/pdf';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

const DATASET: Record<string, string | MemoryEntry> = {
  '/work/data/sources/profile.md': '---\nfullName: Ada\n---\n',
  '/work/data/sources/specialties/backend.md': '---\ntitle: Backend\ntags: [php]\n---\n',
  '/work/data/sources/experience/acme.md':
    '---\ncompany: ACME\nrole: Dev\nstart: 2020\ntags: [php]\n---\n\n## Logros\n\n- Logro PHP. #php\n- Logro anclado. #comunidad #pin\n- Otro logro PHP. #php\n',
  '/work/data/sources/skills.csv': 'name,tags\nPHP,php\nExcel,pin\nGo,go\n',
  '/work/offers/php.txt': 'Buscamos PHP.\n\nRequisitos:\n- PHP\n',
};

function harness(tree: Record<string, string | MemoryEntry> = DATASET): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem(tree);
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
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('#pin de extremo a extremo (T-2.9)', () => {
  it('un logro y una skill anclados sobreviven a --top-n 1 y --max-skills 1, con y sin oferta, y --explain lo cuenta', async () => {
    const h = harness();
    expect(await runCli(['build'], h.context)).toBe(EXIT_OK);

    expect(await runCli(['generate-cv', '-s', 'backend', '--top-n', '1', '--max-skills', '1', '--stdout', '--explain'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toContain('- Logro anclado.\n');
    expect(h.stdout()).not.toContain('Logro PHP.');
    expect(h.stdout()).toContain('Excel');
    expect(h.stdout()).not.toContain('PHP,');
    expect(h.stderr()).toContain('    + exp-acme-2: pinned\n');
    expect(h.stderr()).toContain('+ skills skill-2: pinned\n');
    expect(h.stderr()).toMatch(/Recortes \(--top-n 1, --max-skills 1\): 3 ítems fuera\n  exp-acme: exp-acme-1 \(0\.00\), exp-acme-3 \(0\.00\)\n  skills: skill-1 PHP \(0\.00\)\n/);

    const offer = harness();
    expect(await runCli(['build'], offer.context)).toBe(EXIT_OK);
    expect(await runCli(['generate-cv', '-f', 'offers/php.txt', '-n', '1', '--stdout'], offer.context)).toBe(EXIT_OK);
    expect(offer.stdout()).toContain('- Logro anclado.\n');
    expect(offer.stdout()).not.toContain('Logro PHP.');
    expect(offer.stdout()).toMatch(/Excel, PHP|Excel.*\n.*PHP/);
  });

  it('una especialidad no puede usar pin: cv build lo rechaza con fichero y ruta', async () => {
    const h = harness({ ...DATASET, '/work/data/sources/specialties/mala.md': '---\ntitle: Mala\ntags: [pin]\n---\n' });
    expect(await runCli(['build'], h.context)).toBe(EXIT_DATA_ERROR);
    expect(h.stderr()).toContain('"pin" está reservado: es la tag de anclaje (#pin) y no forma parte del vocabulario de una especialidad');
  });
});
