import { describe, expect, it } from 'vitest';

import type { DatasetError } from '../../../src/parsers/dataset/types';
import { MarkdownParser, parseAchievementsFile } from '../../../src/parsers/markdown/markdown-parser';

const parser = new MarkdownParser();

function expectErrors(source: string): readonly DatasetError[] {
  const result = parseAchievementsFile(source, 'achievements.md');
  if (result.ok) {
    throw new Error('Se esperaban errores');
  }
  return result.errors;
}

describe('MarkdownParser', () => {
  it('se identifica como plugin de .md', () => {
    expect(parser.name).toBe('markdown');
    expect(parser.extensions).toEqual(['.md']);
  });

  it('despacha por ruta a perfil, logros transversales y entidades', () => {
    expect(parser.parse({ path: 'profile.md', content: '---\nfullName: Ada\n---\n' }).ok).toBe(true);
    expect(parser.parse({ path: 'achievements.md', content: '- Uno\n' }).ok).toBe(true);
    const entity = parser.parse({ path: 'experience/acme.md', content: '---\ncompany: A\nrole: B\nstart: 2020\n---\n' });
    expect(entity.ok && entity.contribution.experience?.[0]?.id).toBe('exp-acme');
  });

  it.each(['foo.md', 'skills/php.md', 'experience/a/b.md', 'experience/acme.txt'])('rechaza la ruta %s', (path) => {
    expect(parser.parse({ path, content: '' })).toEqual({
      ok: false,
      errors: [{ file: path, message: 'Ruta no reconocida para el parser Markdown' }],
    });
  });
});

describe('parseAchievementsFile', () => {
  it('produce logros transversales con ids ach-<n> y procedencia por viñeta', () => {
    const result = parseAchievementsFile('- Ponente. #comunidad\n  - date: 2025-10\n- Mentora.\n', 'achievements.md');
    expect(result).toEqual({
      ok: true,
      contribution: {
        achievements: [
          { id: 'ach-1', text: 'Ponente.', tags: ['comunidad'], date: '2025-10' },
          { id: 'ach-2', text: 'Mentora.', tags: [] },
        ],
      },
      provenance: [
        { path: ['achievements', 0], file: 'achievements.md', line: 1 },
        { path: ['achievements', 1], file: 'achievements.md', line: 3 },
      ],
    });
  });

  it('rechaza frontmatter, secciones y contenido que no sea una lista, todo a la vez', () => {
    expect(expectErrors('---\na: 1\n---\n\nTexto.\n\n## Foo\n')).toEqual([
      { file: 'achievements.md', line: 1, message: 'achievements.md no lleva frontmatter' },
      { file: 'achievements.md', line: 7, message: 'Sección «## Foo» no admitida: achievements.md no lleva secciones' },
      { file: 'achievements.md', line: 1, message: 'achievements.md debe contener únicamente una lista de viñetas con los logros' },
    ]);
    expect(expectErrors('')).toHaveLength(1);
  });

  it('localiza los errores del esquema en la línea del metadato y propaga los de la lista', () => {
    expect(expectErrors('- Uno\n- Dos\n  - date: 2023-02-30\n')).toEqual([
      { file: 'achievements.md', line: 3, message: expect.stringMatching(/^achievements\[1\]\.date: Fecha inválida/) },
    ]);
    expect(expectErrors('- Uno\n  - foo: x\n')[0]?.message).toContain('metadato «foo» no admitido');
    expect(expectErrors('# Título\n')[0]?.message).toContain('Encabezado de nivel 1');
  });
});
