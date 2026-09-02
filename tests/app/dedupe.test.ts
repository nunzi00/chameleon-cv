/**
 * Duplicados en las PROPIAS fuentes y su resolución (T-9.20): detectarlos con la misma regla que compara
 * borradores, y resolverlos quedándose con una entrada que absorbe de las otras SOLO lo que le falta. Los casos
 * salen del espacio de trabajo real: el empleo partido en cuatro periodos que NO debe agruparse, y las dos
 * formaciones en las que cada mitad tiene lo que a la otra le falta.
 */
import { describe, expect, it } from 'vitest';

import { absorbInto, filesById, isAbsent, resolveDuplicate, sourceDuplicates } from '../../src/app/dedupe';
import { readSourceHistory, restoreSourceVersion } from '../../src/app/source-history';
import { parseMasterProfile, type Education, type Experience } from '../../src/core/schema';
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

describe('filesById: la ruta de cada entrada, comprobada en el origen', () => {
  it('sin procedencia, o con una ruta que se escapa, cae al nombre que deduce el id', () => {
    // De aquí sale lo que luego se escribe y se BORRA: una ruta que no sea relativa y contenida no se usa.
    const profile = parseMasterProfile({
      meta: { schemaVersion: 1, locale: 'es-ES' },
      personal: { fullName: 'Ada Ejemplo' },
      experience: [{ id: 'exp-acme', company: 'Acme', role: 'Backend', dates: { start: '2020-01' } }],
    });
    expect(filesById(profile, [])).toEqual({ 'exp-acme': 'experience/acme.md' });
    expect(filesById(profile, [{ path: ['experience', 0], file: '../fuera.md' }])).toEqual({ 'exp-acme': 'experience/acme.md' });
    expect(filesById(profile, [{ path: ['experience', 0], file: 'experience/otro-nombre.md' }])).toEqual({ 'exp-acme': 'experience/otro-nombre.md' });
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
    // El tipo lo dice: solo una resolución de verdad trae entrada de histórico.
    const historyId = result.ok && !result.outcome.dryRun ? result.outcome.historyId : undefined;
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
    expect(result.ok && result.outcome.dryRun && !('historyId' in result.outcome)).toBe(true);
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

describe('resolveDuplicate: se niega antes de tocar el disco', () => {
  it('unas fuentes que no cargan, un id que no existe y dos entradas del mismo fichero', async () => {
    const roto = new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nschemaVersion: 1\n---\n' });
    expect(await resolveDuplicate(appContext(roto), { data: 'data/sources', keep: 'a', absorb: ['b'] })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('no cargan') as string },
    });
    const fs = workspace();
    expect(await resolveDuplicate(appContext(fs), { data: 'data/sources', keep: 'edu-inventada', absorb: ['edu-cs-administrador-ies-piringalla'] })).toMatchObject({
      ok: false,
      error: { code: 'not-found', message: expect.stringContaining('no es una experiencia, formación ni proyecto') as string },
    });
    expect(fs.file('/work/data/sources/education/cs-administrador-ies-piringalla.md')).toBeDefined();
  });

  it('las listas ausentes no rompen la absorción: se tratan como vacías', async () => {
    // Una entrada sin `technologies`, `tags` ni `## Logros` es lo normal en un borrador recién importado.
    const fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': PROFILE,
      '/work/data/sources/experience/a.md': experience('Acme', 'Backend', '2020-01', '2021-01'),
      '/work/data/sources/experience/b.md': experience('Acme', 'Backend', '2020-01', '2021-01', ['location: Madrid']),
    });
    const result = await resolveDuplicate(appContext(fs), { data: 'data/sources', keep: 'exp-a', absorb: ['exp-b'] });
    expect(result.ok && result.outcome.added).toEqual([]);
    expect(result.ok && result.outcome.taken.map((field) => field.field)).toEqual(['location']);
  });

  it('dos periodos distintos se dicen los dos: gana el de la elegida y el otro se descarta a la vista', async () => {
    const fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': PROFILE,
      '/work/data/sources/experience/a.md': experience('Acme', 'Backend', '2020-01', '2021-01'),
      '/work/data/sources/experience/b.md': experience('Acme', 'Backend', '2020-03'),
    });
    const result = await resolveDuplicate(appContext(fs), { data: 'data/sources', keep: 'exp-a', absorb: ['exp-b'], dryRun: true });
    expect(result.ok && result.outcome.conflicts[0]).toMatchObject({ field: 'dates', kept: '2020-01 → 2021-01', discarded: '2020-03 → en curso' });
  });
});

describe('resolveDuplicate: lo que no se toca', () => {
  it('un periodo abierto se dice «en curso» también cuando es el que se conserva', async () => {
    const fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': PROFILE,
      '/work/data/sources/experience/a.md': experience('Acme', 'Backend', '2020-01'),
      '/work/data/sources/experience/b.md': experience('Acme', 'Backend', '2020-03', '2021-01'),
      // Una tercera entrada de la misma sección: ni se absorbe ni se toca.
      '/work/data/sources/experience/otra.md': experience('Beta', 'Frontend', '2015-01', '2016-01'),
    });
    const antes = fs.file('/work/data/sources/experience/otra.md')?.content;
    const result = await resolveDuplicate(appContext(fs), { data: 'data/sources', keep: 'exp-a', absorb: ['exp-b'] });
    expect(result.ok && result.outcome.conflicts[0]).toMatchObject({ field: 'dates', kept: '2020-01 → en curso', discarded: '2020-03 → 2021-01' });
    expect(fs.file('/work/data/sources/experience/otra.md')?.content).toBe(antes);
  });
});

describe('resolveDuplicate: los bordes que protegen el disco', () => {
  it('no escribe si el perfil resultante no valida, aunque las dos partes lo fueran', async () => {
    // Absorber puede completar una entrada, pero nunca puede dejar unas fuentes que `cv build` rechace: dos
    // entradas con 60 tecnologías cada una son válidas por separado y su unión pasa del máximo del esquema.
    const muchas = (from: number): string => `technologies: [${Array.from({ length: 60 }, (_, i) => `t${from + i}`).join(', ')}]`;
    const fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': PROFILE,
      '/work/data/sources/experience/a.md': experience('Acme', 'Backend', '2020-01', '2021-01', [muchas(0)]),
      '/work/data/sources/experience/b.md': experience('Acme', 'Backend', '2020-01', '2021-01', [muchas(100)]),
    });
    const result = await resolveDuplicate(appContext(fs), { data: 'data/sources', keep: 'exp-a', absorb: ['exp-b'] });
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('no valida') as string } });
    expect(fs.file('/work/data/sources/experience/b.md')).toBeDefined();
  });

  it('un fallo al leer la fuente antes de guardarla en el histórico no borra nada', async () => {
    const fs = workspace();
    fs.failures.add('readFile');
    const result = await resolveDuplicate(appContext(fs), { data: 'data/sources', keep: 'edu-ciclo-superior-administrador-de-sistemas', absorb: ['edu-cs-administrador-ies-piringalla'] });
    expect(result).toMatchObject({ ok: false, error: { code: 'environment' } });
    expect(fs.file('/work/data/sources/education/cs-administrador-ies-piringalla.md')).toBeDefined();
  });

  it('si el histórico no se puede escribir, tampoco se resuelve: sin deshacer no se hace', async () => {
    const fs = workspace();
    fs.failures.add('mkdir');
    const result = await resolveDuplicate(appContext(fs), { data: 'data/sources', keep: 'edu-ciclo-superior-administrador-de-sistemas', absorb: ['edu-cs-administrador-ies-piringalla'] });
    expect(result.ok).toBe(false);
    expect(fs.file('/work/data/sources/education/cs-administrador-ies-piringalla.md')).toBeDefined();
  });

  it('si la escritura se corta a medias, se dice con qué entrada del histórico se deshace', async () => {
    const fs = workspace();
    const context = appContext(fs);
    // El histórico ya está escrito y la entrada que se queda también; lo que falla es borrar la absorbida.
    fs.failures.add('remove');
    const result = await resolveDuplicate(context, { data: 'data/sources', keep: 'edu-ciclo-superior-administrador-de-sistemas', absorb: ['edu-cs-administrador-ies-piringalla'] });
    expect(result).toMatchObject({ ok: false, error: { message: expect.stringContaining('Resolución interrumpida') as string } });
    expect(result.ok === false && result.error.lines?.some((line) => line.includes('cv history restore'))).toBe(true);
  });

  it('resuelve también experiencias y proyectos, no solo formación', async () => {
    const fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': PROFILE,
      '/work/data/sources/experience/a.md': experience('Acme', 'Backend', '2020-01', '2021-01'),
      '/work/data/sources/experience/b.md': experience('Acme', 'Backend', '2020-01', '2021-01', ['location: Madrid']),
      '/work/data/sources/projects/uno.md': ['---', 'name: Chameleon', 'start: 2026-01', '---', ''].join('\n'),
      '/work/data/sources/projects/dos.md': ['---', 'name: Chameleon', 'start: 2026-01', 'url: https://example.org/cv', '---', ''].join('\n'),
    });
    const context = appContext(fs);
    expect(await resolveDuplicate(context, { data: 'data/sources', keep: 'exp-a', absorb: ['exp-b'] })).toMatchObject({ ok: true });
    expect(fs.file('/work/data/sources/experience/a.md')?.content).toContain('location: Madrid');
    expect(await resolveDuplicate(context, { data: 'data/sources', keep: 'proj-uno', absorb: ['proj-dos'] })).toMatchObject({ ok: true });
    expect(fs.file('/work/data/sources/projects/uno.md')?.content).toContain('url: https://example.org/cv');
  });

  it('un periodo en curso se enseña como tal al tomarlo y al descartarlo', async () => {
    const fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': PROFILE,
      '/work/data/sources/education/sin.md': education('I.E.S', 'Ciclo Superior de Sistemas'),
      '/work/data/sources/education/con.md': education('I.E.S', 'Ciclo Superior de Sistemas', '2008'),
    });
    const tomado = await resolveDuplicate(appContext(fs), { data: 'data/sources', keep: 'edu-sin', absorb: ['edu-con'], dryRun: true });
    expect(tomado.ok && tomado.outcome.taken[0]).toMatchObject({ field: 'dates', value: '2008 → en curso' });
    const otro = await resolveDuplicate(appContext(fs), { data: 'data/sources', keep: 'edu-con', absorb: ['edu-sin'], dryRun: true });
    // Al revés no hay nada que tomar: la que se queda ya tiene periodo y la otra no trae ninguno.
    expect(otro.ok && otro.outcome.taken).toEqual([]);
  });

  it('los logros que ya existen en el perfil no chocan de id al absorberse', async () => {
    const fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': PROFILE,
      '/work/data/sources/achievements.md': '- Un logro transversal del perfil.\n',
      '/work/data/sources/experience/a.md': experience('Acme', 'Backend', '2020-01', '2021-01'),
      '/work/data/sources/experience/b.md': ['---', 'company: Acme', 'role: Backend', 'start: 2020-01', 'end: 2021-01', '---', '', '## Logros', '', '- Migré 14 servicios.', ''].join('\n'),
    });
    const result = await resolveDuplicate(appContext(fs), { data: 'data/sources', keep: 'exp-a', absorb: ['exp-b'] });
    expect(result.ok && result.outcome.added.some((line) => line.startsWith('logro:'))).toBe(true);
    expect(fs.file('/work/data/sources/experience/a.md')?.content).toContain('Migré 14 servicios.');
  });
});

