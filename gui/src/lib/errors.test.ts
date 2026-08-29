import { describe, expect, it } from 'vitest';

import { ApiError, NetworkError } from './api/client';
import { explainError } from './errors';

describe('explainError', () => {
  it('traduce los códigos conocidos, deja los desconocidos con su estado y explica la red y lo inesperado', () => {
    expect(explainError(new ApiError(401, { code: 'unauthorized', message: 'Falta el token' }))).toEqual({ kind: 'session', title: 'La sesión no es válida', detail: 'Falta el token', lines: [] });
    expect(explainError(new ApiError(409, { code: 'conflict', message: 'huella distinta' })).kind).toBe('conflict');
    expect(explainError(new ApiError(422, { code: 'invalid-data', message: '2 problemas', lines: ['a'] }))).toMatchObject({ kind: 'data', lines: ['a'] });
    expect(explainError(new ApiError(403, { code: 'remote-disabled', message: 'x' })).kind).toBe('forbidden');
    expect(explainError(new ApiError(418, { code: 'teapot', message: 'soy una tetera' }))).toEqual({ kind: 'other', title: 'Error 418', detail: 'soy una tetera', lines: [] });
    expect(explainError(new NetworkError(new Error('ECONNREFUSED')))).toMatchObject({ kind: 'network', title: 'Sin conexión con cv serve' });
    expect(explainError(new Error('boom'))).toEqual({ kind: 'other', title: 'Error inesperado', detail: 'boom', lines: [] });
    expect(explainError('cadena')).toMatchObject({ detail: 'cadena' });
  });
});
