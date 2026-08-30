import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import type { StatusResponse } from '../lib/api/types';
import ContextHeader from './ContextHeader.svelte';

const STATUS = {
  version: '1.7.0',
  workspace: '/home/ana/cv',
  artifact: { status: 'stale', detail: 'cambió profile.md', specialties: [] },
  typst: { required: '0.15.1', candidates: [], selected: '/opt/typst', usable: true },
  llm: { config: undefined, configError: undefined, health: undefined, keys: {}, keysFile: '', allowedHosts: [], remote: undefined, usable: false, settings: { path: undefined, present: false, configured: false, error: undefined }, providers: [] },
  themes: { defaultName: 'default', configWarning: undefined, roots: [], entries: [] },
} as unknown as StatusResponse;

describe('ContextHeader', () => {
  it('sin contexto muestra un esqueleto y ningún chip', () => {
    render(ContextHeader, { props: { context: undefined, theme: 'system', onthemechange: () => undefined, onshutdown: () => undefined } });
    expect(screen.getByText('Cargando el espacio de trabajo…')).toBeTruthy();
    expect(screen.getByRole('status').textContent).toBe('');
  });

  it('con contexto: nombre y ruta del espacio, cuatro chips con su tono y el tema marcado', () => {
    render(ContextHeader, { props: { context: { status: STATUS, remoteAllowed: false, reviews: 0 }, theme: 'dark', onthemechange: () => undefined, onshutdown: () => undefined } });
    expect(screen.getByText('cv')).toBeTruthy();
    expect(screen.getByText('/home/ana/cv')).toBeTruthy();
    const chips = [...screen.getByRole('status').querySelectorAll('.cv-chip')];
    expect(chips.map((chip) => [chip.textContent, chip.className])).toEqual([
      ['Artefacto obsoleto', 'cv-chip warn'],
      ['Typst 0.15.1', 'cv-chip ok'],
      ['Co-piloto sin proveedor', 'cv-chip warn'],
      ['Remotos: no permitidos', 'cv-chip quiet'],
    ]);
    expect(chips[0]?.getAttribute('title')).toBe('cambió profile.md');
    expect(screen.getByRole('button', { name: 'Oscuro' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Claro' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('el conmutador de tema avisa con el modo elegido', async () => {
    const onthemechange = vi.fn();
    render(ContextHeader, { props: { context: undefined, theme: 'system', onthemechange, onshutdown: () => undefined } });
    await fireEvent.click(screen.getByRole('button', { name: 'Claro' }));
    expect(onthemechange).toHaveBeenCalledWith('light');
  });

  it('apagar pide confirmación: cancelar no avisa, confirmar sí', async () => {
    const onshutdown = vi.fn();
    render(ContextHeader, { props: { context: undefined, theme: 'system', onthemechange: () => undefined, onshutdown } });
    expect(screen.queryByRole('dialog')).toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar cv serve' }));
    expect(screen.getByRole('dialog')).toBeTruthy();
    await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(onshutdown).not.toHaveBeenCalled();
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar cv serve' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    expect(onshutdown).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Esc cierra la confirmación', async () => {
    render(ContextHeader, { props: { context: undefined, theme: 'system', onthemechange: () => undefined, onshutdown: () => undefined } });
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar cv serve' }));
    await fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
