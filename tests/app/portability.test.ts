import { describe, expect, it } from 'vitest';

import type { MasterProfile } from '../../src/core/schema';
import {
  backupDirectory,
  canonicalOrder,
  diffPaths,
  exportProfile,
  importProfile,
  parseProfileJson,
  planFiles,
  planImport,
} from '../../src/app/portability';
import type { SourceParser } from '../../src/parsers';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem, datasetTree } from '../helpers/memory-file-system';

const PROFILE: MasterProfile = {
  meta: { schemaVersion: 1, locale: 'es-ES' },
  personal: { fullName: 'Ada Ejemplo', headline: 'Ingeniera', summary: 'Resumen.', email: 'ada@example.com', links: [] },
  specialties: [{ id: 'backend', title: 'Backend', tags: ['php'] }],
  experience: [
    { id: 'exp-zeta', company: 'Zeta', role: 'Dev', dates: { start: '2019' }, technologies: [], achievements: [], tags: [] },
    {
      id: 'exp-acme',
      company: 'ACME',
      role: 'Senior',
      dates: { start: '2021-03', end: '2024-06' },
      summary: 'Pagos.',
      technologies: ['PHP'],
      achievements: [{ id: 'exp-acme-1', text: 'Reduje la latencia', impact: '-40 %', tags: ['perf'] }],
      tags: ['php'],
    },
  ],
  projects: [{ id: 'proj-cv', name: 'CV', technologies: [], achievements: [], tags: [] }],
  education: [{ id: 'edu-uni', institution: 'U', degree: 'Grado', tags: [] }],
  skills: [{ id: 'skill-1', name: 'PHP', category: 'language', aliases: [], tags: [] }],
  achievements: [{ id: 'ach-1', text: 'Charla', tags: ['talks'] }],
  certifications: [{ id: 'cert-1', name: 'AWS', tags: [] }],
  languages: [{ name: 'Español', level: 'native' }],
};

const NOW = () => new Date(2026, 7, 30, 12, 0, 0);

describe('exportProfile y parseProfileJson', () => {
  it('exporta el perfil desde las fuentes con la serialización del artefacto', async () => {
    const fs = new MemoryFileSystem(datasetTree());
    const result = await exportProfile(appContext(fs), { data: '/data' });
    expect(result.ok && result.json).toBe(`${JSON.stringify(result.ok && result.profile, null, 2)}\n`);
    expect(result.ok && result.profile.personal.fullName).toBe('Ada Ejemplo');
    expect(result.ok && result.root).toBe('/data');
    const missing = await exportProfile(appContext(fs), { data: '/nope' });
    expect(!missing.ok && missing.error.code).toBe('invalid-data');
  });

  it('lee JSON con o sin BOM y explica el inválido', () => {
    expect(parseProfileJson('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseProfileJson('﻿{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    const invalid = parseProfileJson('{');
    expect(!invalid.ok && invalid.error.message).toMatch(/^El perfil no es JSON válido: /);
  });
});

describe('canonicalOrder y diffPaths', () => {
  it('ordena las entidades por nombre de fichero y dice qué secciones cambian', () => {
    const { profile, reordered } = canonicalOrder(PROFILE);
    expect(profile.experience.map((item) => item.id)).toEqual(['exp-acme', 'exp-zeta']);
    expect(reordered).toEqual(['experience']);
    expect(canonicalOrder(profile).reordered).toEqual([]);
    const mixed = canonicalOrder({ ...PROFILE, experience: [{ ...PROFILE.experience[0]!, id: 'beta' }, PROFILE.experience[1]!] });
    expect(mixed.profile.experience.map((item) => item.id)).toEqual(['exp-acme', 'beta']);
    const colliding = canonicalOrder({ ...PROFILE, experience: [{ ...PROFILE.experience[0]!, id: 'acme' }, PROFILE.experience[1]!] });
    expect(colliding.profile.experience.map((item) => item.id)).toEqual(['exp-acme', 'acme']);
    expect(colliding.naming.experience.get('exp-acme')).toEqual({ fileName: 'acme-2', explicitId: true });
  });

  it('enumera las rutas que difieren, sin depender del orden de claves, y respeta el límite', () => {
    expect(diffPaths({ a: 1, b: [1, 2] }, { b: [1, 2], a: 1 })).toEqual([]);
    expect(diffPaths({ a: [1, 2] }, { a: [1] })).toEqual(['a: 2 elementos frente a 1']);
    expect(diffPaths({ a: [{ x: 1 }] }, { a: [{ x: 2 }] })).toEqual(['a[0].x: 1 frente a 2']);
    expect(diffPaths({ a: 1 }, { b: 1 })).toEqual(['a: 1 frente a undefined', 'b: undefined frente a 1']);
    expect(diffPaths('x', 'y')).toEqual(['<raíz>: "x" frente a "y"']);
    expect(diffPaths([1], [2, 3])).toEqual(['<raíz>: 1 elementos frente a 2']);
    expect(diffPaths({ a: 1, b: 2, c: 3 }, { a: 9, b: 9, c: 9 }, '', 2)).toEqual(['a: 1 frente a 9', 'b: 2 frente a 9']);
    expect(diffPaths([1, 2, 3], [9, 9, 9], '', 1)).toEqual(['[0]: 1 frente a 9']);
  });
});

describe('planImport', () => {
  const context = appContext(new MemoryFileSystem());

  it('genera los ficheros canónicos, omite las secciones vacías y avisa del reorden y del contacto', async () => {
    const result = await planImport(context, PROFILE);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.files.map((file) => file.path)).toEqual([
      'profile.md',
      'specialties/backend.md',
      'experience/acme.md',
      'experience/zeta.md',
      'projects/cv.md',
      'education/uni.md',
      'achievements.md',
      'skills.csv',
      'certifications.csv',
    ]);
    expect(result.plan.counts).toEqual({ specialties: 1, experience: 2, projects: 1, education: 1, achievements: 1, skills: 1, certifications: 1 });
    expect(result.plan.warnings).toEqual([
      'El orden de experience pasa a ser el de sus ficheros: exp-acme, exp-zeta',
      'profile.md contendrá datos de contacto (email, teléfono); las fuentes se escriben con permisos 0600',
    ]);
    expect(result.plan.profile.experience[0]?.id).toBe('exp-acme');
    const bare = await planImport(context, { personal: { fullName: 'Solo' } });
    expect(bare.ok && bare.plan.files.map((file) => file.path)).toEqual(['profile.md']);
    expect(bare.ok && bare.plan.warnings).toEqual([]);
    expect(planFiles(PROFILE).length).toBe(9);
    const colliding = await planImport(context, { ...PROFILE, experience: [PROFILE.experience[1]!, { ...PROFILE.experience[0]!, id: 'acme' }] });
    expect(colliding.ok && colliding.plan.files.map((file) => file.path).slice(2, 4)).toEqual(['experience/acme-2.md', 'experience/acme.md']);
    expect(colliding.ok && colliding.plan.files[2]?.content.startsWith('---\nid: acme\n')).toBe(true);
    expect(colliding.ok && colliding.plan.profile.experience.map((item) => item.id)).toEqual(['acme', 'exp-acme']);
    expect(colliding.ok && colliding.plan.warnings[0]).toBe('El orden de experience pasa a ser el de sus ficheros: acme, exp-acme');
  });

  it('rechaza el perfil inválido con las rutas, la versión de esquema y los logros no representables', async () => {
    const invalid = await planImport(context, { meta: { schemaVersion: 2 }, personal: { fullName: '' }, experience: [{ id: 'X' }] });
    expect(!invalid.ok && invalid.error.code).toBe('invalid-data');
    expect(!invalid.ok && invalid.error.message).toMatch(/^El perfil no es válido \(\d+ problemas\)$/);
    expect(!invalid.ok && invalid.error.lines?.join('\n')).toMatch(/meta\.schemaVersion: .*entiende la 1/);
    expect(!invalid.ok && invalid.error.lines?.join('\n')).toMatch(/experience\[0\]\.id: Identificador inválido/);
    const unrepresentable = await planImport(context, {
      ...PROFILE,
      achievements: [{ id: 'a', text: 'Hice #cosas' }],
      projects: [{ ...PROFILE.projects[0]!, achievements: [{ id: 'b', text: 'Dos\nlíneas' }] }],
    });
    expect(!unrepresentable.ok && unrepresentable.error.lines).toEqual([
      'projects[0].achievements[0].text («b»): el texto tiene saltos de línea y el parser los une con un espacio',
      'achievements[0].text («a»): el texto termina en «#cosas», que el parser leería como etiqueta',
    ]);
  });

  it('el auto-chequeo detiene el plan cuando las fuentes regeneradas no se leen o no coinciden', async () => {
    const unreadable = await planImport(context, { ...PROFILE, personal: { ...PROFILE.personal, summary: 'Resumen\n\n## Sección\n\nque rompe' } });
    expect(!unreadable.ok && unreadable.error.message).toBe('Las fuentes regeneradas no se pueden volver a leer; no se escribe nada');
    expect(!unreadable.ok && unreadable.error.lines?.[0]).toMatch(/^profile\.md:\d+: Sección «## Sección» no admitida/);
    const liar: SourceParser = {
      name: 'mentiroso',
      extensions: ['.md', '.csv'],
      parse: ({ path }) => ({
        ok: true,
        contribution: path === 'profile.md' ? { personal: { fullName: 'Otra Persona' } } : {},
        provenance: [],
      }),
    };
    const mismatch = await planImport({ parsers: [liar] }, PROFILE);
    expect(!mismatch.ok && mismatch.error.message).toBe('El perfil regenerado no coincide con el importado; no se escribe nada');
    expect(!mismatch.ok && mismatch.error.lines).toContain('personal.fullName: "Ada Ejemplo" frente a "Otra Persona"');
  });
});

describe('importProfile', () => {
  it('dryRun planifica sin escribir; sin destino escribe todo con 0600 y devuelve lo escrito', async () => {
    const fs = new MemoryFileSystem();
    const context = appContext(fs);
    const dry = await importProfile(context, PROFILE, { data: 'data/sources', dryRun: true });
    expect(dry.ok && dry.outcome).toMatchObject({ dryRun: true, written: [], backup: undefined, root: '/work/data/sources' });
    expect(fs.log.filter((entry) => entry.startsWith('writeFile'))).toEqual([]);
    const result = await importProfile(context, PROFILE, { data: 'data/sources' });
    expect(result.ok && result.outcome.written).toEqual(['profile.md', 'specialties/backend.md', 'experience/acme.md', 'experience/zeta.md', 'projects/cv.md', 'education/uni.md', 'achievements.md', 'skills.csv', 'certifications.csv']);
    expect(result.ok && result.outcome.backup).toBeUndefined();
    expect(fs.file('/work/data/sources/experience/acme.md')?.mode).toBe(0o600);
    expect(fs.file('/work/data/sources/profile.md')?.content).toContain('fullName: Ada Ejemplo');
    const again = await exportProfile(context, { data: 'data/sources' });
    expect(again.ok && again.profile).toEqual(canonicalOrder(PROFILE).profile);
  });

  it('escribe en un directorio vacío o con solo ficheros ocultos; con contenido exige replace', async () => {
    const fs = new MemoryFileSystem({ '/work/data/sources/.gitkeep': '' });
    const context = appContext(fs);
    const hidden = await importProfile(context, PROFILE, { data: 'data/sources' });
    expect(hidden.ok).toBe(true);
    const occupied = await importProfile(context, PROFILE, { data: 'data/sources' });
    expect(!occupied.ok && occupied.error.code).toBe('conflict');
    expect(!occupied.ok && occupied.error.message).toBe(
      'El directorio de fuentes «/work/data/sources» no está vacío (achievements.md, certifications.csv, education, experience, profile.md, …): use --replace para sustituirlo con copia de seguridad, o --data con otro directorio',
    );
    const dryOccupied = await importProfile(context, PROFILE, { data: 'data/sources', dryRun: true });
    expect(!dryOccupied.ok && dryOccupied.error.code).toBe('conflict');
    const small = await importProfile(appContext(new MemoryFileSystem({ '/work/data/sources/profile.md': 'x' })), PROFILE, { data: 'data/sources' });
    expect(!small.ok && small.error.message).toMatch(/no está vacío \(profile\.md\): use --replace/);
    const invalid = await importProfile(context, { nope: true }, { data: 'data/sources' });
    expect(!invalid.ok && invalid.error.code).toBe('invalid-data');
  });

  it('replace aparta el directorio entero con marca de tiempo, sin pisar copias anteriores', async () => {
    const fs = new MemoryFileSystem({ '/work/data/sources/profile.md': 'viejo', '/work/data/sources/experience/old.md': 'viejo', '/work/data/sources.20260830-120000.bak/profile.md': 'copia previa' });
    const context = appContext(fs, { now: NOW });
    expect(await backupDirectory(context, '/work/data/sources')).toBe('/work/data/sources.20260830-120000.bak.1');
    const result = await importProfile(context, PROFILE, { data: 'data/sources', replace: true });
    expect(result.ok && result.outcome.backup).toBe('/work/data/sources.20260830-120000.bak.1');
    expect(fs.file('/work/data/sources.20260830-120000.bak.1/experience/old.md')?.content).toBe('viejo');
    expect(fs.file('/work/data/sources.20260830-120000.bak/profile.md')?.content).toBe('copia previa');
    expect(fs.file('/work/data/sources/experience/old.md')).toBeUndefined();
    expect(fs.file('/work/data/sources/profile.md')?.content).toContain('Ada Ejemplo');
    const dry = await importProfile(context, PROFILE, { data: 'data/sources', replace: true, dryRun: true });
    expect(dry.ok && dry.outcome.backup).toBeUndefined();
    expect(fs.file('/work/data/sources/profile.md')?.content).toContain('Ada Ejemplo');
  });

  it('rechaza enlaces simbólicos y rutas que no son directorios', async () => {
    const fs = new MemoryFileSystem({ '/work/real/profile.md': 'x', '/work/data/sources': { kind: 'symlink', target: '/work/real' }, '/work/file.txt': 'x' });
    const context = appContext(fs);
    const symlink = await importProfile(context, PROFILE, { data: 'data/sources' });
    expect(!symlink.ok && symlink.error.code).toBe('unsafe-path');
    const file = await importProfile(context, PROFILE, { data: 'file.txt' });
    expect(!file.ok && file.error.message).toBe('La ruta de fuentes «/work/file.txt» no es un directorio');
  });

  it('informa de lo escrito si una escritura falla y de la copia si no se pudo apartar', async () => {
    const fs = new MemoryFileSystem({ '/work/data/sources/profile.md': 'viejo' });
    const context = appContext(fs, { now: NOW });
    fs.failures.add('rename');
    const notMoved = await importProfile(context, PROFILE, { data: 'data/sources', replace: true });
    expect(!notMoved.ok && notMoved.error.message).toMatch(/^No se pudo apartar «\/work\/data\/sources» como «\/work\/data\/sources\.20260830-120000\.bak»: /);
    fs.failures.delete('rename');
    const writing = new MemoryFileSystem();
    const writingContext = appContext(writing, { now: NOW });
    let writes = 0;
    const original = writing.writeFile.bind(writing);
    writing.writeFile = async (path, content, mode) => {
      writes += 1;
      if (writes > 2) {
        throw new Error('disco lleno');
      }
      await original(path, content, mode);
    };
    const failed = await importProfile(writingContext, PROFILE, { data: 'data/sources' });
    expect(!failed.ok && failed.error.message).toMatch(/^Importación interrumpida en «experience\/acme\.md»: /);
    expect(!failed.ok && failed.error.lines).toEqual(['escrito: /work/data/sources/profile.md', 'escrito: /work/data/sources/specialties/backend.md']);
    const replaced = new MemoryFileSystem({ '/work/data/sources/profile.md': 'viejo' });
    replaced.failures.add('writeFile');
    const afterBackup = await importProfile(appContext(replaced, { now: NOW }), PROFILE, { data: 'data/sources', replace: true });
    expect(!afterBackup.ok && afterBackup.error.lines).toEqual(['las fuentes anteriores siguen en /work/data/sources.20260830-120000.bak']);
    expect(await backupDirectory(appContext(new MemoryFileSystem()), '/work/x')).toMatch(/^\/work\/x\.\d{8}-\d{6}\.bak$/);
  });
});
