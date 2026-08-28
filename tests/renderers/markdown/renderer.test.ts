import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../../src/core/schema';
import { selectForSpecialty } from '../../../src/core/selection';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../../src/parsers';
import { BASE_TEMPLATE_PATH, loadBaseTemplate, normalizeMarkdown, renderMarkdownCv } from '../../../src/renderers/markdown';
import { selectionProfile } from '../../fixtures/selection';

const GOLDEN = readFileSync(join(__dirname, '../../fixtures/golden/cv-backend.md'), 'utf8');

describe('renderMarkdownCv', () => {
  it('reproduce exactamente el golden de docs/selector-engine.md §5.4 para la especialidad backend', () => {
    const selection = selectForSpecialty(selectionProfile(), 'backend');
    expect(selection.ok).toBe(true);
    if (!selection.ok) {
      return;
    }
    expect(renderMarkdownCv(selection.selection.profile)).toBe(GOLDEN);
  });

  it('respeta el locale del perfil y permite forzar otro', () => {
    const profile = selectionProfile();
    expect(renderMarkdownCv(profile)).toContain('## Experiencia');
    expect(renderMarkdownCv(profile, { locale: 'en' })).toContain('## Experience');
    const withoutLocale = parseMasterProfile({ personal: { fullName: 'Ada' }, languages: [{ name: 'Español', level: 'native' }] });
    expect(renderMarkdownCv(withoutLocale)).toBe('# Ada\n\n## Idiomas\n\n- Español: nativo\n');
  });

  it('admite una plantilla propia', () => {
    expect(renderMarkdownCv(selectionProfile(), { template: '{{fullName}} — {{labels.skills}}' })).toBe('Ada Ejemplo — Habilidades\n');
  });

  it('renderiza el perfil completo (sin selección) del dataset de ejemplo con todas las secciones', async () => {
    const dataset = await loadDataset(join(__dirname, '../../fixtures/dataset'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
    expect(dataset.ok).toBe(true);
    if (!dataset.ok) {
      return;
    }
    const markdown = renderMarkdownCv(dataset.profile);
    for (const heading of ['## Experiencia', '## Proyectos', '## Habilidades', '## Logros destacados', '## Formación', '## Certificaciones', '## Idiomas']) {
      expect(markdown).toContain(heading);
    }
    expect(markdown).toContain('### Tech Lead · Startup Ejemplo\n\n*jul 2024 – actualidad*');
    expect(markdown).toContain('### Chameleon CLI · Autora\n\n*ago 2026 – actualidad · https://example.com/chameleon*');
    expect(markdown.indexOf('### Tech Lead · Startup Ejemplo')).toBeLessThan(markdown.indexOf('### Senior Backend Engineer · ACME Corp'));
    expect(markdown).not.toMatch(/\n{3,}/);
  });
});

describe('utilidades', () => {
  it('normalizeMarkdown limpia espacios finales, líneas vacías repetidas y bordes', () => {
    expect(normalizeMarkdown('\n\n# T  \n\n\n\nx\n\n\n')).toBe('# T\n\nx\n');
    expect(normalizeMarkdown('sin cambios')).toBe('sin cambios\n');
  });

  it('carga la plantilla base desde templates/cv.md.hbs', () => {
    expect(BASE_TEMPLATE_PATH.endsWith(join('templates', 'cv.md.hbs'))).toBe(true);
    expect(loadBaseTemplate()).toContain('{{fullName}}');
  });
});
