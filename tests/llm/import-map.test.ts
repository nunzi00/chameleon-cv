/** Tarea `import map` (T-8.4b F2): seudonimización, vocabulario cerrado y verificación por código de cada propuesta. */
import { describe, expect, it } from 'vitest';

import {
  IMPORT_MAP_LIMITS,
  IMPORT_MAP_PROMPT_VERSION,
  IMPORT_SECTIONS,
  importMapFragment,
  importMapJsonSchema,
  importMapMessages,
  interpretImportMap,
  loadImportMapPrompt,
  runImportMap,
  type ImportMapLine,
} from '../../src/llm/tasks/import-map';
import type { LlmCompletion, LlmProvider } from '../../src/llm/provider';

const LINES: readonly ImportMapLine[] = [
  { n: 31, text: 'C A M P U S  I N V O L V M E N T' },
  { n: 32, text: 'Finance Chair, Green Club, Ada Ejemplo | sept 2018 – actualidad' },
];

const completion = (json: unknown): LlmCompletion => ({ ok: true, json, raw: JSON.stringify(json), model: 'fake', usage: {}, elapsedMs: 4 });

describe('import map · fragmento', () => {
  it('seudonimiza el nombre, recorta el texto y limita el número de líneas', () => {
    const fragment = importMapFragment(LINES, { fullName: 'Ada Ejemplo', locale: 'en' })!;
    expect(fragment.input.locale).toBe('en');
    expect(fragment.input.lines[1]!.text).toContain('[NOMBRE]');
    expect(fragment.input.lines[1]!.text).not.toContain('Ada Ejemplo');
    const many = Array.from({ length: IMPORT_MAP_LIMITS.maxLines + 5 }, (_, index) => ({ n: index + 1, text: 'x'.repeat(IMPORT_MAP_LIMITS.maxText + 20) }));
    const capped = importMapFragment(many)!;
    expect(capped.input.lines).toHaveLength(IMPORT_MAP_LIMITS.maxLines);
    expect(capped.input.lines[0]!.text).toHaveLength(IMPORT_MAP_LIMITS.maxText);
    expect(capped.input.locale).toBe('es');
  });

  it('sin líneas con texto no hay fragmento que enviar', () => {
    expect(importMapFragment([])).toBeUndefined();
    expect(importMapFragment([{ n: 1, text: '   ' }])).toBeUndefined();
  });

  it('el esquema del proveedor restringe la sección al vocabulario cerrado', () => {
    const schema = importMapJsonSchema() as { properties: { proposals: { items: { properties: { section: { enum: string[] } } } } } };
    expect(schema.properties.proposals.items.properties.section.enum).toEqual([...IMPORT_SECTIONS]);
  });

  it('el mensaje lleva el prompt de sistema y el fragmento como JSON', () => {
    const fragment = importMapFragment(LINES)!;
    expect(importMapMessages(fragment, 'PROMPT')).toEqual([
      { role: 'system', content: 'PROMPT' },
      { role: 'user', content: JSON.stringify(fragment.input) },
    ]);
  });

  it('el prompt versionado se lee de los assets', async () => {
    await expect(loadImportMapPrompt()).resolves.toContain('Vocabulario cerrado');
  });
});

describe('import map · verificación por código (C2)', () => {
  it('acepta las propuestas del vocabulario, deshace los seudónimos y adjunta la línea original', () => {
    const fragment = importMapFragment(LINES, { fullName: 'Ada Ejemplo' })!;
    const result = interpretImportMap(fragment, LINES, completion({ proposals: [{ n: 32, section: 'Experiencia', reason: 'El puesto de [NOMBRE] con fechas' }] }));
    expect(result).toMatchObject({ ok: true, rejected: 0, promptVersion: IMPORT_MAP_PROMPT_VERSION });
    expect(result.ok && result.proposals).toEqual([{ n: 32, section: 'experiencia', reason: 'El puesto de Ada Ejemplo con fechas', text: LINES[1]!.text }]);
  });

  it('rechaza secciones inventadas, líneas que no se enviaron y repeticiones', () => {
    const fragment = importMapFragment(LINES)!;
    const result = interpretImportMap(
      fragment,
      LINES,
      completion({
        proposals: [
          { n: 31, section: 'descartar', reason: 'cabecera' },
          { n: 31, section: 'experiencia', reason: 'repetida' },
          { n: 99, section: 'experiencia', reason: 'no se envió' },
          { n: 32, section: 'aficiones', reason: 'sección inventada' },
        ],
      }),
    );
    expect(result.ok && result.proposals.map((proposal) => proposal.n)).toEqual([31]);
    expect(result.ok && result.rejected).toBe(3);
  });

  it('una respuesta que no cumple el esquema o un error del proveedor se propagan con su código', () => {
    const fragment = importMapFragment(LINES)!;
    expect(interpretImportMap(fragment, LINES, completion({ proposals: [{ n: 'x', section: 'experiencia', reason: '' }] }))).toMatchObject({ ok: false, code: 'invalid-output' });
    expect(interpretImportMap(fragment, LINES, { ok: false, code: 'timeout', message: 'tardó' })).toEqual({ ok: false, code: 'timeout', message: 'tardó' });
  });
});

describe('import map · envío', () => {
  it('pide al proveedor el esquema y respeta el suelo de tokens de los modelos que razonan', async () => {
    const fragment = importMapFragment(LINES)!;
    let asked: { maxTokens?: number; schemaName?: string } = {};
    const provider: LlmProvider = {
      id: 'ollama',
      kind: 'local',
      baseUrl: 'http://x',
      model: 'm',
      outputTokensFloor: 4000,
      complete: (request) => {
        asked = { maxTokens: request.maxTokens, schemaName: request.schemaName };
        return Promise.resolve(completion({ proposals: [{ n: 31, section: 'descartar', reason: 'cabecera' }] }));
      },
      health: () => Promise.resolve({ ok: true, version: undefined, models: ['m'], modelAvailable: true }),
    };
    const result = await runImportMap(provider, fragment, LINES, 'PROMPT');
    expect(asked).toEqual({ maxTokens: 4000, schemaName: 'import-map' });
    expect(result.ok && result.proposals[0]!.section).toBe('descartar');
  });
});
