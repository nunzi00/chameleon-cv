/** Los problemas de las fuentes que /validate y /build devuelven en un 422 (`issues`), listos para la pantalla. */
import { ApiError } from './api/client';
import type { DatasetIssue } from './api/types';

export interface Issue {
  readonly file: string;
  readonly line: number | undefined;
  readonly message: string;
}

function isIssue(value: unknown): value is DatasetIssue {
  return typeof value === 'object' && value !== null && 'file' in value && typeof value.file === 'string' && 'message' in value && typeof value.message === 'string';
}

export function issuesOf(error: unknown): readonly Issue[] {
  if (!(error instanceof ApiError) || !Array.isArray(error.details['issues'])) {
    return [];
  }
  return error.details['issues'].filter(isIssue).map((issue) => ({ file: issue.file, line: typeof issue.line === 'number' ? issue.line : undefined, message: issue.message }));
}
