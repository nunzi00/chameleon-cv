import { describe, expect, it } from 'vitest';

import { ApiError } from '../api/client';
import type { ThemeInstallResponse } from '../api/types';
import { describeInstalled, installProblem, themeOptionLabel } from './install';

const apiError = (status: number, code: string, message: string, extra: Record<string, unknown> = {}): ApiError => new ApiError(status, { code, message, ...extra });

const PLAN: ThemeInstallResponse['plan'] = {
  name: 'comunidad',
  directory: '/work/themes/comunidad',
  kind: 'archive',
  source: '/work/themes/comunidad.zip',
  archiveSha256: 'bfbc3701c2d7c867d37baf107197d39efdb0845e7211564fdd9820244fe7092e',
  files: [{ path: 'theme.toml', bytes: 10, sha256: 'a'.repeat(64) }],
  totalBytes: 10,
  config: { theme: { name: 'comunidad', version: 1 } } as unknown as ThemeInstallResponse['plan']['config'],
  replaces: undefined,
  shadowed: false,
};

describe('installProblem', () => {
  it('reconoce el 403 sin --allow-remote y el 409 con el consentimiento pendiente; lo demás no es suyo', () => {
    expect(installProblem(new Error('otra'))).toBeUndefined();
    expect(installProblem(apiError(422, 'invalid-data', 'datos'))).toBeUndefined();
    expect(installProblem(apiError(403, 'remote-disabled', 'sin remotos'))).toEqual({ kind: 'remote-disabled', message: 'sin remotos' });
    expect(installProblem(apiError(409, 'consent-required', 'confirma', { estimateId: 'e1', source: 'https://cdn.example/t.zip', host: 'cdn.example', limitBytes: 8 * 1024 * 1024 }))).toEqual({
      kind: 'consent-required',
      message: 'confirma',
      estimateId: 'e1',
      source: 'https://cdn.example/t.zip',
      host: 'cdn.example',
      limit: '8 MiB',
    });
    expect(installProblem(apiError(409, 'consent-required', 'confirma', { estimateId: 'e2' }))).toEqual({ kind: 'consent-required', message: 'confirma', estimateId: 'e2', source: '', host: '', limit: 'límite del servidor' });
    expect(installProblem(apiError(409, 'consent-required', 'sin id'))).toBeUndefined();
  });
});

describe('describeInstalled y themeOptionLabel', () => {
  it('resume el plan o la instalación con la huella, la copia .bak y el reemplazo', () => {
    expect(describeInstalled({ plan: PLAN, written: false, backup: undefined })).toBe('Plan: «comunidad» se instalaría en /work/themes/comunidad (1 fichero, SHA-256 bfbc3701c2d7c867…). Nada escrito.');
    expect(describeInstalled({ plan: { ...PLAN, replaces: '/work/themes/comunidad', files: [...PLAN.files, ...PLAN.files] }, written: false, backup: undefined })).toContain('(2 ficheros, SHA-256 bfbc3701c2d7c867…); reemplazaría el tema existente. Nada escrito.');
    expect(describeInstalled({ plan: PLAN, written: true, backup: undefined })).toBe('Tema «comunidad» instalado en /work/themes/comunidad (1 fichero, SHA-256 bfbc3701c2d7c867…).');
    expect(describeInstalled({ plan: PLAN, written: true, backup: '/work/themes/comunidad.20260830-100000.bak' })).toContain('; el anterior se apartó a /work/themes/comunidad.20260830-100000.bak.');
  });

  it('etiqueta cada tema con su autoría y marca los instalados', () => {
    const base = { name: 'mio', directory: '/work/themes/mio', builtin: false, shadows: false, description: undefined, author: undefined, license: undefined, homepage: undefined, error: undefined };
    expect(themeOptionLabel(base)).toBe('mio');
    expect(themeOptionLabel({ ...base, author: 'Ada' })).toBe('mio — Ada');
    expect(themeOptionLabel({ ...base, author: 'Ada', origin: { source: 'https://cdn.example/t.zip', kind: 'url', installedAt: '2026-08-30T10:00:00.000Z' } })).toBe('mio — Ada (instalado)');
  });
});
