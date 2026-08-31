import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/client';
import { launchProblem } from './consent';

describe('launchProblem', () => {
  it('reconoce el 403 sin --allow-remote y el 409 con estimación; el resto no es un problema de consentimiento', () => {
    expect(launchProblem(new ApiError(403, { code: 'remote-disabled', message: 'arráncalo con --allow-remote' }))).toEqual({ kind: 'remote-disabled', message: 'arráncalo con --allow-remote' });
    expect(launchProblem(new ApiError(409, { code: 'consent-required', message: 'confirma', estimateId: 'e-1', warning: 'Coste estimado…', estimate: { requests: 2, inputTokens: 800, maxOutputTokens: 1200, note: 'x', other: 5 } }))).toEqual({ kind: 'consent-required', message: 'confirma', estimateId: 'e-1', warning: 'Coste estimado…', estimate: ['peticiones: 2', 'tokens de entrada (aprox.): 800', 'tokens de salida (máximo): 1200', 'other: 5'], dataNote: '' });
    expect(launchProblem(new ApiError(409, { code: 'consent-required', message: 'x', estimateId: 'e-2', dataNote: 'Gemini free usa tus peticiones' }))).toMatchObject({ dataNote: 'Gemini free usa tus peticiones' });
    expect(launchProblem(new ApiError(409, { code: 'consent-required', message: 'sin id' }))).toBeUndefined();
    expect(launchProblem(new ApiError(409, { code: 'consent-required', message: 'x', estimateId: 'e', estimate: 'raro' }))).toMatchObject({ warning: '', estimate: [] });
    expect(launchProblem(new ApiError(503, { code: 'environment', message: 'sin proveedor' }))).toBeUndefined();
    expect(launchProblem(new Error('otro'))).toBeUndefined();
  });
});
