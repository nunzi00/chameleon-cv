import { describe, expect, it } from 'vitest';

import type { StatusResponse } from './api/types';
import { describeStatus } from './status';

function status(overrides: Partial<StatusResponse> = {}): StatusResponse {
  return {
    version: '1.2.0',
    workspace: '/home/ada/cv',
    artifact: { status: 'fresh', detail: undefined, specialties: ['backend', 'nube'] },
    typst: { required: '0.15.1', candidates: [], selected: undefined, usable: true },
    llm: { config: undefined, configError: undefined, health: undefined, keys: {} as StatusResponse['llm']['keys'], keysFile: '', allowedHosts: [], remote: undefined, usable: false, settings: { path: undefined, present: false, configured: false, error: undefined }, providers: [] },
    themes: { defaultName: 'default', configWarning: undefined, roots: [], entries: [] },
    ...overrides,
  };
}

describe('describeStatus · detalle de Typst, co-piloto y temas (T-8.6 S2)', () => {
  it('expone ruta y versión de Typst, proveedor/URL/modelo del co-piloto y una fila por tema con su origen y estado', () => {
    const entry = (overrides: Partial<StatusResponse['themes']['entries'][number]>): StatusResponse['themes']['entries'][number] =>
      ({ name: 't', directory: '/w/themes/t', builtin: false, shadows: false, description: undefined, author: undefined, license: undefined, homepage: undefined, error: undefined, ...overrides }) as StatusResponse['themes']['entries'][number];
    const view = describeStatus(
      status({
        typst: { required: '0.15.1', candidates: [], selected: { source: 'env', path: '/opt/typst', state: 'ok', version: '0.15.1' } as StatusResponse['typst']['selected'], usable: true },
        llm: { ...status().llm, config: { provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b', context: 16384, sources: { provider: 'default', baseUrl: 'default', model: 'default', context: 'default' } } },
        themes: {
          defaultName: 'default',
          configWarning: undefined,
          roots: [],
          entries: [
            entry({ name: 'default', builtin: true }),
            entry({ name: 'mio' }),
            entry({ name: 'nord', origin: { source: 'https://x/nord.zip', kind: 'url', installedAt: '2026-08-30T00:00:00.000Z', verified: 'intact' } }),
            entry({ name: 'roto', origin: { source: '/a.zip', kind: 'archive', installedAt: '', verified: 'modified' } }),
            entry({ name: 'malo', origin: { source: '/d', kind: 'directory', installedAt: '' }, error: 'falta template.typ' }),
            entry({ name: 'default2', shadows: true }),
          ],
        },
      }),
    );
    expect(view.typst).toMatchObject({ path: '/opt/typst', version: '0.15.1' });
    expect(view.llm).toMatchObject({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'qwen2.5:7b' });
    expect(view.themes.rows.map((row) => [row.name, row.origin, row.state.tone, row.state.label])).toEqual([
      ['default', 'integrado', 'ok', 'intacto'],
      ['mio', 'proyecto', 'ok', 'intacto'],
      ['nord', 'instalado desde URL', 'ok', 'intacto'],
      ['roto', 'instalado desde archivo', 'warn', 'modificado'],
      ['malo', 'instalado desde directorio', 'error', 'inválido'],
      ['default2', 'proyecto', 'ok', 'intacto · oculta al integrado'],
    ]);
    expect(view.themes.rows[4]?.state.detail).toBe('falta template.typ');
    expect(describeStatus(status()).typst.path).toBeUndefined();
    expect(describeStatus(status()).llm.provider).toBeUndefined();
  });
});

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
    expect(describeStatus(status({ llm: { ...base.llm, usable: true, settings: { path: undefined, present: false, configured: false, error: undefined }, providers: [] } })).llm).toMatchObject({ tone: 'ok', label: 'proveedor local listo' });
    expect(describeStatus(status({ llm: { ...base.llm, configError: 'CHAMELEON_LLM_PROVIDER inválido' } })).llm.detail).toBe('CHAMELEON_LLM_PROVIDER inválido');
    expect(describeStatus(status({ llm: { ...base.llm, health: { ok: false, code: 'unreachable', message: 'Ollama no responde' } } })).llm.detail).toBe('Ollama no responde');
    expect(describeStatus(status({ llm: { ...base.llm, health: { ok: true, version: undefined, models: ['m'], modelAvailable: true } } })).llm.detail).toBeUndefined();
    expect(describeStatus(status({ themes: { defaultName: 'classic', configWarning: 'cv.toml raro', roots: ['/x'], entries: [{ name: 'x', builtin: true } as StatusResponse['themes']['entries'][number]] } })).themes).toMatchObject({ defaultName: 'classic', count: 1, warning: 'cv.toml raro', rows: [{ name: 'x', origin: 'integrado' }] });
  });
});
