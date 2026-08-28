import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { createLocator, validateSection } from '../../../src/parsers/shared/section-validation';

describe('createLocator', () => {
  const locate = createLocator(new Map([['links', 6], ['links[0].url', 8]]), 1);

  it('devuelve la línea exacta, la del prefijo más largo o la de reserva', () => {
    expect(locate(['links', 0, 'url'])).toBe(8);
    expect(locate(['links', 0, 'label'])).toBe(6);
    expect(locate(['email'])).toBe(1);
    expect(locate([])).toBe(1);
  });
});

describe('validateSection', () => {
  const schema = z.strictObject({ name: z.string().min(1), nested: z.strictObject({ n: z.number() }).optional() });
  const locate = createLocator(new Map([['name', 2], ['nested', 3], ['nested.n', 4], ['extra', 5]]), 1);

  it('devuelve el valor validado', () => {
    expect(validateSection(schema, { name: 'x' }, { file: 'f.md', locate })).toEqual({ ok: true, value: { name: 'x' } });
  });

  it('traduce cada problema a fichero y línea, con una entrada por clave desconocida', () => {
    expect(validateSection(schema, { name: '', nested: { n: 'no', other: 1 }, extra: true }, { file: 'f.md', locate })).toEqual({
      ok: false,
      errors: [
        { file: 'f.md', line: 2, message: expect.stringMatching(/^name: /) },
        { file: 'f.md', line: 4, message: expect.stringMatching(/^nested\.n: /) },
        { file: 'f.md', line: 3, message: 'nested.other: clave no reconocida' },
        { file: 'f.md', line: 5, message: 'extra: clave no reconocida' },
      ],
    });
  });

  it('usa el prefijo en los mensajes y la localización, y omite la ruta cuando el problema es la raíz', () => {
    const prefixed = validateSection(z.array(z.string()), ['ok', 3], { file: 'f.md', locate: () => 9, prefix: ['tags'] });
    expect(prefixed).toEqual({ ok: false, errors: [{ file: 'f.md', line: 9, message: expect.stringMatching(/^tags\[1\]: /) }] });
    const root = validateSection(z.string(), 42, { file: 'f.md', locate: () => 1 });
    const zodMessage = z.string().safeParse(42).error?.issues[0]?.message;
    expect(zodMessage).toBeDefined();
    expect(root).toEqual({ ok: false, errors: [{ file: 'f.md', line: 1, message: zodMessage }] });
  });
});
