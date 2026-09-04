/**
 * El plan de LinkedIn (T-9.27): un diff entre tu perfil y lo que LinkedIn exportó, con la misma regla de
 * identidad que el detector de duplicados. Tres acciones: lo que hay que añadir allí, lo que hay que corregir
 * allí y lo que le falta a TU perfil antes de subirlo.
 */
import { describe, expect, it } from 'vitest';

import { linkedinPlan, type PlanItem } from '../../src/app';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'headline: Arquitecta de software', 'links: []', '---', '', 'Resumen de Ada.', ''].join('\n');

function experience(company: string, role: string, start: string, end: string | undefined, extra: readonly string[] = []): string {
  return ['---', `company: ${company}`, `role: ${role}`, `start: ${start}`, ...(end === undefined ? [] : [`end: ${end}`]), 'tags: [php]', '---', '', '## Logros', '', '- Hice algo medible #php', ...extra, ''].join('\n');
}

/** El salto de línea, como constante: los ficheros de prueba se componen uniendo líneas. */
const NL = '\n';

const SOURCES = '/work/data/sources';
const DRAFT = '/work/import/linkedin';

function workspace(extra: Record<string, string> = {}): MemoryFileSystem {
  return new MemoryFileSystem({
    [`${SOURCES}/profile.md`]: PROFILE,
    [`${SOURCES}/experience/acme.md`]: experience('ACME Corp', 'Arquitecta de software', '2023-01', undefined),
    [`${SOURCES}/skills.csv`]: 'name,category,level,years,aliases,tags\nKubernetes,platform,expert,,k8s,devops\nPHP,language,expert,,,backend\n',
    ...extra,
  });
}

/** El plan como pares «acción → título», que es lo que se lee de un vistazo. */
function summarize(items: readonly PlanItem[]): string[] {
  return items.map((item) => `${item.action} ${item.kind}: ${item.title}`);
}

describe('linkedinPlan', () => {
  it('sin borrador todo lo tuyo es «añadir»: es lo que necesita quien aún no ha exportado nada', async () => {
    // Con logros transversales, que son los que cierran el «Acerca de»: los datos que nadie más puede poner.
    const context = appContext(workspace({ [`${SOURCES}/achievements.md`]: ['- Firmé 13.032 commits #liderazgo', ''].join(NL) }));
    const result = await linkedinPlan(context, { data: 'data/sources' });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.draft).toBeUndefined();
    expect(result.plan.counts.fix).toBe(0);
    const titles = summarize(result.plan.items);
    expect(titles).toContain('add headline: Poner tu titular');
    const about = result.plan.items.find((item) => item.kind === 'about');
    expect(about?.body).toContain('Resumen de Ada.');
    expect(about?.body).toContain('• Firmé 13.032 commits');
    expect(titles.some((title) => title.startsWith('add experience: Arquitecta de software · ACME Corp'))).toBe(true);
    expect(titles.some((title) => title.startsWith('add skills: 2 aptitudes'))).toBe(true);
  });

  it('lo que está en los dos y no dice lo mismo se anota como «corregir», con las fuentes de referencia', async () => {
    const context = appContext(
      workspace({
        [`${DRAFT}/profile.md`]: PROFILE.replace('headline: Arquitecta de software', 'headline: Developer'),
        // El mismo empleo: misma empresa y periodos que solapan, pero con otro puesto y otras fechas.
        [`${DRAFT}/experience/acme.md`]: experience('acme corp', 'Developer', '2023-03', undefined),
      }),
    );
    const result = await linkedinPlan(context, { data: 'data/sources', draft: 'linkedin' });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.plan.draft).toBe('linkedin');
    const titles = summarize(result.plan.items);
    expect(titles).toContain('fix headline: Cambiar el titular (LinkedIn dice «Developer»)');
    expect(titles).toContain('fix experience: «Developer · acme corp» → «Arquitecta de software · ACME Corp»');
    expect(titles).toContain('fix experience: Arquitecta de software · ACME Corp: 2023-03 – actualidad → 2023-01 – actualidad');
    // Y no lo cuenta además como «añadir»: es la misma entrada, no una nueva.
    expect(titles.some((title) => title.startsWith('add experience:'))).toBe(false);
  });

  it('una entrada del borrador se empareja UNA vez, y con la que más se le parece', async () => {
    // Tres etapas en la misma empresa contra una sola entrada abierta de LinkedIn: sin el uno a uno, esa
    // entrada sería la contrapartida de las tres y las tres saldrían como «corregir».
    const context = appContext(
      workspace({
        [`${SOURCES}/experience/etapa2.md`]: experience('ACME Corp', 'Senior Engineer', '2021-01', '2022-12'),
        [`${SOURCES}/experience/etapa1.md`]: experience('ACME Corp', 'Engineer', '2019-01', '2020-12'),
        [`${DRAFT}/profile.md`]: PROFILE,
        [`${DRAFT}/experience/acme.md`]: experience('ACME Corp', 'Engineer', '2019-01', undefined),
      }),
    );
    const result = await linkedinPlan(context, { data: 'data/sources', draft: 'linkedin' });
    const titles = result.ok ? summarize(result.plan.items) : [];
    // La de LinkedIn se lleva la que más se le parece por título; las otras dos hay que subirlas.
    expect(titles.filter((title) => title.startsWith('add experience:'))).toHaveLength(2);
    // Y una sola de las tres puede salir como «corregir»: la emparejada.
    expect(titles.filter((title) => title.startsWith('fix experience:')).length).toBeLessThanOrEqual(2);
  });

  it('las aptitudes se comparan también por alias: «GCP» y «Google Cloud» no son dos', async () => {
    const context = appContext(
      workspace({
        [`${DRAFT}/profile.md`]: PROFILE,
        [`${DRAFT}/skills.csv`]: 'name,category,level,years,aliases,tags\nk8s,platform,,,,\n',
      }),
    );
    const result = await linkedinPlan(context, { data: 'data/sources', draft: 'linkedin' });
    const skills = result.ok ? result.plan.items.find((item) => item.kind === 'skills') : undefined;
    // Kubernetes ya está en LinkedIn como «k8s», que es su alias: solo falta PHP.
    expect(skills?.title).toBe('1 aptitudes que tienes y LinkedIn no');
    expect(skills?.body).toBe('PHP');
  });

  it('lo que LinkedIn trae y tus fuentes no se marca para revisar, no se copia a ciegas', async () => {
    const context = appContext(
      workspace({
        [`${DRAFT}/profile.md`]: PROFILE,
        [`${DRAFT}/experience/otra.md`]: experience('Otra Empresa', 'Developer', '2015-01', '2016-01'),
      }),
    );
    const result = await linkedinPlan(context, { data: 'data/sources', draft: 'linkedin' });
    const titles = result.ok ? summarize(result.plan.items) : [];
    expect(titles).toContain('pending experience: LinkedIn tiene «Developer · Otra Empresa» (2015-01 – 2016-01) y tus fuentes no');
  });

  it('lo que le falta a TU perfil se dice aparte: sin logros, sin etiquetas y sin certificaciones', async () => {
    const context = appContext(
      workspace({
        [`${SOURCES}/experience/vacia.md`]: ['---', 'company: Vacía S.L.', 'role: Soporte', 'start: 2010-01', 'end: 2010-06', '---', ''].join('\n'),
      }),
    );
    const result = await linkedinPlan(context, { data: 'data/sources' });
    const titles = result.ok ? summarize(result.plan.items) : [];
    expect(titles).toContain('pending experience: «Soporte · Vacía S.L.» no tiene ningún logro');
    expect(titles).toContain('pending experience: «Soporte · Vacía S.L.» no tiene etiquetas');
    expect(titles).toContain('pending certifications: No tienes ninguna certificación registrada');

    // Con una certificación registrada, ese apunte desaparece: no se repite lo que ya está hecho.
    const conCertificacion = appContext(workspace({ [`${SOURCES}/certifications.csv`]: ['name,issuer,date,url,tags,id', 'CKA,CNCF,2025-03,,devops,cert-cka'].join(NL) }));
    const otro = await linkedinPlan(conCertificacion, { data: 'data/sources' });
    expect(otro.ok && summarize(otro.plan.items).some((title) => title.startsWith('pending certifications:'))).toBe(false);
  });

  it('los proyectos, la formación y los idiomas también entran, cada uno con su clase', async () => {
    const context = appContext(
      workspace({
        [`${SOURCES}/projects/cli.md`]: ['---', 'name: Chameleon CLI', 'start: 2026-01', '---', '', '## Logros', '', '- Publiqué la 1.0 #php', ''].join('\n'),
        [`${SOURCES}/education/ciclo.md`]: ['---', 'institution: IES Ejemplo', 'degree: Ciclo Superior', 'start: 2008', 'end: 2010', '---', ''].join('\n'),
        [`${SOURCES}/profile.md`]: PROFILE.replace('---\n\nResumen', 'languages:\n  - { name: Español, level: native }\n---\n\nResumen'),
      }),
    );
    const result = await linkedinPlan(context, { data: 'data/sources' });
    const kinds = result.ok ? new Set(result.plan.items.map((item) => item.kind)) : new Set();
    expect(kinds.has('project')).toBe(true);
    expect(kinds.has('education')).toBe(true);
    expect(kinds.has('languages')).toBe(true);
  });

  it('entre dos candidatas de la misma empresa gana la que más se parece, no la primera que aparece', async () => {
    const context = appContext(
      workspace({
        [`${DRAFT}/profile.md`]: PROFILE,
        // Las dos casan por empresa y periodo; la segunda es la misma que la del perfil.
        [`${DRAFT}/experience/a.md`]: experience('ACME Corp', 'Becaria de sistemas', '2023-01', undefined),
        [`${DRAFT}/experience/b.md`]: experience('ACME Corp', 'Arquitecta de software', '2023-01', undefined),
        // Y una tercera peor que la ya elegida: se evalúa y no gana.
        [`${DRAFT}/experience/c.md`]: experience('ACME Corp', 'Practicas de verano', '2023-01', undefined),
      }),
    );
    const result = await linkedinPlan(context, { data: 'data/sources', draft: 'linkedin' });
    const titles = result.ok ? summarize(result.plan.items) : [];
    // Se empareja con «Arquitecta de software», así que no hay nada que corregir en el título…
    expect(titles.some((title) => title.startsWith('fix experience: «'))).toBe(false);
    // …y la otra queda como algo que revisar, no como una entrada tuya que falte.
    expect(titles).toContain('pending experience: LinkedIn tiene «Becaria de sistemas · ACME Corp» (2023-01 – actualidad) y tus fuentes no');
    expect(titles).toContain('pending experience: LinkedIn tiene «Practicas de verano · ACME Corp» (2023-01 – actualidad) y tus fuentes no');
  });

  it('un proyecto sin fechas, con resumen y con logros se copia entero', async () => {
    const context = appContext(
      workspace({
        [`${SOURCES}/projects/cli.md`]: ['---', 'name: Chameleon CLI', '---', '', 'Un generador de CV.', '', '## Logros', '', '- Publiqué la 1.0 #php', ''].join(NL),
      }),
    );
    const result = await linkedinPlan(context, { data: 'data/sources' });
    const project = result.ok ? result.plan.items.find((item) => item.kind === 'project') : undefined;
    expect(project?.title).toBe('Chameleon CLI · sin fechas');
    expect(project?.body).toBe('Un generador de CV.\n• Publiqué la 1.0');
  });

  it('un idioma que LinkedIn ya trae no se propone otra vez', async () => {
    const conIdiomas = PROFILE.replace('links: []', 'links: []\nlanguages:\n  - { name: Español, level: native }\n  - { name: Inglés, level: B1 }');
    const context = appContext(
      workspace({
        [`${SOURCES}/profile.md`]: conIdiomas,
        [`${DRAFT}/profile.md`]: PROFILE.replace('links: []', 'links: []\nlanguages:\n  - { name: español, level: native }'),
      }),
    );
    const result = await linkedinPlan(context, { data: 'data/sources', draft: 'linkedin' });
    const languages = result.ok ? result.plan.items.find((item) => item.kind === 'languages') : undefined;
    expect(languages?.body).toBe('Inglés (B1)');
  });

  it('unas fuentes que no cargan, o un borrador que no existe, se dicen sin adivinar nada', async () => {
    expect(await linkedinPlan(appContext(new MemoryFileSystem({})), { data: 'data/sources' })).toMatchObject({ ok: false });
    expect(await linkedinPlan(appContext(workspace()), { data: 'data/sources', draft: '../fuera' })).toMatchObject({ ok: false, error: { message: expect.stringContaining('no válido') as string } });
    expect(await linkedinPlan(appContext(workspace()), { data: 'data/sources', draft: 'no-esta' })).toMatchObject({ ok: false, error: { message: expect.stringContaining('No se pudo leer el borrador') as string } });
  });
});
