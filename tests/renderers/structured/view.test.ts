import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../../src/core/schema';
import { selectForSpecialty } from '../../../src/core/selection';
import { buildStructuredView, normalizeText, type Run } from '../../../src/renderers/structured';
import { fullProfileInput, minimalProfileInput } from '../../fixtures/master-profile';
import { selectionProfile } from '../../fixtures/selection';

const plain = (text: string): Run => ({ text, bold: false, italic: false, code: false, link: undefined });

describe('buildStructuredView', () => {
  it('reproduce exactamente los datos del PoC de Typst (docs/poc/typst/cv-backend.json) para el CV backend', () => {
    const selection = selectForSpecialty(selectionProfile(), 'backend');
    if (!selection.ok) {
      throw new Error('selección');
    }
    const view = buildStructuredView(selection.selection.profile, 'es-ES');
    const poc: unknown = JSON.parse(readFileSync(join(__dirname, '../../../docs/poc/typst/cv-backend.json'), 'utf8'));
    expect(JSON.parse(JSON.stringify(view))).toEqual(poc);
  });

  it('descompone el Markdown en línea en runs y bloques, sin claves nulas y con el idioma de dos letras', () => {
    const view = buildStructuredView(parseMasterProfile(fullProfileInput()), 'en');
    expect(view.locale).toBe('en');
    expect(view.lang).toBe('en');
    expect(view.labels.experience).toBe('Experience');
    expect(view.headline).toBe('Ingeniera de software');
    expect(view.contact.some((run) => run.link === 'https://github.com/ada-ejemplo' && run.text === 'GitHub')).toBe(true);
    expect(view.summary.map((block) => block.runs.map((run) => run.text).join(''))).toEqual(['Primera línea.\nSegunda línea con tabulador.']);
    const acme = view.experience.find((item) => item.company === 'ACME Corp');
    expect(acme).toMatchObject({ role: 'Senior Backend Engineer', location: 'Madrid (remoto)', technologies: 'PHP 8, Symfony' });
    expect(acme?.achievements[0]).toEqual({
      runs: [plain('Reduje la latencia p95 un '), { text: '40 %', bold: true, italic: false, code: false, link: undefined }, plain('.')],
      impact: '-40 % p95',
    });
    const startup = view.experience.find((item) => item.company === 'Startup');
    expect(startup).toEqual({ role: 'Tech Lead', company: 'Startup', period: 'Jul 2024 – present', summary: [], achievements: [], technologies: '' });
    expect(view.projects[0]).toMatchObject({ name: 'Chameleon CLI', role: 'Autora', meta: 'Aug 2026 – present · https://example.com/chameleon' });
    expect(view.certifications[0]).toEqual({ name: 'CKA', issuer: 'CNCF', date: 'May 10, 2022', url: 'https://example.com/cert' });
    expect(view.education[0]).toEqual({ degree: 'Grado en Ingeniería Informática', field: 'Software', institution: 'Universidad Ejemplo', period: '2010 – 2014' });
    expect(view.languages).toEqual([
      { name: 'Español', level: 'native' },
      { name: 'Inglés', level: 'C1' },
    ]);
    expect(JSON.stringify(view)).not.toContain('null');
  });

  it('un perfil mínimo produce solo el nombre, sin secciones', () => {
    const view = buildStructuredView(parseMasterProfile(minimalProfileInput()), 'es');
    expect(view).toEqual({
      locale: 'es',
      lang: 'es',
      labels: view.labels,
      fullName: 'Ada Ejemplo',
      contact: [],
      summary: [],
      experience: [],
      projects: [],
      skillGroups: [],
      achievements: [],
      education: [],
      certifications: [],
      languages: [],
    });
    expect('headline' in view).toBe(false);
  });

  it('normaliza los tabuladores a espacios en todos los textos', () => {
    expect(normalizeText('a\tb\t')).toBe('a b ');
    const profile = parseMasterProfile({
      personal: { fullName: 'Ada', summary: 'con\ttab' },
      experience: [{ id: 'exp-1', company: 'ACME', role: 'Dev', dates: { start: '2020' }, achievements: [{ id: 'a-1', text: 'logro\tcon **tab**\tfin' }] }],
    });
    const view = buildStructuredView(profile, 'es');
    expect(view.summary[0]?.runs).toEqual([plain('con tab')]);
    expect(view.experience[0]?.achievements[0]?.runs.map((run) => run.text)).toEqual(['logro con ', 'tab', ' fin']);
  });
});
