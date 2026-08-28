import { describe, expect, it } from 'vitest';

import { PLACEHOLDERS, createRedaction, nameParts } from '../../src/core/llm';

describe('createRedaction (canon C4)', () => {
  it('sustituye el nombre completo y sus partes, emails, teléfonos y URLs, y lo deshace', () => {
    const redaction = createRedaction({ fullName: 'Ada María de la Vega' });
    const text = 'ADA MARÍA DE LA VEGA (ada@example.com, +34 600 000 000, https://github.com/ada) lideró a Vega y a la vega del río; contacto: www.ejemplo.com.';
    const redacted = redaction.redact(text);
    // El nombre completo se reconoce en cualquier grafía; sus partes solo como nombre propio («Vega», no «vega»).
    expect(redacted).toBe('[NOMBRE] ([EMAIL-1], [TELÉFONO-1], [URL-1]) lideró a [NOMBRE] y a la vega del río; contacto: [URL-2].');
    // Las partes del nombre comparten marcador: al deshacerlo, cada [NOMBRE] vuelve como el nombre completo.
    expect(redaction.restore('[NOMBRE] ([EMAIL-1], [TELÉFONO-1], [URL-1]); contacto: [URL-2].')).toBe('Ada María de la Vega (ada@example.com, +34 600 000 000, https://github.com/ada); contacto: www.ejemplo.com.');
    expect(redaction.restore('a [NOMBRE] del río')).toBe('a Ada María de la Vega del río');
    expect([...redaction.table.entries()]).toEqual([
      ['[NOMBRE]', 'Ada María de la Vega'],
      ['[EMAIL-1]', 'ada@example.com'],
      ['[URL-1]', 'https://github.com/ada'],
      ['[URL-2]', 'www.ejemplo.com'],
      ['[TELÉFONO-1]', '+34 600 000 000'],
    ]);
    expect(nameParts('Ada María de la Vega')).toEqual(['Ada', 'María', 'Vega']);
    expect(PLACEHOLDERS.name).toBe('[NOMBRE]');
  });

  it('seudonimiza empresas solo si se pide, reutiliza marcadores para valores repetidos y no toca subcadenas', () => {
    const redaction = createRedaction({ fullName: 'Lu Chen', companies: ['ACME Corp', 'Startup Ejemplo'] });
    const text = 'En ACME Corp y ACME Corp (no en ACMECorp) trabajé con Lu Chen; Luis, Chen Xu y Chenoa no; ada@example.com y ada@example.com.';
    const redacted = redaction.redact(text);
    expect(redacted).toBe('En [EMPRESA-1] y [EMPRESA-1] (no en ACMECorp) trabajé con [NOMBRE]; Luis, [NOMBRE] Xu y Chenoa no; [EMAIL-1] y [EMAIL-1].');
    expect(redaction.table.get('[EMPRESA-2]')).toBe('Startup Ejemplo');
    expect(redaction.restore('[EMPRESA-1] y [EMPRESA-2] con [NOMBRE] ([EMAIL-1])')).toBe('ACME Corp y Startup Ejemplo con Lu Chen (ada@example.com)');
    // «Lu» tiene dos letras: no se sustituye suelto (evita falsos positivos).
    expect(redaction.redact('Lu es corto')).toBe('Lu es corto');
    // Las empresas se reconocen con su grafía exacta: «acme corp» en minúsculas no es la empresa.
    expect(redaction.redact('acme corp no; ACME Corp sí')).toBe('acme corp no; [EMPRESA-1] sí');
    // Hallazgo del spike de T-4.2: un apellido que es palabra común no debe corromper el texto.
    const ada = createRedaction({ fullName: 'Ada Ejemplo' });
    expect(ada.redact('Mentora de 5 personas en un programa de ejemplo con Ejemplo y Ada.')).toBe('Mentora de 5 personas en un programa de ejemplo con [NOMBRE] y [NOMBRE].');
  });

  it('con un nombre vacío no crea marcador de nombre y el teléfono exige nueve dígitos o más', () => {
    const redaction = createRedaction({ fullName: '  ' });
    expect(redaction.redact('Tel. 91 234 56 78 y 600 000 000 y año 2024')).toBe('Tel. [TELÉFONO-1] y [TELÉFONO-2] y año 2024');
    expect(redaction.table.has('[NOMBRE]')).toBe(false);
    expect(redaction.redact('Reduje la latencia p95 un 40 % en 2023.')).toBe('Reduje la latencia p95 un 40 % en 2023.');
  });
});
