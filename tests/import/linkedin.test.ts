/**
 * Exportación oficial de datos de LinkedIn → borrador: los CSV traen los datos ya estructurados, así que aquí
 * no se adivina maquetación y nada queda «sin situar». Lo que se comprueba es el mapeo columna a columna, los
 * niveles de idioma, la fecha vacía como «en curso» y que un zip que no es una exportación se explique.
 */
import { describe, expect, it } from 'vitest';

import { importLinkedInExport } from '../../src/import/linkedin';
import { zipOf } from '../helpers/zip';

const PROFILE = 'First Name,Last Name,Headline,Summary,Geo Location,Websites\r\nAda,Ejemplo,Ingeniera de software,Resumen del perfil.,"Valencia, España",[PERSONAL:https://ada.dev]\r\n';
const POSITIONS =
  'Company Name,Title,Description,Location,Started On,Finished On\r\nNexo Pagos,Staff Backend Engineer,Pasarela de pagos.,Valencia,Mar 2022,\r\nLumen Analytics,Data Engineer,Modelos de datos.,Madrid,Sep 2015,Dec 2016\r\n';

function exported(entries: ReadonlyArray<readonly [string, string]>) {
  return importLinkedInExport(zipOf(entries));
}

describe('importLinkedInExport', () => {
  it('mapea perfil, puestos, formación, certificaciones, habilidades e idiomas', () => {
    const result = exported([
      ['Profile.csv', PROFILE],
      ['Positions.csv', POSITIONS],
      ['Education.csv', 'School Name,Start Date,End Date,Notes,Degree Name,Activities\r\nUniversitat de València,2011,2013,,Grado en Informática,Delegada\r\n'],
      ['Skills.csv', 'Name\r\nPHP\r\nKubernetes\r\n'],
      ['Languages.csv', 'Name,Proficiency\r\nSpanish,Native or bilingual proficiency\r\nEnglish,Full professional proficiency\r\nFrench,Elementary proficiency\r\n'],
      ['Certifications.csv', 'Name,Url,Authority,Started On,Finished On,License Number\r\nAWS SAA,https://example.org/c,Amazon,Feb 2020,,\r\n'],
      ['Email Addresses.csv', 'Email Address,Confirmed,Primary,Updated On\r\notro@example.org,Yes,No,\r\nada@example.org,Yes,Yes,\r\n'],
      ['PhoneNumbers.csv', 'Extension,Number,Type\r\n,+34 600 123 456,MOBILE\r\n'],
    ]);
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const { draft } = result;
    expect(draft).toMatchObject({
      fullName: 'Ada Ejemplo',
      headline: 'Ingeniera de software',
      summary: 'Resumen del perfil.',
      location: 'Valencia, España',
      // Se toma el correo marcado como principal, no el primero de la lista.
      email: 'ada@example.org',
      phone: '+34 600 123 456',
      links: ['https://ada.dev'],
    });
    expect(draft.experience[0]).toMatchObject({ title: 'Staff Backend Engineer', subtitle: 'Nexo Pagos', location: 'Valencia', start: '2022-03', current: true });
    // Sin «Finished On» la entrada está en curso; con él, se traduce a ISO.
    expect(draft.experience[0]?.end).toBeUndefined();
    expect(draft.experience[1]).toMatchObject({ start: '2015-09', end: '2016-12', current: false });
    expect(draft.education[0]).toMatchObject({ title: 'Grado en Informática', subtitle: 'Universitat de València', start: '2011', end: '2013', summary: 'Delegada' });
    expect(draft.certifications[0]).toMatchObject({ title: 'AWS SAA', subtitle: 'Amazon', date: '2020-02', url: 'https://example.org/c' });
    expect(draft.skills[0]?.names).toEqual(['PHP', 'Kubernetes']);
    expect(draft.languages).toEqual([
      { name: 'Spanish', level: 'native' },
      { name: 'English', level: 'C1' },
      { name: 'French', level: 'A2' },
    ]);
    // Con datos estructurados no hay nada que situar a mano: esa es la ventaja frente a importar el PDF.
    expect(draft.unparsed).toEqual([]);
    expect(result.read).toContain('Positions.csv');
  });

  it('lo que falta simplemente no aparece, y un nivel de idioma desconocido se queda sin nivel', () => {
    const result = exported([
      ['Profile.csv', 'First Name,Last Name\r\nAda,Ejemplo\r\n'],
      ['Languages.csv', 'Name,Proficiency\r\nKlingon,Conversational\r\n'],
      ['Skills.csv', 'Name\r\n\r\n'],
    ]);
    expect(result.ok && result.draft).toMatchObject({ fullName: 'Ada Ejemplo', headline: undefined, email: undefined, phone: undefined, links: [] });
    expect(result.ok && result.draft.languages).toEqual([{ name: 'Klingon', level: undefined }]);
    // Una columna Name vacía no deja un grupo de habilidades fantasma.
    expect(result.ok && result.draft.skills).toEqual([]);
  });

  it('descarta las filas sin título y admite Projects.csv', () => {
    const result = exported([
      ['Positions.csv', 'Company Name,Title,Started On\r\nAcme,,Mar 2022\r\nAcme,Dev,Mar 2022\r\n'],
      ['Projects.csv', 'Title,Description,Url,Started On,Finished On\r\nChameleon CV,Generador de CV.,https://example.org/p,Jan 2026,\r\n'],
    ]);
    expect(result.ok && result.draft.experience).toHaveLength(1);
    expect(result.ok && result.draft.projects[0]).toMatchObject({ title: 'Chameleon CV', url: 'https://example.org/p', start: '2026-01' });
  });

  it('explica un zip que no se puede leer y uno que no es una exportación de LinkedIn', () => {
    expect(importLinkedInExport(new Uint8Array([1, 2, 3]))).toMatchObject({ ok: false, message: expect.stringContaining('no se puede leer como zip') as string });
    expect(exported([['otra-cosa.txt', 'hola']])).toMatchObject({ ok: false, message: expect.stringContaining('no parece una exportación de LinkedIn') as string });
  });

  it('un CSV ilegible se explica con su nombre en vez de tumbar la importación en silencio', () => {
    // Comillas sin cerrar: csv-parse lo rechaza y el mensaje debe decir en qué fichero mirar.
    expect(exported([['Profile.csv', 'First Name\r\n"sin cerrar\r\n']])).toMatchObject({ ok: false, message: expect.stringContaining('Profile.csv') as string });
  });

  it('encuentra los CSV aunque la exportación los envuelva en una carpeta', () => {
    const result = exported([['Basic_LinkedInDataExport/Positions.csv', 'Company Name,Title,Started On\r\nAcme,Dev,Mar 2022\r\n']]);
    expect(result.ok && result.draft.experience).toHaveLength(1);
  });
});
