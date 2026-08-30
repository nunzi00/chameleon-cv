import { describe, expect, it } from 'vitest';

import type { StatusResponse } from './api/types';
import { describeChips, workspaceName } from './context';

const STATUS = {
  version: '1.7.0',
  workspace: '/home/ana/cv',
  artifact: { status: 'fresh', detail: undefined, specialties: ['backend'] },
  typst: { required: '0.15.1', candidates: [], selected: { path: '/opt/typst' }, usable: true },
  llm: {
    config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', sources: { provider: 'default', baseUrl: 'default', model: 'default' } },
    configError: undefined,
    health: { ok: true, message: 'responde' },
    keys: {} as StatusResponse['llm']['keys'],
    keysFile: '',
    allowedHosts: [],
    remote: undefined,
    usable: true,
    settings: { path: undefined, present: false, configured: false, error: undefined },
    providers: [],
  },
  themes: { defaultName: 'default', configWarning: undefined, roots: [], entries: [] },
} as unknown as StatusResponse;

describe('describeChips', () => {
  it('con todo en orden: cuatro chips en verde y los remotos permitidos', () => {
    const chips = describeChips({ status: STATUS, remoteAllowed: true, reviews: 0 });
    expect(chips.map((chip) => [chip.id, chip.tone, chip.label])).toEqual([
      ['artifact', 'ok', 'Artefacto al día'],
      ['typst', 'ok', 'Typst 0.15.1'],
      ['copilot', 'ok', 'Co-piloto: ollama · qwen2.5:7b'],
      ['remote', 'quiet', 'Remotos: permitidos'],
    ]);
    expect(chips[1]?.title).toBe('/opt/typst');
    expect(chips[3]?.title).toContain('--allow-remote');
  });

  it('artefacto obsoleto, sin Typst, co-piloto caído y remotos no permitidos', () => {
    const status: StatusResponse = {
      ...STATUS,
      artifact: { status: 'stale', detail: 'cambió data/sources/profile.md', specialties: [] },
      typst: { required: '0.15.1', candidates: [], selected: undefined, usable: false },
      llm: { ...STATUS.llm, usable: false, health: { ok: false, code: 'unreachable', message: 'no responde en :11434' } as unknown as StatusResponse['llm']['health'] },
    };
    const chips = describeChips({ status, remoteAllowed: false, reviews: 2 });
    expect(chips.map((chip) => [chip.tone, chip.label])).toEqual([
      ['warn', 'Artefacto obsoleto'],
      ['warn', 'Typst no disponible'],
      ['warn', 'Co-piloto sin proveedor'],
      ['quiet', 'Remotos: no permitidos'],
    ]);
    expect(chips[0]?.title).toBe('cambió data/sources/profile.md');
    expect(chips[1]?.title).toBe('Se requiere Typst 0.15.1');
    expect(chips[2]?.title).toBe('no responde en :11434');
  });

  it('cada estado del artefacto tiene su etiqueta y el co-piloto utilizable exige configuración', () => {
    const labels = (['missing', 'invalid', 'unknown'] as const).map(
      (state) => describeChips({ status: { ...STATUS, artifact: { ...STATUS.artifact, status: state } }, remoteAllowed: false, reviews: 0 })[0],
    );
    expect(labels.map((chip) => [chip?.tone, chip?.label])).toEqual([
      ['warn', 'Sin artefacto'],
      ['error', 'Artefacto inválido'],
      ['warn', 'Artefacto: estado desconocido'],
    ]);
    const noConfig = describeChips({ status: { ...STATUS, llm: { ...STATUS.llm, config: undefined } }, remoteAllowed: false, reviews: 0 });
    expect(noConfig[2]?.label).toBe('Co-piloto sin proveedor');
    const noPath = describeChips({ status: { ...STATUS, typst: { ...STATUS.typst, selected: undefined } }, remoteAllowed: false, reviews: 0 });
    expect(noPath[1]?.title).toBeUndefined();
  });
});

describe('workspaceName', () => {
  it('devuelve el último tramo de rutas POSIX y Windows, y la ruta misma si no hay tramos', () => {
    expect(workspaceName('/home/ana/cv')).toBe('cv');
    expect(workspaceName('/home/ana/cv/')).toBe('cv');
    expect(workspaceName('C:\\Users\\ana\\cv')).toBe('cv');
    expect(workspaceName('/')).toBe('/');
  });
});
