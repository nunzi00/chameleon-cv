import { describe, expect, it } from 'vitest';

import type { StatusResponse } from './api/types';
import { describeStatus } from './status';

function status(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return {
    version: '1.2.0',
    workspace: '/home/ada/cv',
    artifact: { status: 'fresh', detail: undefined, specialties: ['backend', 'nube'] },
    typst: { required: '0.15.1', candidates: [], selected: undefined, usable: true },
    llm: { config: undefined, configError: undefined, health: undefined, keys: {} as StatusResponse['llm']['keys'], keysFile: '', allowedHosts: [], remote: undefined, usable: false, settings: { path: undefined, present: false, configured: false, error: undefined } },
    themes: { defaultName: 'default', configWarning: undefined, roots: [], entries: [] },
    ...overrides,
  };
}

describe('describeStatus', () => {
  it('traduce cada estado del artefacto, Typst, el proveedor y los temas a indicadores', () => {
    const fresh = describeStatus(status());
    expect(fresh).toMatchObject({ version: '1.2.0', artifact: { tone: 'ok', label: 'al día' }, specialties: ['backend', 'nube'], typst: { tone: 'ok', label: 'utilizable (0.15.1)' }, llm: { tone: 'warn', label: 'sin proveedor local utilizable', detail: undefined }, themes: { defaultName: 'default', count: 0, warning: undefined } });
    expect(describeStatus(status({ artifact: { status: 'stale', detail: 'experience/acme.md', specialties: [] } })).artifact).toEqual({ tone: 'warn', label: 'obsoleto: compila para actualizarlo', detail: 'experience/acme.md' });
    expect(describeStatus(status({ artifact: { status: 'missing', detail: undefined, specialties: [] } })).artifact.tone).toBe('warn');
    expect(describeStatus(status({ artifact: { status: 'invalid', detail: 'roto', specialties: [] } })).artifact).toMatchObject({ tone: 'error', detail: 'roto' });
    expect(describeStatus(status({ artifact: { status: 'unknown', detail: 'EACCES', specialties: [] } })).artifact.label).toBe('estado desconocido');
    expect(describeStatus(status({ typst: { required: '0.15.1', candidates: [], selected: undefined, usable: false } })).typst).toMatchObject({ tone: 'warn', label: 'no disponible (se requiere 0.15.1; cv typst install)' });
    const base = status();
    expect(describeStatus(status({ llm: { ...base.llm, usable: true, settings: { path: undefined, present: false, configured: false, error: undefined } } })).llm).toMatchObject({ tone: 'ok', label: 'proveedor local listo' });
    expect(describeStatus(status({ llm: { ...base.llm, configError: 'CHAMELEON_LLM_PROVIDER inválido' } })).llm.detail).toBe('CHAMELEON_LLM_PROVIDER inválido');
    expect(describeStatus(status({ llm: { ...base.llm, health: { ok: false, code: 'unreachable', message: 'Ollama no responde' } } })).llm.detail).toBe('Ollama no responde');
    expect(describeStatus(status({ llm: { ...base.llm, health: { ok: true, version: undefined, models: ['m'], modelAvailable: true } } })).llm.detail).toBeUndefined();
    expect(describeStatus(status({ themes: { defaultName: 'classic', configWarning: 'cv.toml raro', roots: ['/x'], entries: [{} as StatusResponse['themes']['entries'][number]] } })).themes).toEqual({ defaultName: 'classic', count: 1, warning: 'cv.toml raro' });
  });
});
