import { describe, expect, it } from 'vitest';

import { extensionOf, loadDataset, normalizeText, sortErrors, type DatasetResult } from '../../../src/parsers/dataset/loader';
import type { ProfileContribution, SourceParser } from '../../../src/parsers/dataset/types';
import { MarkdownParser } from '../../../src/parsers/markdown/markdown-parser';
import { MemoryFileSystem, datasetTree, type MemoryEntry } from '../../helpers/memory-file-system';

const markdown = new MarkdownParser();

async function load(tree: Record<string, string | MemoryEntry>, parsers: readonly SourceParser[] = [markdown]): Promise<DatasetResult> {
  return loadDataset('/data', { fileSystem: new MemoryFileSystem(tree), parsers });
}

async function expectErrors(tree: Record<string, string | MemoryEntry>, parsers?: readonly SourceParser[]): Promise<string[]> {
  const result = await load(tree, parsers);
  if (result.ok) {
    throw new Error('Se esperaban errores');
  }
  return result.errors.map((error) => `${error.file}:${error.line ?? '-'}: ${error.message}`);
}

const EXPERIENCE = '---\ncompany: ACME\nrole: Dev\nstart: 2020\n---\n\n## Logros\n\n- Uno #php\n';

describe('loadDataset', () => {
  it('carga un dataset válido en un MasterProfile canónico', async () => {
    const result = await load(
      datasetTree({
        '/data/experience/acme.md': EXPERIENCE,
        '/data/achievements.md': '- Ponente. #comunidad\n',
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.files).toEqual(['profile.md', 'experience/acme.md', 'achievements.md']);
    expect(result.profile.personal).toEqual({ fullName: 'Ada Ejemplo', summary: 'Resumen por defecto.', links: [] });
    expect(result.profile.experience[0]?.achievements[0]).toEqual({ id: 'exp-acme-1', text: 'Uno', tags: ['php'] });
    expect(result.profile.achievements[0]?.id).toBe('ach-1');
    expect(result.profile.meta).toEqual({ schemaVersion: 1 });
  });

  it('normaliza BOM y finales de línea Windows antes de parsear', async () => {
    const result = await load({ '/data/profile.md': '﻿---\r\nfullName: Ada\r\n---\r\n\r\nResumen.\r\n' });
    expect(result.ok && result.profile.personal).toEqual({ fullName: 'Ada', summary: 'Resumen.', links: [] });
  });

  it('acumula los errores de parseo de todos los ficheros, ordenados por fichero y línea', async () => {
    expect(
      await expectErrors(
        datasetTree({
          '/data/experience/acme.md': '---\ncompany: ACME\nrole: Dev\nstart: 2020-13\n---\n',
          '/data/achievements.md': '- Uno\n  - foo: x\n',
          '/data/education/uni.md': '---\ninstitution: U\n---\n',
        }),
      ),
    ).toEqual([
      'achievements.md:2: Logro 1: metadato «foo» no admitido (admitidos: impact, date, id)',
      'education/uni.md:1: degree: Entrada inválida: se esperaba texto, recibido indefinido',
      expect.stringMatching(/^experience\/acme\.md:4: start: Fecha inválida/),
    ]);
  });

  it('localiza los errores globales (ids duplicados) en el fichero y línea del duplicado', async () => {
    expect(
      await expectErrors(
        datasetTree({
          '/data/experience/acme.md': EXPERIENCE,
          '/data/projects/acme.md': '---\nid: exp-acme\nname: Acme\n---\n',
        }),
      ),
    ).toEqual(['projects/acme.md:2: projects[0].id: Identificador duplicado "exp-acme": ya se usa en experience[0].id']);
  });

  it('señala los ficheros sin parser y devuelve los errores de disposición', async () => {
    expect(await expectErrors(datasetTree({ '/data/skills.csv': 'name\nPHP\n' }))).toEqual([
      'skills.csv:-: No hay parser para la extensión «.csv»',
    ]);
    expect(await expectErrors(datasetTree({ '/data/notas.md': '' }))).toEqual([
      'notas.md:-: Fichero no reconocido en la raíz del dataset (admitidos: profile.md, achievements.md, skills.csv, certifications.csv)',
    ]);
  });

  it('devuelve los conflictos de fusión entre ficheros', async () => {
    const csv: SourceParser = {
      name: 'csv-fake',
      extensions: ['.csv'],
      parse: () => ({ ok: true, contribution: { personal: { fullName: 'Otra' } }, provenance: [] }),
    };
    expect(await expectErrors(datasetTree({ '/data/skills.csv': '' }), [markdown, csv])).toEqual([
      'skills.csv:-: personal.fullName: valor ya definido en profile.md con otro contenido',
    ]);
  });

  it('atribuye a la raíz los errores de validación sin procedencia', async () => {
    const empty: SourceParser = { name: 'empty', extensions: ['.md'], parse: () => ({ ok: true, contribution: {}, provenance: [] }) };
    expect(await expectErrors(datasetTree(), [empty])).toEqual([expect.stringMatching(/^\.:-: personal: /)]);
    const rogue: SourceParser = {
      name: 'rogue',
      extensions: ['.md'],
      parse: () => ({ ok: true, contribution: { personal: { fullName: 'Ada' }, extra: true } as ProfileContribution, provenance: [] }),
    };
    expect(await expectErrors(datasetTree(), [rogue])).toEqual([expect.stringMatching(/^\.:-: <raíz>: .*extra/)]);
  });
});

describe('utilidades', () => {
  it('normalizeText quita el BOM y unifica los finales de línea', () => {
    expect(normalizeText('﻿a\r\nb\rc\n')).toBe('a\nb\nc\n');
    expect(normalizeText('sin cambios')).toBe('sin cambios');
  });

  it('extensionOf devuelve la extensión con punto o vacío', () => {
    expect(extensionOf('experience/acme.md')).toBe('.md');
    expect(extensionOf('Makefile')).toBe('');
  });

  it('sortErrors ordena por fichero y luego por línea, con los errores sin línea al final', () => {
    expect(
      sortErrors([
        { file: 'b.md', line: 2, message: 'b2' },
        { file: 'a.md', message: 'a-' },
        { file: 'a.md', line: 5, message: 'a5' },
        { file: 'a.md', line: 1, message: 'a1' },
      ]).map((error) => error.message),
    ).toEqual(['a1', 'a5', 'a-', 'b2']);
    const messages = (errors: Parameters<typeof sortErrors>[0]) => sortErrors(errors).map((error) => error.message);
    expect(messages([{ file: 'a', message: 'x' }, { file: 'b', message: 'y' }])).toEqual(['x', 'y']);
    expect(messages([{ file: 'b', message: 'y' }, { file: 'a', message: 'x' }])).toEqual(['x', 'y']);
    expect(messages([{ file: 'a', line: 1, message: 'x' }, { file: 'a', message: 'y' }])).toEqual(['x', 'y']);
    expect(messages([{ file: 'a', message: 'y' }, { file: 'a', line: 1, message: 'x' }])).toEqual(['x', 'y']);
  });
});
