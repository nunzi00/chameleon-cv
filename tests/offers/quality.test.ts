/**
 * Arnés de calidad del extractor (T-8.5 §4.6 y §S1.1): corpus versionado con la verdad conocida y umbrales
 * fijados ANTES de medir. Cada página: título y empresa exactos donde la página los declara; al menos el 95 %
 * de las palabras del cuerpo de la oferta presentes en el texto extraído; cero palabras de navegación o pie en
 * las sintéticas; y la procedencia (`source`) esperada. Las réplicas reproducen la estructura de las familias
 * reales de §S0 (LinkedIn, Jobgether, Manfred) con contenido inventado.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { extractOffer, wordCount, type OfferSource } from '../../src/offers';

const CORPUS = join(__dirname, 'corpus');

interface Truth {
  readonly file: string;
  readonly source: OfferSource;
  readonly title: string | undefined;
  readonly company: string | undefined;
  /** Frases del cuerpo que deben sobrevivir literalmente. */
  readonly mustContain: readonly string[];
  /** Umbral de cobertura de palabras del cuerpo (§S1.1). */
  readonly bodySample: string;
  /** Palabras de navegación/pie que no pueden colarse. */
  readonly forbidden: readonly string[];
  readonly minWords: number;
}

const NAV_WORDS = ['Iniciar sesión', 'Aviso legal', 'Privacidad', 'Cookies', 'Ofertas relacionadas', 'Portal Ficticio'] as const;

const CUERPO = 'Diseñar servicios en Go y TypeScript sobre Kubernetes con despliegues progresivos Operar PostgreSQL y Kafka con objetivos de disponibilidad Cinco años construyendo sistemas distribuidos en producción observabilidad métricas trazas registros estructurados Terraform Banda salarial euros según experiencia proceso entrevista equipo candidaturas';

const TRUTHS: readonly Truth[] = [
  {
    file: 'sintetica-jsonld-completa.html',
    source: 'json-ld',
    title: 'Ingeniera de Plataforma de Pagos',
    company: 'Ejemplar Software',
    mustContain: ['99,95 por ciento', 'Terraform', '55.000 a 70.000 euros'],
    bodySample: CUERPO,
    forbidden: NAV_WORDS,
    minWords: 190,
  },
  {
    file: 'sintetica-jsonld-corta.html',
    source: 'json-ld+cuerpo',
    title: 'Ingeniera de Plataforma de Pagos',
    company: 'Ejemplar Software',
    mustContain: ['99,95 por ciento', 'postmortems sin culpa', 'dos encuentros presenciales'],
    bodySample: CUERPO,
    forbidden: NAV_WORDS,
    minWords: 200,
  },
  {
    file: 'sintetica-main-sin-jsonld.html',
    source: 'contenido',
    title: 'Ingeniera de Plataforma de Pagos',
    company: undefined,
    mustContain: ['Ejemplar Software', 'guardias con un proceso de incidencias maduro'],
    bodySample: CUERPO,
    forbidden: NAV_WORDS,
    minWords: 180,
  },
  {
    file: 'sintetica-sin-semantica.html',
    source: 'contenido',
    title: 'Empleo 4482 — Portal Ficticio',
    company: undefined,
    mustContain: ['Ingeniera de Plataforma de Pagos', 'Ejemplar Software', 'Terraform'],
    bodySample: CUERPO,
    forbidden: ['Iniciar sesión', 'Aviso legal', 'Privacidad', 'Cookies', 'Ofertas relacionadas'],
    minWords: 200,
  },
  {
    file: 'sintetica-entidades.html',
    source: 'contenido',
    title: 'Ingeniera de Plataforma de Pagos – Ejemplar Software',
    company: undefined,
    mustContain: ['Construirás servicios críticos', 'PostgreSQL & Kafka', '99,95 %', '55.000–70.000 €', 'métricas, trazas & registros'],
    bodySample: 'Construirás servicios críticos pagos Operarás PostgreSQL Kafka Cinco años sistemas distribuidos Observabilidad métricas trazas registros Terraform infraestructura código Banda salarial según experiencia',
    forbidden: NAV_WORDS,
    minWords: 40,
  },
  {
    file: 'sintetica-spa-vacia.html',
    source: 'página',
    title: 'Ingeniera de Plataforma de Pagos — Ejemplar Software',
    company: undefined,
    mustContain: [],
    bodySample: '',
    forbidden: [],
    minWords: 0,
  },
  {
    file: 'replica-linkedin.html',
    source: 'json-ld',
    title: 'Backend Engineer - Go',
    company: 'Grupo Ficticio',
    mustContain: ['nueve millones de transacciones al mes', 'Guardias con proceso maduro'],
    bodySample: 'Grupo Ficticio equipo backend Go PostgreSQL Kafka plataforma transacciones Diseño servicios contratos API Guardias proceso maduro Remoto híbrido Barcelona',
    forbidden: NAV_WORDS,
    minWords: 30,
  },
  {
    file: 'replica-jobgether.html',
    source: 'json-ld',
    title: 'Senior QA Engineer',
    company: 'Corredora Financiera',
    mustContain: ['Playwright y pruebas de API', '100 % remoto'],
    bodySample: 'Senior QA Engineer estrategia pruebas plataforma inversión automatización extremo rendimiento calidad datos Playwright API puertas remoto España',
    forbidden: NAV_WORDS,
    minWords: 30,
  },
  {
    file: 'replica-manfred.html',
    source: 'json-ld+cuerpo',
    title: 'Product Manager',
    company: 'Fintecho',
    mustContain: ['descubrimiento continuo', 'criterios de aceptación medibles', 'caso práctico'],
    bodySample: 'vertical pagos Fintecho descubrimiento continuo clientes priorización datos entrega iterativa visión roadmap trimestral historias criterios aceptación medibles embudos retención lanzamientos marketing soporte experimentación métricas producto castellano inglés proceso conversaciones cultura práctico dirección',
    forbidden: NAV_WORDS,
    minWords: 120,
  },
];

/** Cobertura de palabras (≥ 4 letras, sin duplicados) de la muestra en el texto extraído. */
function coverage(sample: string, text: string): number {
  const words = [...new Set(sample.toLowerCase().split(/\s+/).filter((word) => word.length >= 4))];
  if (words.length === 0) {
    return 1;
  }
  const haystack = text.toLowerCase();
  return words.filter((word) => haystack.includes(word)).length / words.length;
}

describe('calidad del extractor sobre el corpus (T-8.5 §4.6: umbrales fijados antes de medir)', () => {
  for (const truth of TRUTHS) {
    it(`${truth.file}: procedencia ${truth.source}, metadatos exactos, ≥95 % del cuerpo y sin navegación`, () => {
      const offer = extractOffer(readFileSync(join(CORPUS, truth.file), 'utf8'));
      expect(offer.source).toBe(truth.source);
      expect(offer.title).toBe(truth.title);
      expect(offer.company).toBe(truth.company);
      expect(wordCount(offer.text)).toBeGreaterThanOrEqual(truth.minWords);
      for (const phrase of truth.mustContain) {
        expect(offer.text, `${truth.file} debe conservar «${phrase}»`).toContain(phrase);
      }
      expect(coverage(truth.bodySample, offer.text), `${truth.file}: cobertura del cuerpo`).toBeGreaterThanOrEqual(0.95);
      for (const word of truth.forbidden) {
        expect(offer.text, `${truth.file} no debe arrastrar «${word}»`).not.toContain(word);
      }
    });
  }

  it('la SPA vacía avisa de que la página se pinta con JavaScript y las descripciones cortas dejan constancia', () => {
    const spa = extractOffer(readFileSync(join(CORPUS, 'sintetica-spa-vacia.html'), 'utf8'));
    expect(spa.warnings.join(' ')).toContain('JavaScript');
    const manfred = extractOffer(readFileSync(join(CORPUS, 'replica-manfred.html'), 'utf8'));
    expect(manfred.warnings[0]).toMatch(/^la descripción del JSON-LD tiene \d+ palabras; el cuerpo se toma del contenido/);
    expect(manfred.salary).toBe('45000–60000 EUR (YEAR)');
    expect(manfred.location).toBe('Remoto (ES)');
  });
});
