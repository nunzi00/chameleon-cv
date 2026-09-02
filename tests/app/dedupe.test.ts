/**
 * Duplicados en las PROPIAS fuentes y su resolución (T-9.20): detectarlos con la misma regla que compara
 * borradores, y resolverlos quedándose con una entrada que absorbe de las otras SOLO lo que le falta. Los casos
 * salen del espacio de trabajo real: el empleo partido en cuatro periodos que NO debe agruparse, y las dos
 * formaciones en las que cada mitad tiene lo que a la otra le falta.
 */
import { describe, expect, it } from 'vitest';

import { absorbInto, isAbsent, resolveDuplicate, sourceDuplicates } from '../../src/app/dedupe';
import { readSourceHistory, restoreSourceVersion } from '../../src/app/source-history';
import type { Education, Experience } from '../../src/core/schema';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'links: []', '---', ''].join('\n');

function experience(company: string, role: string, start: string, end?: string, extra: readonly string[] = []): string {
  return ['---', `company: ${company}`, `role: ${role}`, `start: ${start}`, ...(end === undefined ? [] : [`end: ${end}`]), ...extra, '---', ''].join('\n');
}

function education(institution: string, degree: string, start?: string, end?: string): string {
  return ['---', `institution: ${institution}`, `degree: ${degree}`, ...(start === undefined ? [] : [`start: ${start}`]), ...(end === undefined ? [] : [`end: ${end}`]), '---', ''].join('\n');
}

/** Las dos formaciones duplicadas del espacio de trabajo real: cada una tiene lo que a la otra le falta. */
function workspace(extra: Record<string, string> = {}): MemoryFileSystem {
  return new MemoryFileSystem({
    '/work/data/sources/profile.md': PROFILE,
    '/work/data/sources/education/ciclo-superior-administrador-de-sistemas.md': education('Centro pendiente', 'Ciclo Superior Administrador de Sistemas', '2008', '2010'),
    '/work/data/sources/education/cs-administrador-ies-piringalla.md': education('I.E.S Piringalla', 'cs administrador de sistemas informaticos'),
    ...extra,
  });
}

describe('isAbsent: qué cuenta como hueco', () => {
  it('lo que el importador escribe cuando NO reconoció el dato es un hueco, no un valor', () => {
    expect(isAbsent('Centro pendiente')).toBe(true);
    expect(isAbsent('  empresa pendiente ')).toBe(true);
    expect(isAbsent(undefined)).toBe(true);
    expect(isAbsent('   ')).toBe(true);
    expect(isAbsent('I.E.S Piringalla')).toBe(false);
  });
});

describe('sourceDuplicates: lo que hay repetido en data/sources', () => {
  it('agrupa las dos mitades de la misma formación y dice en qué fichero vive cada una', async () => {
    const result = await sourceDuplicates(appContext(workspace()), { data: 'data/sources' });
    expect(result.ok && result.result.groups).toHaveLength(1);
    expect(result.ok && result.result.compared).toBe(2);
    const ids = result.ok ? result.result.groups[0]!.members.map((member) => member.entry.id) : [];
    expect(ids).toHaveLength(2);
    expect(result.ok && result.result.files[ids[0] as string]).toMatch(/^education\//);
  });

  it('NO agrupa un mismo empleo partido en periodos, que es una forma legítima de contarlo', async () => {
    // Cuatro entradas de Life5 por periodo, como en el espacio de trabajo real: comparten empresa, pero sus
    // fechas no se solapan. Agruparlas sería el peor falso positivo posible: son la carrera de la persona.
    const fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': PROFILE,
      '/work/data/sources/experience/life5-2022.md': experience('Life5', 'Backend Developer', '2022-05', '2022-12'),
      '/work/data/sources/experience/life5-2023.md': experience('Life5', 'Backend & Platform Engineer', '2023-01', '2024-12'),
      '/work/data/sources/experience/life5-2025.md': experience('Life5', 'Senior Backend Engineer', '2025-01', '2025-12'),
      '/work/data/sources/experience/life5-2026.md': experience('Life5', 'Arquitecto de software', '2026-01'),
    });
    const result = await sourceDuplicates(appContext(fs), { data: 'data/sources' });
    expect(result.ok && result.result.groups).toEqual([]);
    expect(result.ok && result.result.compared).toBe(4);
  });

  it('unas fuentes que no cargan se explican, no se agrupan a medias', async () => {
    const fs = new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nschemaVersion: 1\n---\n' });
    expect(await sourceDuplicates(appContext(fs), { data: 'data/sources' })).toMatchObject({ ok: false });
  });
});

describe('absorbInto: rellenar huecos sin pisar nada', () => {
  const used = (): Set<string> => new Set<string>();

  it('toma el dato que falta y deja intacto el que ya había', () => {
    const keep = { id: 'edu-a', institution: 'Centro pendiente', degree: 'Ciclo Superior Administrador de Sistemas', dates: { start: '2008', end: '2010' }, tags: [] } as unknown as Education;
    const other = { id: 'edu-b', institution: 'I.E.S Piringalla', degree: 'cs administrador de sistemas informaticos', tags: [] } as unknown as Education;
    const { entity, taken, conflicts } = absorbInto('education', keep, [{ entity: other, title: 'cs administrador · I.E.S Piringalla' }], used());
    expect((entity as Education).institution).toBe('I.E.S Piringalla');
    // El título ya lo tenía: no se pisa, y la discrepancia se dice en vez de perderse.
    expect((entity as Education).degree).toBe('Ciclo Superior Administrador de Sistemas');
    expect(taken.map((field) => field.field)).toEqual(['institution']);
    expect(conflicts.map((field) => field.field)).toEqual(['degree']);
    expect(conflicts[0]?.discarded).toBe('cs administrador de sistemas informaticos');
  });

  it('el periodo se toma entero solo si no había ninguno; si los dos lo traen, gana el elegido', () => {
    const sinFechas = { id: 'edu-a', institution: 'I.E.S', degree: 'Ciclo', tags: [] } as unknown as Education;
    const conFechas = { id: 'edu-b', institution: 'I.E.S', degree: 'Ciclo', dates: { start: '2008', end: '2010' }, tags: [] } as unknown as Education;
    const tomado = absorbInto('education', sinFechas, [{ entity: conFechas, title: 'otra' }], used());
    expect((tomado.entity as Education).dates).toEqual({ start: '2008', end: '2010' });
    expect(tomado.taken.map((field) => field.field)).toEqual(['dates']);

    const otro = { id: 'edu-c', institution: 'I.E.S', degree: 'Ciclo', dates: { start: '2009' }, tags: [] } as unknown as Education;
    const enConflicto = absorbInto('education', conFechas, [{ entity: otro, title: 'otra' }], used());
    expect((enConflicto.entity as Education).dates).toEqual({ start: '2008', end: '2010' });
    expect(enConflicto.conflicts[0]).toMatchObject({ field: 'dates', kept: '2008 → 2010', discarded: '2009 → en curso' });
  });

  it('las listas se añaden sin repetir, y los logros entran con un id libre', () => {
    const keep = {
      id: 'exp-a', company: 'Acme', role: 'Backend', dates: { start: '2020-01' }, technologies: ['PHP'], tags: ['backend'],
      achievements: [{ id: 'exp-a-1', text: 'Migré 14 servicios', tags: [] }],
    } as unknown as Experience;
    const other = {
      id: 'exp-b', company: 'Acme', role: 'Backend', dates: { start: '2020-01' }, technologies: ['php', 'Kubernetes'], tags: ['backend', 'k8s'],
      achievements: [{ id: 'exp-a-1', text: 'migré 14 servicios', tags: [] }, { id: 'exp-b-2', text: 'Reduje la latencia', tags: [] }],
    } as unknown as Experience;
    const ids = new Set(['exp-a-1', 'exp-b-2']);
    const { entity, added } = absorbInto('experience', keep, [{ entity: other, title: 'otra' }], ids);
    const merged = entity as Experience;
    // «php» ya estaba como «PHP» y el logro ya estaba con otra caja: ninguno se repite.
    expect(merged.technologies).toEqual(['PHP', 'Kubernetes']);
    expect(merged.tags).toEqual(['backend', 'k8s']);
    expect(merged.achievements.map((item) => item.text)).toEqual(['Migré 14 servicios', 'Reduje la latencia']);
    expect(merged.achievements[1]?.id).toBe('exp-b-2-2');
    expect(added).toEqual(['technologies: Kubernetes', 'tags: k8s', 'logro: Reduje la latencia']);
  });
});

describe('resolveDuplicate: escribir una y borrar la otra, deshacible', () => {
  const request = { data: 'data/sources', keep: 'edu-ciclo-superior-administrador-de-sistemas', absorb: ['edu-cs-administrador-ies-piringalla'] };

  it('deja la entrada elegida completa y borra la absorbida', async () => {
    const fs = workspace();
    const result = await resolveDuplicate(appContext(fs), request);
    expect(result.ok).toBe(true);
    const kept = fs.file('/work/data/sources/education/ciclo-superior-administrador-de-sistemas.md')?.content ?? '';
    expect(kept).toContain('institution: I.E.S Piringalla');
    expect(kept).toContain('degree: Ciclo Superior Administrador de Sistemas');
    expect(kept).toContain('start: "2008"');
    expect(fs.file('/work/data/sources/education/cs-administrador-ies-piringalla.md')).toBeUndefined();
    expect(result.ok && result.outcome.taken.map((field) => field.field)).toEqual(['institution']);
    expect(result.ok && result.outcome.absorbed.map((entry) => entry.path)).toEqual(['education/cs-administrador-ies-piringalla.md']);
  });

  it('lo borrado vuelve con «cv history restore», que es el deshacer de todo lo demás', async () => {
    const fs = workspace();
    const context = appContext(fs);
    const result = await resolveDuplicate(context, request);
    const historyId = result.ok ? result.outcome.historyId : undefined;
    expect(historyId).toBeDefined();
    const entries = await readSourceHistory(context);
    expect(entries[0]?.files.map((file) => file.path)).toEqual(['education/ciclo-superior-administrador-de-sistemas.md', 'education/cs-administrador-ies-piringalla.md']);
    const restored = await restoreSourceVersion(context, historyId as string, 'education/cs-administrador-ies-piringalla.md');
    expect(restored.ok).toBe(true);
    expect(fs.file('/work/data/sources/education/cs-administrador-ies-piringalla.md')?.content).toContain('I.E.S Piringalla');
  });

  it('--dry-run enseña lo que haría y no toca el disco', async () => {
    const fs = workspace();
    const before = fs.file('/work/data/sources/education/ciclo-superior-administrador-de-sistemas.md')?.content;
    const result = await resolveDuplicate(appContext(fs), { ...request, dryRun: true });
    expect(result.ok && result.outcome.dryRun).toBe(true);
    expect(result.ok && result.outcome.taken).toHaveLength(1);
    expect(result.ok && result.outcome.historyId).toBeUndefined();
    expect(fs.file('/work/data/sources/education/ciclo-superior-administrador-de-sistemas.md')?.content).toBe(before);
    expect(fs.file('/work/data/sources/education/cs-administrador-ies-piringalla.md')).toBeDefined();
    expect(await readSourceHistory(appContext(fs))).toEqual([]);
  });

  it('se niega con un id que no existe, con secciones distintas, consigo misma y sin nada que absorber', async () => {
    const fs = workspace({ '/work/data/sources/experience/acme.md': experience('Acme', 'Backend', '2020-01') });
    const context = appContext(fs);
    expect(await resolveDuplicate(context, { ...request, absorb: ['edu-inventada'] })).toMatchObject({ ok: false, error: { code: 'not-found' } });
    expect(await resolveDuplicate(context, { ...request, absorb: ['exp-acme'] })).toMatchObject({ ok: false, error: { message: expect.stringContaining('misma sección') as string } });
    expect(await resolveDuplicate(context, { ...request, absorb: [request.keep] })).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
    expect(await resolveDuplicate(context, { ...request, absorb: [] })).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
    // Ninguna de esas negativas escribe ni borra.
    expect(fs.file('/work/data/sources/education/cs-administrador-ies-piringalla.md')).toBeDefined();
  });

  it('absorbe varias entradas de una vez, en el orden en que se piden', async () => {
    const fs = workspace({
      '/work/data/sources/education/cs-administrador-otra.md': education('Centro pendiente', 'C. S. Administrador de Sistemas', '2008', '2010'),
    });
    const result = await resolveDuplicate(appContext(fs), { data: 'data/sources', keep: 'edu-ciclo-superior-administrador-de-sistemas', absorb: ['edu-cs-administrador-ies-piringalla', 'edu-cs-administrador-otra'] });
    expect(result.ok && result.outcome.absorbed).toHaveLength(2);
    expect(fs.file('/work/data/sources/education/cs-administrador-ies-piringalla.md')).toBeUndefined();
    expect(fs.file('/work/data/sources/education/cs-administrador-otra.md')).toBeUndefined();
    // La primera rellenó el centro; la segunda ya no tenía nada que aportar (su centro es la marca de un hueco).
    expect(fs.file('/work/data/sources/education/ciclo-superior-administrador-de-sistemas.md')?.content).toContain('institution: I.E.S Piringalla');
    expect(result.ok && result.outcome.taken.map((field) => field.field)).toEqual(['institution']);
  });
});
