/**
 * Comparar las fechas de tus fuentes con el informe de vida laboral (T-9.28): qué no cuadra, qué falta a cada
 * lado y cómo se emparejó cada empleo, porque la razón social del informe casi nunca es la marca del CV.
 */
import { describe, expect, it } from 'vitest';

import { compareVidaLaboralText, stintsOf } from '../../src/app';
import { parseMasterProfile } from '../../src/core/schema';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const NL = '\n';
const SOURCES = '/work/data/sources';
const PROFILE = ['---', 'schemaVersion: 1', 'locale: es-ES', 'fullName: Ada Ejemplo', 'links: []', '---', ''].join(NL);

function experience(company: string, role: string, start: string, end?: string): string {
  return ['---', `company: ${company}`, `role: ${role}`, `start: ${start}`, ...(end === undefined ? [] : [`end: ${end}`]), '---', ''].join(NL);
}

/** Una fila de la tabla del informe, con la forma exacta que tiene en el PDF (la cuenta de cotización va a 11 dígitos). */
function row(account: string, company: string, start: string, end: string, days: string, regime = 'GENERAL'): string {
  return `${regime} ${account} ${company} ${start} ${start} ${end} 100 --- 03 ${days}`;
}

function workspace(extra: Record<string, string> = {}): MemoryFileSystem {
  return new MemoryFileSystem({ [`${SOURCES}/profile.md`]: PROFILE, ...extra });
}

describe('stintsOf: cuatro etapas en la misma empresa son UN empleo', () => {
  it('agrupa por contención de nombre, no por parecido: la ciudad compartida no basta', () => {
    const profile = parseMasterProfile({
      meta: { schemaVersion: 1, locale: 'es-ES' },
      personal: { fullName: 'Ada' },
      experience: [
        { id: 'a', company: 'Getlife (hoy Life5)', role: 'Backend', dates: { start: '2022-05', end: '2022-12' }, achievements: [], technologies: [], tags: [] },
        { id: 'b', company: 'Life5 (antes Getlife)', role: 'Platform', dates: { start: '2023-01', end: '2024-12' }, achievements: [], technologies: [], tags: [] },
        { id: 'c', company: 'Life5', role: 'Arquitecta', dates: { start: '2025-01' }, achievements: [], technologies: [], tags: [] },
        // Comparte la ciudad con la siguiente y NO es la misma empresa.
        { id: 'd', company: 'Baser Lugo', role: 'Web', dates: { start: '2011-04', end: '2012-09' }, achievements: [], technologies: [], tags: [] },
        { id: 'e', company: 'Concello de Lugo', role: 'Dev', dates: { start: '2016-09', end: '2017-05' }, achievements: [], technologies: [], tags: [] },
      ],
    });
    const stints = stintsOf(profile);
    expect(stints).toHaveLength(3);
    const life = stints.find((stint) => stint.ids.includes('a'));
    expect(life?.ids).toEqual(['a', 'b', 'c']);
    // El periodo del grupo va del comienzo de la primera etapa al final de la última; abierta sigue abierta.
    expect(life).toMatchObject({ start: '2022-05', end: undefined, stages: 3 });
    expect(stints.filter((stint) => stint.company.includes('Lugo'))).toHaveLength(2);
  });
});

describe('compareVidaLaboralText', () => {
  const INFORME = [
    'GENERAL 28249767718 VACACIONES RETRIBUIDAS Y NO DISFRUTADAS 01.09.2026 01.09.2026 10.09.2026 --- --- -- 4',
    row('28249767718', 'YOUR LIFE CORREDURIA DE SEGUROS SL', '25.04.2022', '31.08.2026', '1.590'),
    row('27104248036', 'PICAS ROJAS, S.L.N.E.', '08.01.2015', '31.10.2016', '601'),
    row('27107937571', 'BAHIA SOFTWARE, S.L.U.', '02.11.2021', '22.04.2022', '172'),
    row('27100000001', 'UNA SEMANA S.L.', '01.03.2019', '07.03.2019', '7'),
  ].join(NL);

  it('propone la fecha del informe cuando el inicio o el final no cuadran, y dice a qué ficheros afecta', async () => {
    const context = appContext(workspace({ [`${SOURCES}/experience/picas.md`]: experience('Picas Rojas', 'Dev', '2013-01', '2016-09') }));
    const result = await compareVidaLaboralText(context, { data: 'data/sources', text: INFORME });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const inicio = result.report.items.find((item) => item.kind === 'start');
    expect(inicio?.title).toBe('Picas Rojas empieza en 2013-01 y el informe dice 2015-01-08');
    expect(inicio?.matchedBy).toBe('name');
    expect(inicio?.sources).toEqual(['exp-picas']);
    expect(result.report.items.find((item) => item.kind === 'end')?.title).toBe('Picas Rojas termina en 2016-09 y el informe dice 2016-10-31');
  });

  it('un empleo abierto en tus fuentes con baja en el informe se dice aparte: es lo que más se nota', async () => {
    // La razón social del informe no se parece a la marca del CV: se empareja por el periodo y se avisa.
    const context = appContext(workspace({ [`${SOURCES}/experience/life.md`]: experience('Life5', 'Arquitecta', '2022-05') }));
    const result = await compareVidaLaboralText(context, { data: 'data/sources', text: INFORME });
    const abierto = result.ok ? result.report.items.find((item) => item.kind === 'still-open') : undefined;
    expect(abierto?.title).toContain('el informe registra la baja el 2026-08-31');
    expect(abierto?.matchedBy).toBe('period');
    expect(abierto?.detail).toContain('YOUR LIFE CORREDURIA DE SEGUROS SL');
  });

  it('las altas de más de un mes que faltan se enseñan; las de días, no', async () => {
    const context = appContext(workspace({ [`${SOURCES}/experience/picas.md`]: experience('Picas Rojas', 'Dev', '2015-01', '2016-10') }));
    const result = await compareVidaLaboralText(context, { data: 'data/sources', text: INFORME });
    const faltan = result.ok ? result.report.items.filter((item) => item.kind === 'missing-in-profile').map((item) => item.company) : [];
    expect(faltan).toContain('BAHIA SOFTWARE, S.L.U.');
    // Siete días son unas prácticas o una ETT: un CV los omite a propósito.
    expect(faltan).not.toContain('UNA SEMANA S.L.');
  });

  it('lo que tus fuentes tienen y el informe no se dice sin acusar a nadie: puede estar bien', async () => {
    const context = appContext(workspace({ [`${SOURCES}/experience/berlin.md`]: experience('Acme Berlin GmbH', 'Dev', '2018-01', '2019-01') }));
    const result = await compareVidaLaboralText(context, { data: 'data/sources', text: INFORME });
    const item = result.ok ? result.report.items.find((entry) => entry.kind === 'missing-in-report') : undefined;
    expect(item?.title).toContain('no aparece en el informe');
    expect(item?.detail).toContain('extranjero');
  });

  it('con dos candidatas por periodo no se empareja: elegir sería decidir por el usuario', async () => {
    // 2021-11 → 2022-06 solapa con YOUR LIFE y con BAHIA: no hay una respuesta, así que no se da ninguna.
    const context = appContext(workspace({ [`${SOURCES}/experience/dudosa.md`]: experience('Empresa Dudosa', 'Dev', '2021-11', '2022-06') }));
    const result = await compareVidaLaboralText(context, { data: 'data/sources', text: INFORME });
    const kinds = result.ok ? result.report.items.map((item) => item.kind) : [];
    expect(kinds).toContain('missing-in-report');
    expect(kinds).not.toContain('start');
  });

  it('con varias etapas en la misma empresa se dice que el desfase es del principio de la primera y del final de la última', async () => {
    const context = appContext(
      workspace({
        [`${SOURCES}/experience/picas1.md`]: experience('Picas Rojas', 'Junior', '2013-01', '2014-12'),
        [`${SOURCES}/experience/picas2.md`]: experience('Picas Rojas, S.L.N.E.', 'Senior', '2015-01', '2016-09'),
      }),
    );
    const result = await compareVidaLaboralText(context, { data: 'data/sources', text: INFORME });
    const items = result.ok ? result.report.items : [];
    expect(items.find((item) => item.kind === 'start')?.detail).toContain('primera etapa allí (2 en total)');
    expect(items.find((item) => item.kind === 'end')?.detail).toContain('última etapa allí');
  });

  it('entre dos altas de nombre parecido gana la que además solapa: es el mismo empleo, no un homónimo', async () => {
    const dosAcme = [row('27100000011', 'ACME CORP, S.L.', '01.01.2005', '31.12.2006', '700'), row('27100000012', 'ACME CORP, S.L.', '01.03.2019', '28.02.2021', '700')].join(NL);
    const context = appContext(workspace({ [`${SOURCES}/experience/acme.md`]: experience('Acme Corp', 'Dev', '2019-04', '2021-02') }));
    const result = await compareVidaLaboralText(context, { data: 'data/sources', text: dosAcme });
    // Se empareja con la de 2019 —la que solapa—, así que solo desencaja el inicio por un mes.
    const items = result.ok ? result.report.items : [];
    expect(items.find((item) => item.kind === 'start')?.title).toContain('el informe dice 2019-03-01');
    expect(items.filter((item) => item.kind === 'missing-in-profile')).toHaveLength(1);
  });

  it('un alta de autónomo se explica: la «empresa» que consta es la provincia', async () => {
    const context = appContext(workspace());
    const autonomo = `AUTONOMO ----------- LUGO 01.04.2009 01.04.2009 30.06.2009 --- --- -- 91${NL}${INFORME}`;
    const result = await compareVidaLaboralText(context, { data: 'data/sources', text: autonomo });
    const item = result.ok ? result.report.items.find((entry) => entry.company === 'LUGO') : undefined;
    expect(item?.detail).toContain('la provincia');
  });

  it('un empleo tuyo abierto que el informe no tiene se dice como abierto', async () => {
    const context = appContext(workspace({ [`${SOURCES}/experience/berlin.md`]: experience('Acme Berlin GmbH', 'Dev', '2018-01') }));
    const result = await compareVidaLaboralText(context, { data: 'data/sources', text: INFORME });
    expect(result.ok && result.report.items.find((item) => item.kind === 'missing-in-report')?.title).toContain('2018-01 → actualidad');
  });

  it('un PDF que no es un informe, o unas fuentes que no cargan, se dicen', async () => {
    expect(await compareVidaLaboralText(appContext(workspace()), { data: 'data/sources', text: 'un currículum cualquiera' })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('no parece un informe de vida laboral') as string },
    });
    expect(await compareVidaLaboralText(appContext(workspace()), { data: 'data/sources', text: 'nada', origin: 'informe.pdf' })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('«informe.pdf»') as string },
    });
    expect(await compareVidaLaboralText(appContext(new MemoryFileSystem({})), { data: 'data/sources', text: INFORME })).toMatchObject({ ok: false });
  });
});
