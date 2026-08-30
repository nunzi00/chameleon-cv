import { describe, expect, it } from 'vitest';

import { EXIT_DATA_ERROR, EXIT_FAILURE, EXIT_OK, runCli, type CliContext } from '../../src/cli';
import { formatImportOutcome } from '../../src/cli/commands/portability';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

interface Harness {
  readonly context: CliContext;
  readonly fs: MemoryFileSystem;
  readonly stdout: () => string;
  readonly stderr: () => string;
}

const SOURCES: Record<string, string | MemoryEntry> = {
  '/work/data/sources/profile.md': '---\nfullName: Ada Ejemplo\nemail: ada@example.com\n---\n\nResumen.\n',
  '/work/data/sources/experience/zeta.md': '---\ncompany: Zeta\nrole: Dev\nstart: "2020"\n---\n',
  '/work/data/sources/skills.csv': 'name,category\nPHP,language\n',
};

const REORDERED = JSON.stringify({
  personal: { fullName: 'Ana' },
  experience: [
    { id: 'exp-zeta', company: 'Zeta', role: 'Dev', dates: { start: '2020' } },
    { id: 'exp-alfa', company: 'Alfa', role: 'Dev', dates: { start: '2018' } },
  ],
});

function harness(tree: Record<string, string | MemoryEntry> = SOURCES, stdin = '', now?: () => Date): Harness {
  const out: string[] = [];
  const err: string[] = [];
  const fs = new MemoryFileSystem(tree);
  const context: CliContext = {
    ...appContext(fs, now === undefined ? {} : { now }),
    stdout: (text) => {
      out.push(text);
    },
    stderr: (text) => {
      err.push(text);
    },
    stdin: () => Promise.resolve(stdin),
  };
  return { context, fs, stdout: () => out.join(''), stderr: () => err.join('') };
}

describe('cv export', () => {
  it('imprime el perfil canónico por stdout, o lo escribe con -o (0600) y lo resume', async () => {
    const h = harness();
    expect(await runCli(['export'], h.context)).toBe(EXIT_OK);
    const profile = JSON.parse(h.stdout()) as { personal: { fullName: string }; experience: { id: string }[] };
    expect(profile.personal.fullName).toBe('Ada Ejemplo');
    expect(profile.experience[0]?.id).toBe('exp-zeta');
    expect(h.stdout().endsWith('\n')).toBe(true);
    const toFile = harness();
    expect(await runCli(['export', '-o', 'output/perfil.json'], toFile.context)).toBe(EXIT_OK);
    expect(toFile.stdout()).toBe('Perfil exportado en /work/output/perfil.json (0 especialidades, 1 experiencia, 0 proyectos, 0 formaciones, 1 skill, 0 certificaciones, 0 logros transversales, 0 idiomas)\n');
    expect(toFile.fs.file('/work/output/perfil.json')).toMatchObject({ mode: 0o600, content: h.stdout() });
  });

  it('falla con las fuentes inválidas (1) o si no puede escribir (2)', async () => {
    const invalid = harness({ '/work/data/sources/profile.md': 'sin frontmatter\n' });
    expect(await runCli(['export'], invalid.context)).toBe(EXIT_DATA_ERROR);
    expect(invalid.stderr()).toMatch(/profile\.md:1: Falta el frontmatter/);
    expect(invalid.stdout()).toBe('');
    const failing = harness();
    failing.fs.failures.add('writeFile');
    expect(await runCli(['export', '-o', 'output/perfil.json'], failing.context)).toBe(EXIT_FAILURE);
    expect(failing.stderr()).toMatch(/^No se pudo escribir «\/work\/output\/perfil\.json»: /);
  });
});

describe('cv import', () => {
  it('importa desde un fichero a un directorio nuevo, avisa por stderr y recuerda cv build; --dry-run solo planifica', async () => {
    const h = harness({ ...SOURCES, '/work/perfil.json': REORDERED });
    expect(await runCli(['import', 'perfil.json', '--data', 'data/nuevo', '--dry-run'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(
      [
        'Plan de importación en /work/data/nuevo: 3 ficheros (0 especialidades, 2 experiencias, 0 proyectos, 0 formaciones, 0 skills, 0 certificaciones, 0 logros transversales, 0 idiomas)',
        '  profile.md (39 bytes)',
        '  experience/alfa.md (46 bytes)',
        '  experience/zeta.md (46 bytes)',
        'Auto-chequeo: las fuentes regeneradas reproducen el perfil importado.',
        'No se ha escrito nada (--dry-run).',
        '',
      ].join('\n'),
    );
    expect(h.stderr()).toBe('Aviso: El orden de experience pasa a ser el de sus ficheros: exp-alfa, exp-zeta\n');
    expect(h.fs.file('/work/data/nuevo/profile.md')).toBeUndefined();
    const written = harness({ ...SOURCES, '/work/perfil.json': REORDERED });
    expect(await runCli(['import', 'perfil.json', '--data', 'data/nuevo'], written.context)).toBe(EXIT_OK);
    expect(written.stdout()).toBe(
      'Perfil importado en /work/data/nuevo: 3 ficheros (0 especialidades, 2 experiencias, 0 proyectos, 0 formaciones, 0 skills, 0 certificaciones, 0 logros transversales, 0 idiomas)\nEjecuta «cv build» para regenerar el artefacto.\n',
    );
    expect(written.fs.file('/work/data/nuevo/experience/alfa.md')).toMatchObject({ mode: 0o600, content: '---\ncompany: Alfa\nrole: Dev\nstart: "2018"\n---\n' });
  });

  it('lee de la entrada estándar con «-»; sustituye con --replace y muestra la copia; señala un perfil sin entidades', async () => {
    const h = harness(SOURCES, '{"personal":{"fullName":"Solo"}}\n', () => new Date(2026, 7, 30, 9, 5, 7));
    expect(await runCli(['import', '-', '--data', 'data/sources', '--replace'], h.context)).toBe(EXIT_OK);
    expect(h.stdout()).toBe(
      [
        'Perfil importado en /work/data/sources: 1 fichero (0 especialidades, 0 experiencias, 0 proyectos, 0 formaciones, 0 skills, 0 certificaciones, 0 logros transversales, 0 idiomas)',
        'Copia de seguridad de las fuentes anteriores: /work/data/sources.20260830-090507.bak',
        'Solo profile.md: el perfil no traía entidades.',
        'Ejecuta «cv build» para regenerar el artefacto.',
        '',
      ].join('\n'),
    );
    expect(h.fs.file('/work/data/sources.20260830-090507.bak/skills.csv')?.content).toBe('name,category\nPHP,language\n');
    expect(h.fs.file('/work/data/sources/profile.md')?.content).toBe('---\nschemaVersion: 1\nfullName: Solo\n---\n');
    expect(h.fs.file('/work/data/sources/skills.csv')).toBeUndefined();
  });

  it('errores: destino ocupado (1), JSON inválido (1), perfil inválido (1), fichero inexistente (2) e ilegible (2)', async () => {
    const occupied = harness({ ...SOURCES, '/work/perfil.json': REORDERED });
    expect(await runCli(['import', 'perfil.json'], occupied.context)).toBe(EXIT_DATA_ERROR);
    expect(occupied.stderr()).toMatch(/^El directorio de fuentes «\/work\/data\/sources» no está vacío \(experience, profile\.md, skills\.csv\): use --replace/);
    const invalidJson = harness(SOURCES, '{');
    expect(await runCli(['import', '-', '--data', 'data/nuevo'], invalidJson.context)).toBe(EXIT_DATA_ERROR);
    expect(invalidJson.stderr()).toMatch(/^El perfil no es JSON válido: /);
    const invalidProfile = harness(SOURCES, '{"personal":{"fullName":""},"extra":1}');
    expect(await runCli(['import', '-', '--data', 'data/nuevo'], invalidProfile.context)).toBe(EXIT_DATA_ERROR);
    expect(invalidProfile.stderr()).toMatch(/^personal\.fullName: [\s\S]*\n\d+ problemas en el perfil importado\n$/);
    const missing = harness();
    expect(await runCli(['import', 'no-existe.json', '--data', 'data/nuevo'], missing.context)).toBe(EXIT_FAILURE);
    expect(missing.stderr()).toBe('No existe el fichero «/work/no-existe.json»\n');
    const unreadable = harness();
    expect(await runCli(['import', 'data/sources', '--data', 'data/nuevo'], unreadable.context)).toBe(EXIT_FAILURE);
    expect(unreadable.stderr()).toMatch(/^No se pudo leer «\/work\/data\/sources»: /);
  });

  it('formatImportOutcome enumera el plan y el resumen', () => {
    const plan = {
      files: [{ path: 'profile.md', content: 'x' }],
      counts: { specialties: 0, experience: 0, projects: 0, education: 0, achievements: 0, skills: 1, certifications: 0 },
      warnings: [],
      profile: { meta: { schemaVersion: 1 as const }, personal: { fullName: 'A', links: [] }, specialties: [], experience: [], projects: [], education: [], skills: [], achievements: [], certifications: [], languages: [] },
    };
    expect(formatImportOutcome({ plan, root: '/r', dryRun: false, written: ['profile.md'], backup: undefined })).toBe(
      'Perfil importado en /r: 1 fichero (0 especialidades, 0 experiencias, 0 proyectos, 0 formaciones, 0 skills, 0 certificaciones, 0 logros transversales, 0 idiomas)\nEjecuta «cv build» para regenerar el artefacto.\n',
    );
  });
});
