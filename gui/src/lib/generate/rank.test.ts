/**
 * La comparación de varias ofertas en la pantalla (T-9.13): las mismas columnas que la tabla de la terminal, sin
 * calcular ninguna métrica aquí, y con cada fallo y cada aviso nombrando la oferta que lo provocó.
 */
import { describe, expect, it } from 'vitest';

import { rankView } from './rank';
import type { RankResponse } from '../api/types';

const RESPONSE = {
  ranked: [
    { name: 'acme-backend', recognized: 5, demonstrated: 4, ratio: 0.8, requiredTotal: 3, requiredDemonstrated: 3, gaps: ['kafka', 'aws'], suggestedSpecialty: 'backend' },
    { name: 'sin-requisitos', recognized: 0, demonstrated: 0, ratio: undefined, requiredTotal: 0, requiredDemonstrated: 0, gaps: [], suggestedSpecialty: undefined },
  ],
  failed: [{ offer: 2, message: 'No se pudo leer offers/rota.txt' }],
  warnings: [{ offer: 1, warning: { kind: 'offer-without-requirements' as const, words: 6, recognized: 0, link: undefined } }],
} as unknown as RankResponse;

describe('rankView', () => {
  it('cada fila trae lo que ya verías analizando esa oferta sola, y el orden es el que llega', () => {
    const view = rankView(RESPONSE, ['offers/acme.txt', 'offers/vacia.txt', 'offers/rota.txt']);
    expect(view.rows[0]).toEqual({ name: 'acme-backend', fit: '4/5 (80 %)', required: '3/3', specialty: 'backend', gaps: 'kafka, aws' });
    // Sin un solo requisito reconocible no se inventa un porcentaje: «—», como en la terminal.
    expect(view.rows[1]).toEqual({ name: 'sin-requisitos', fit: '—', required: '0/0', specialty: '—', gaps: '—' });
    // El servidor devuelve posiciones; quien pregunta pone los nombres.
    expect(view.failed).toEqual(['offers/rota.txt: No se pudo leer offers/rota.txt']);
    expect(view.warnings).toEqual(['offers/vacia.txt: offer-without-requirements']);
  });

  it('si falta el nombre de una oferta no se rompe la tabla: se la llama «oferta»', () => {
    const view = rankView(RESPONSE, []);
    expect(view.failed[0]).toBe('oferta: No se pudo leer offers/rota.txt');
    expect(view.warnings[0]).toBe('oferta: offer-without-requirements');
  });
});
