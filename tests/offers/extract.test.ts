/**
 * Bordes del extractor (T-8.5 S1): entidades, JSON-LD en listas y `@graph`, variantes de lugar y salario,
 * metadatos `og:*` en ambos órdenes de atributos y las reservas de la cascada. El corpus (quality.test.ts)
 * cubre el camino real; aquí, el resto de ramas.
 */
import { describe, expect, it } from 'vitest';

import { SHORT_DESCRIPTION_WORDS, decodeEntities, extractOffer, findJobPosting, htmlToText, mainText, wordCount } from '../../src/offers';

const LONG = Array.from({ length: 60 }, (_, i) => `palabra${i} relleno útil`).join(' ');

function jobPage(posting: object, body = ''): string {
  return `<html><head><title>t</title></head><body><script type="application/ld+json">${JSON.stringify(posting)}</script>${body}</body></html>`;
}

describe('htmlToText y entidades', () => {
  it('decodifica entidades numéricas (decimales y hexadecimales), con nombre y deja intactas las desconocidas', () => {
    expect(decodeEntities('&aacute;&Ntilde;&euro;&#65;&#x42;&nbsp;&shy;&zzz;')).toBe('áÑ€AB &zzz;');
  });

  it('corta línea en bloques, pone viñeta en li, descarta script/style/svg y comentarios y normaliza espacios', () => {
    const text = htmlToText('<div>Hola   <b>mundo</b></div><script>x()</script><style>a{}</style><!-- nada --><ul><li>uno</li><li>dos</li></ul><p>fin</p>');
    expect(text).toBe('Hola mundo\n\n- uno\n- dos\n\nfin');
    expect(wordCount('')).toBe(0);
  });
});

describe('findJobPosting', () => {
  it('encuentra el JobPosting dentro de una lista, de un @graph o tras bloques con JSON inválido; sin él, undefined', () => {
    expect(findJobPosting(jobPage([{ '@type': 'BreadcrumbList' }, { '@type': 'JobPosting', title: 'A' }]))).toMatchObject({ title: 'A' });
    expect(findJobPosting(jobPage({ '@graph': [{ '@type': 'WebSite' }, { '@type': 'JobPosting', title: 'B' }] }))).toMatchObject({ title: 'B' });
    const broken = '<script type="application/ld+json">{rota</script>' + jobPage({ '@type': 'JobPosting', title: 'C' });
    expect(findJobPosting(broken)).toMatchObject({ title: 'C' });
    expect(findJobPosting(jobPage(['texto suelto', { '@type': 'JobPosting', title: 'D' }]))).toMatchObject({ title: 'D' });
    expect(findJobPosting(jobPage({ '@graph': 'no-un-array', '@type': 'JobPosting', title: 'E' }))).toMatchObject({ title: 'E' });
    expect(findJobPosting('<p>sin nada</p>')).toBeUndefined();
  });
});

describe('metadatos del JobPosting', () => {
  it('lugar: cadena simple, lista de Place con región, y TELECOMMUTE sin dirección', () => {
    const plain = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T', hiringOrganization: 'Acme', jobLocation: 'no-un-place', description: `<p>${LONG}</p>` }));
    expect(plain.company).toBe('Acme');
    expect(plain.location).toBeUndefined();
    const listed = extractOffer(
      jobPage({ '@type': 'JobPosting', title: 'T', jobLocation: [{ '@type': 'Place', address: { addressLocality: 'Valencia', addressRegion: 'VC', addressCountry: 'ES' } }], description: `<p>${LONG}</p>` }),
    );
    expect(listed.location).toBe('Valencia, VC, ES');
    const remote = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T', jobLocationType: 'TELECOMMUTE', description: `<p>${LONG}</p>` }));
    expect(remote.location).toBe('Remoto');
  });

  it('salario: valor único, solo mínimo, solo máximo, y ausente cuando no hay importes', () => {
    const single = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T', baseSalary: { currency: 'EUR', value: { value: 50000 } }, description: `<p>${LONG}</p>` }));
    expect(single.salary).toBe('50000 EUR');
    const from = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T', baseSalary: { currency: 'EUR', value: { minValue: 40000, unitText: 'YEAR' } }, description: `<p>${LONG}</p>` }));
    expect(from.salary).toBe('desde 40000 EUR (YEAR)');
    const upTo = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T', baseSalary: { value: { maxValue: 60000 } }, description: `<p>${LONG}</p>` }));
    expect(upTo.salary).toBe('hasta 60000');
    const none = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T', baseSalary: { currency: 'EUR', value: {} }, description: `<p>${LONG}</p>` }));
    expect(none.salary).toBeUndefined();
    const notRecord = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T', baseSalary: 'alto', description: `<p>${LONG}</p>` }));
    expect(notRecord.salary).toBeUndefined();
    const weird = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T', baseSalary: { currency: 'EUR', value: { value: true } }, description: `<p>${LONG}</p>` }));
    expect(weird.salary).toBeUndefined();
    const noValue = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T', baseSalary: { currency: 'EUR' }, description: `<p>${LONG}</p>` }));
    expect(noValue.salary).toBeUndefined();
  });

  it('salario con el valor como texto, descripción ausente y JobPosting sin metadatos (el texto es solo el cuerpo)', () => {
    const asString = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T', baseSalary: { currency: 'EUR', value: { value: '50k' } }, description: `<p>${LONG}</p>` }));
    expect(asString.salary).toBe('50k EUR');
    const noDescription = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T' }, `<main><p>${LONG}</p></main>`));
    expect(noDescription.source).toBe('json-ld+cuerpo');
    const bare = extractOffer(jobPage({ '@type': 'JobPosting', description: `<p>${LONG}</p>` }));
    expect(bare.title).toBeUndefined();
    expect(bare.text.startsWith('palabra0')).toBe(true);
  });

  it('mainText sin <body> usa todo el documento; la reserva de página incluye el poco contenido que haya', () => {
    expect(wordCount(mainText(`<div>${LONG}</div>`))).toBeGreaterThan(100);
    const sparse = extractOffer('<html><head><title>Puesto Y</title><meta property="og:description" content="Resumen."></head><body><div>tres palabras sueltas</div></body></html>');
    expect(sparse.source).toBe('página');
    expect(sparse.text).toContain('tres palabras sueltas');
    expect(sparse.text).toContain('Resumen.');
  });

  it('una oferta declarada sin apenas texto deja el aviso; el umbral corto está exportado', () => {
    const tiny = extractOffer(jobPage({ '@type': 'JobPosting', title: 'T', description: '<p>corta</p>' }));
    expect(tiny.warnings.join(' ')).toContain('apenas tiene texto');
    expect(SHORT_DESCRIPTION_WORDS).toBe(250);
  });
});

describe('reservas de la cascada', () => {
  it('sin JSON-LD ni contenido suficiente: og:title/og:description (en ambos órdenes de atributos) y aviso de JavaScript', () => {
    const spa = extractOffer('<html><head><title>Cargando…</title><meta content="Puesto X" property="og:title"><meta property="og:description" content="Descripción corta."></head><body><div id="root"></div></body></html>');
    expect(spa.source).toBe('página');
    expect(spa.title).toBe('Puesto X');
    expect(spa.text).toContain('Descripción corta.');
    expect(spa.warnings.join(' ')).toContain('JavaScript');
  });

  it('sin nada de nada: texto vacío, título del <title> si existe y aviso', () => {
    const empty = extractOffer('<html><body></body></html>');
    expect(empty.source).toBe('página');
    expect(empty.text).toBe('');
    const titled = extractOffer('<html><head><title>Solo título</title></head><body></body></html>');
    expect(titled.text).toBe('Solo título');
  });

  it('main con menos palabras que el mínimo se descarta y se usa el cuerpo sin cromada', () => {
    const html = `<html><body><nav><a href="/">Inicio</a></nav><main><p>poco</p></main><div>${LONG}</div></body></html>`;
    expect(wordCount(mainText(html))).toBeGreaterThan(100);
    expect(mainText(html)).not.toContain('Inicio');
  });
});
