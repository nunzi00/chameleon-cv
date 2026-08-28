import { describe, expect, it } from 'vitest';

import { MasterProfileValidationError, parseMasterProfile, validateMasterProfile } from '../../../src/core/schema';
import { fullProfileInput, minimalProfileInput } from '../../fixtures/master-profile';

function captureError(action: () => unknown): unknown {
  try {
    action();
  } catch (error) {
    return error;
  }
  throw new Error('Se esperaba una excepción');
}

describe('validateMasterProfile', () => {
  it('devuelve ok con el perfil canónico', () => {
    const result = validateMasterProfile(minimalProfileInput());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.profile.personal.fullName).toBe('Ada Ejemplo');
    }
  });

  it('devuelve los problemas con su ruta formateada', () => {
    const result = validateMasterProfile({ personal: { fullName: 'Ada', links: [{ label: 'x', url: 'nope' }] } });
    expect(result).toEqual({
      ok: false,
      issues: [
        {
          path: 'personal.links[0].url',
          segments: ['personal', 'links', 0, 'url'],
          message: 'URL inválida: solo se admiten direcciones http(s)',
        },
      ],
    });
  });
});

describe('parseMasterProfile', () => {
  it('devuelve el perfil cuando es válido', () => {
    expect(parseMasterProfile(fullProfileInput()).personal.email).toBe('ada@example.com');
  });

  it('lanza MasterProfileValidationError señalando la raíz cuando la entrada no es un objeto', () => {
    const error = captureError(() => parseMasterProfile(null));
    expect(error).toBeInstanceOf(MasterProfileValidationError);
    if (error instanceof MasterProfileValidationError) {
      expect(error.name).toBe('MasterProfileValidationError');
      expect(error.issues).toHaveLength(1);
      expect(error.issues[0]?.path).toBe('');
      expect(error.message).toContain('1 problema(s)');
      expect(error.message).toContain('<raíz>');
    }
  });

  it('enumera en el mensaje todos los problemas con su ruta', () => {
    const error = captureError(() => parseMasterProfile({ personal: { fullName: '' }, meta: { schemaVersion: 3 } }));
    expect(error).toBeInstanceOf(MasterProfileValidationError);
    if (error instanceof MasterProfileValidationError) {
      expect(error.issues.map((issue) => issue.path).sort()).toEqual(['meta.schemaVersion', 'personal.fullName']);
      expect(error.message).toContain('2 problema(s)');
      expect(error.message).toContain('  - meta.schemaVersion: ');
      expect(error.message).toContain('  - personal.fullName: ');
    }
  });
});
