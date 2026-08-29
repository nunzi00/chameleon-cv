import { render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it } from 'vitest';

import App from './App.svelte';
import { TOKEN_KEY } from './lib/session';

const STATUS = { version: '1.2.0', workspace: '/work', artifact: { status: 'fresh', detail: undefined, specialties: [] }, typst: { required: '0.15.1', candidates: [], selected: undefined, usable: false }, llm: { config: undefined, configError: undefined, health: undefined, keys: {}, keysFile: '', allowedHosts: [], remote: undefined, usable: false }, themes: { defaultName: 'default', configWarning: undefined, roots: [], entries: [] } };

const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = (init?.headers as Record<string, string> | undefined) ?? {};
  if (headers['Authorization'] !== 'Bearer 0123456789abcdef0123') {
    return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Falta el token' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return new Response(JSON.stringify(String(input).endsWith('/status') ? STATUS : {}), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

afterEach(() => {
  sessionStorage.clear();
  location.hash = '';
});

describe('App', () => {
  it('sin token muestra la puerta de sesión', () => {
    render(App, { props: { fetchImpl } });
    expect(screen.getByLabelText('Token de sesión')).toBeTruthy();
  });

  it('con el token en el fragmento lo guarda en la pestaña, limpia la URL y muestra Estado', async () => {
    location.hash = '#token=0123456789abcdef0123';
    render(App, { props: { fetchImpl } });
    await waitFor(() => expect(screen.getByText('al día')).toBeTruthy());
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('0123456789abcdef0123');
    expect(location.hash).toBe('#/estado');
    expect(screen.getByRole('link', { name: 'Estado' }).getAttribute('aria-current')).toBe('page');
  });

  it('con un token guardado inválido, el 401 devuelve a la puerta de sesión; las rutas pendientes lo dicen', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'token-que-no-vale-1234');
    location.hash = '#/revisiones';
    render(App, { props: { fetchImpl } });
    await waitFor(() => expect(screen.getByText(/llega con T-7.5b/)).toBeTruthy());
    location.hash = '#/estado';
    await waitFor(() => expect(screen.getByLabelText('Token de sesión')).toBeTruthy());
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });
});
