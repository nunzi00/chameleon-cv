/**
 * El lector del informe de vida laboral (T-9.28): la tabla de situaciones, las que no son un empleo y el
 * periodo completo por empresa. Y lo que NO sale de aquí: los datos identificativos del informe.
 */
import { describe, expect, it } from 'vitest';

import { employersOf, parseVidaLaboral } from '../../src/import/vida-laboral';

/** Un informe como el real: cabecera con datos personales, tabla, y el pie de las referencias electrónicas. */
const INFORME = [
  'INFORME DE VIDA LABORAL - SITUACIONES',
  'DATOS IDENTIFICATIVOS',
  'NOMBRE Y APELLIDOS Nº SEGURIDAD SOCIAL DOCUMENTO IDENTIFICATIVO',
  'ADA EJEMPLO LOPEZ 271006072232 D.N.I. 033348202L',
  'SITUACIÓN/ES',
  'RÉGIMEN EMPRESA',
  'GENERAL 28249767718 VACACIONES RETRIBUIDAS Y NO',
  'DISFRUTADAS',
  '01.09.2026 01.09.2026 10.09.2026 --- --- -- 4',
  'GENERAL 28249767718 YOUR LIFE CORREDURIA DE SEGUROS',
  'SL',
  '25.04.2022 25.04.2022 31.08.2026 100 --- 03 1.590',
  'GENERAL ----------- PRESTACION DESEMPLEO. EXTINCION 02.05.2017 02.05.2017 30.08.2017 --- --- 05 121',
  'GENERAL 27104248036 PICAS ROJAS, S.L.N.E. 08.01.2015 08.01.2015 31.10.2016 189 --- 07 601',
  'GENERAL 27001036031 LOPEZ GONZALEZ DANIEL 31.01.2007 31.01.2007 15.03.2007 402 --- 07 44',
  'GENERAL 27001036031 LOPEZ GONZALEZ DANIEL 01.02.2006 01.02.2006 22.09.2006 402 --- 07 234',
  'AUTONOMO ----------- LUGO 01.04.2009 01.04.2009 30.06.2009 --- --- -- 91',
  'REFERENCIAS ELECTRÓNICAS',
  'Id. CEA: Fecha: Código CEA: Página:',
  '056EOO5DA5MQ 04/09/2026 EY4IW-QQKVK-A7FHF-IE6RY-7W7WX-Y4BH5 3',
].join('\n');

describe('parseVidaLaboral', () => {
  it('lee las filas de la tabla y deja fuera todo lo demás del PDF', () => {
    const rows = parseVidaLaboral(INFORME);
    expect(rows).toHaveLength(7);
    // Ni la cabecera legal, ni los datos identificativos, ni el pie de las referencias electrónicas.
    expect(rows.every((row) => !row.company.includes('D.N.I.') && !row.company.includes('CEA'))).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('033348202L');
    expect(JSON.stringify(rows)).not.toContain('271006072232');
  });

  it('junta el nombre de la empresa aunque el PDF lo parta en varias líneas', () => {
    const rows = parseVidaLaboral(INFORME);
    expect(rows.find((row) => row.start === '2022-04-25')?.company).toBe('YOUR LIFE CORREDURIA DE SEGUROS SL');
  });

  it('convierte las fechas y los días, y reconoce lo que NO es un empleo', () => {
    const rows = parseVidaLaboral(INFORME);
    const life = rows.find((row) => row.company.startsWith('YOUR LIFE'));
    expect(life).toMatchObject({ start: '2022-04-25', end: '2026-08-31', days: 1590, employment: true, regime: 'GENERAL', account: '28249767718' });
    // Vacaciones no disfrutadas y prestación por desempleo son situaciones asimiladas al alta, no empleos.
    expect(rows.filter((row) => !row.employment).map((row) => row.company)).toEqual(['VACACIONES RETRIBUIDAS Y NO DISFRUTADAS', 'PRESTACION DESEMPLEO. EXTINCION']);
    // Sin cuenta de cotización no se inventa ninguna.
    expect(rows.find((row) => row.company.startsWith('PRESTACION'))?.account).toBeUndefined();
  });

  it('una fila sin empresa se descarta: no se inventa un empleo sin nombre', () => {
    expect(parseVidaLaboral('GENERAL 27104248036  08.01.2015 08.01.2015 31.10.2016 189 --- 07 601')).toEqual([]);
  });

  it('un texto que no es un informe no da filas, en vez de dar basura', () => {
    expect(parseVidaLaboral('Un currículum cualquiera con fechas 01.02.2020 y empresas.')).toEqual([]);
  });
});

describe('employersOf', () => {
  it('agrupa los contratos encadenados con la misma empresa: en un CV eso es UN empleo', () => {
    const employers = employersOf(parseVidaLaboral(INFORME));
    const daniel = employers.find((employer) => employer.company === 'LOPEZ GONZALEZ DANIEL');
    expect(daniel).toMatchObject({ start: '2006-02-01', end: '2007-03-15', spells: 2, days: 278 });
  });

  it('deja fuera las situaciones asimiladas y marca el alta de autónomo', () => {
    const employers = employersOf(parseVidaLaboral(INFORME));
    expect(employers.map((employer) => employer.company)).toEqual(['YOUR LIFE CORREDURIA DE SEGUROS SL', 'PICAS ROJAS, S.L.N.E.', 'LUGO', 'LOPEZ GONZALEZ DANIEL']);
    // En un alta de autónomo la «empresa» que consta es la provincia: hay que poder decirlo.
    expect(employers.find((employer) => employer.company === 'LUGO')?.selfEmployed).toBe(true);
    expect(employers.find((employer) => employer.company === 'PICAS ROJAS, S.L.N.E.')?.selfEmployed).toBe(false);
  });
});
