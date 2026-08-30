import { describe, expect, it } from 'vitest';

import { formatWarning } from '../../src/cli/output';

describe('formatWarning', () => {
  it('describe cada aviso en una línea', () => {
    expect(formatWarning({ kind: 'unknown-selection', section: 'skills', names: ['Nadie', 'Otro'] })).toBe('Aviso: skills no encontrados en el perfil (se ignoran): Nadie, Otro\n');
    expect(formatWarning({ kind: 'unknown-selection', section: 'projects', names: ['proj-x'] })).toBe('Aviso: proyectos no encontrados en el perfil (se ignoran): proj-x\n');
    expect(formatWarning({ kind: 'items-truncated', total: 9, kept: 4 })).toContain('9 logros superan el máximo');
    expect(formatWarning({ kind: 'history-unwritable', message: 'EACCES' })).toBe('Aviso: no se pudo anotar la oferta en el historial (output/historial-ofertas.json): EACCES\n');
  });
});
