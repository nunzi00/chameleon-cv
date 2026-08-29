import { describe, expect, it } from 'vitest';

import { ApiError } from './api/client';
import { issuesOf } from './validation';

describe('issuesOf', () => {
  it('extrae los problemas bien formados de un 422 y nada de cualquier otro error', () => {
    const error = new ApiError(422, { code: 'invalid-data', message: '3 problemas', issues: [{ file: 'a.md', line: 3, message: 'falta company' }, { file: 'b.csv', message: 'cabecera' }, { mal: true }, 'texto'] });
    expect(issuesOf(error)).toEqual([
      { file: 'a.md', line: 3, message: 'falta company' },
      { file: 'b.csv', line: undefined, message: 'cabecera' },
    ]);
    expect(issuesOf(new ApiError(422, { code: 'invalid-data', message: 'sin issues' }))).toEqual([]);
    expect(issuesOf(new Error('otro'))).toEqual([]);
  });
});
