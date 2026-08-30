import { describe, expect, it } from 'vitest';

import type { ImportResponse } from './api/types';
import { describeCounts, describeImport, parseProfileText, planLines, profileFileName, serializeForDownload } from './portability';

const RESPONSE: ImportResponse = {
  root: '/work/data/sources',
  dryRun: true,
  plan: {
    files: [
      { path: 'profile.md', bytes: 39 },
      { path: 'experience/acme.md', bytes: 120 },
    ],
    counts: { specialties: 1, experience: 2, projects: 0, education: 1, achievements: 0, skills: 3, certifications: 1 },
    warnings: ['El orden de experience pasa a ser el de sus ficheros: exp-acme, exp-zeta'],
  },
  written: [],
};

describe('portabilidad en la GUI', () => {
  it('lee el JSON elegido (con o sin BOM) y rechaza lo que no es un objeto', () => {
    expect(parseProfileText('{"personal":{"fullName":"Ada"}}')).toEqual({ ok: true, value: { personal: { fullName: 'Ada' } } });
    expect(parseProfileText('﻿{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
    expect(parseProfileText('{')).toMatchObject({ ok: false, message: expect.stringMatching(/^El fichero no es JSON válido: /) as string });
    expect(parseProfileText('[1]')).toEqual({ ok: false, message: 'El fichero no contiene un objeto JSON: se esperaba el perfil canónico (profile.json)' });
    expect(parseProfileText('null').ok).toBe(false);
    expect(parseProfileText('"texto"').ok).toBe(false);
  });

  it('serializa como cv export y nombra la descarga con la fecha local', () => {
    expect(serializeForDownload({ a: [1, { b: 'c' }] })).toBe('{\n  "a": [\n    1,\n    {\n      "b": "c"\n    }\n  ]\n}\n');
    expect(profileFileName(new Date(2026, 7, 30, 23, 59))).toBe('perfil-2026-08-30.json');
    expect(profileFileName(new Date(2027, 0, 5))).toBe('perfil-2027-01-05.json');
  });

  it('describe el plan, los conteos y el resultado', () => {
    expect(describeCounts(RESPONSE.plan.counts)).toBe('1 especialidad, 2 experiencias, 0 proyectos, 1 formación, 3 skills, 1 certificación, 0 logros transversales');
    expect(planLines(RESPONSE)).toEqual([
      '2 ficheros en /work/data/sources (1 especialidad, 2 experiencias, 0 proyectos, 1 formación, 3 skills, 1 certificación, 0 logros transversales)',
      'profile.md (39 bytes)',
      'experience/acme.md (120 bytes)',
      'Aviso: El orden de experience pasa a ser el de sus ficheros: exp-acme, exp-zeta',
      'Auto-chequeo superado: las fuentes regeneradas reproducen el perfil.',
    ]);
    expect(describeImport({ ...RESPONSE, dryRun: false, written: ['profile.md'] })).toBe('Perfil importado en /work/data/sources: 1 fichero · compila para regenerar el artefacto');
    expect(describeImport({ ...RESPONSE, dryRun: false, written: ['a', 'b'], backup: '/work/data/sources.20260830-120000.bak' })).toBe(
      'Perfil importado en /work/data/sources: 2 ficheros · las fuentes anteriores quedan en /work/data/sources.20260830-120000.bak · compila para regenerar el artefacto',
    );
  });
});
