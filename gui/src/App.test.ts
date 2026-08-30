import { fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from './App.svelte';
import { NAV_KEY } from './lib/nav';
import { TOKEN_KEY } from './lib/session';
import { memoryStorage } from './lib/storage';
import { THEME_KEY } from './lib/theme';

const STATUS = { version: '1.2.0', workspace: '/work', artifact: { status: 'fresh', detail: undefined, specialties: [] }, typst: { required: '0.15.1', candidates: [], selected: undefined, usable: false }, llm: { config: undefined, configError: undefined, health: undefined, keys: {}, keysFile: '', allowedHosts: [], remote: undefined, usable: false, settings: { path: undefined, present: false, configured: false, error: undefined }, providers: [] }, themes: { defaultName: 'default', configWarning: undefined, roots: [], entries: [] } };
const LLM_CONFIG = { llm: STATUS.llm, file: { path: '/work/cv.toml', present: false, sha256: undefined }, remote: { allowed: true } };
const REVIEWS = { reviews: [{ name: 'a.md' }, { name: 'b.md' }, { name: 'c.md' }] };

let calls: string[] = [];
let shutdownStatus = 200;
let preferences = memoryStorage();

const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const headers = (init?.headers as Record<string, string> | undefined) ?? {};
  const url = String(input);
  calls.push(`${init?.method ?? 'GET'} ${url.slice(url.indexOf('/api/'))}`);
  if (headers['Authorization'] !== 'Bearer 0123456789abcdef0123') {
    return new Response(JSON.stringify({ error: { code: 'unauthorized', message: 'Falta el token' } }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  if (url.endsWith('/shutdown')) {
    return new Response(JSON.stringify(shutdownStatus === 200 ? { stopping: true } : { error: { code: 'unauthorized', message: 'Caducó' } }), { status: shutdownStatus, headers: { 'Content-Type': 'application/json' } });
  }
  const body = url.endsWith('/status') ? STATUS : url.endsWith('/config/llm') ? LLM_CONFIG : url.endsWith('/reviews') ? REVIEWS : {};
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } });
}) as typeof fetch;

beforeEach(() => {
  preferences = memoryStorage();
  vi.stubGlobal('localStorage', preferences);
});

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  document.documentElement.removeAttribute('data-theme');
  location.hash = '';
  calls = [];
  shutdownStatus = 200;
});

describe('App', () => {
  it('sin token muestra la puerta de sesión', () => {
    render(App, { props: { fetchImpl } });
    expect(screen.getByLabelText('Token de sesión')).toBeTruthy();
  });

  it('con el token en el fragmento lo guarda en la pestaña, limpia la URL, muestra Estado y llena la cabecera con una sola consulta', async () => {
    location.hash = '#token=0123456789abcdef0123';
    render(App, { props: { fetchImpl } });
    await waitFor(() => expect(screen.getByText('al día')).toBeTruthy());
    expect(sessionStorage.getItem(TOKEN_KEY)).toBe('0123456789abcdef0123');
    expect(location.hash).toBe('#/estado');
    expect(screen.getByRole('link', { name: 'Estado del artefacto' }).getAttribute('aria-current')).toBe('page');
    await waitFor(() => expect(screen.getByText('Remotos: permitidos')).toBeTruthy());
    expect(screen.getByText('Artefacto al día')).toBeTruthy();
    expect(screen.getByLabelText('3 pendientes').textContent).toBe('3');
    // Las pantallas no consultan /config/llm ni /reviews por su cuenta: solo lo hace el contexto compartido.
    expect(calls.filter((call) => call === 'GET /api/v1/config/llm').length).toBeGreaterThan(0);
    expect(calls.filter((call) => call === 'GET /api/v1/reviews').length).toBe(calls.filter((call) => call === 'GET /api/v1/config/llm').length);
  });

  it('con un token guardado inválido, el 401 devuelve a la puerta de sesión', async () => {
    sessionStorage.setItem(TOKEN_KEY, 'token-que-no-vale-1234');
    location.hash = '#/estado';
    render(App, { props: { fetchImpl } });
    await waitFor(() => expect(screen.getByLabelText('Token de sesión')).toBeTruthy());
    expect(sessionStorage.getItem(TOKEN_KEY)).toBeNull();
  });

  it('entrar por la puerta consulta el contexto; cambiar de pantalla lo refresca', async () => {
    render(App, { props: { fetchImpl } });
    await fireEvent.input(screen.getByLabelText('Token de sesión'), { target: { value: '0123456789abcdef0123' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    await waitFor(() => expect(screen.getByText('Artefacto al día')).toBeTruthy());
    const before = calls.filter((call) => call === 'GET /api/v1/status').length;
    location.hash = '#/salidas';
    await waitFor(() => expect(calls.filter((call) => call === 'GET /api/v1/status').length).toBe(before + 1));
  });

  it('el conmutador de tema escribe data-theme en <html> y lo guarda; el plegado de la barra persiste', async () => {
    preferences.setItem(THEME_KEY, 'dark');
    location.hash = '#token=0123456789abcdef0123';
    render(App, { props: { fetchImpl } });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Oscuro' }).getAttribute('aria-pressed')).toBe('true'));
    await fireEvent.click(screen.getByRole('button', { name: 'Claro' }));
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(preferences.getItem(THEME_KEY)).toBe('light');
    await fireEvent.click(screen.getByRole('button', { name: 'Sistema' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(preferences.getItem(THEME_KEY)).toBeNull();
    const app = document.querySelector('.cv-app');
    expect(app?.hasAttribute('data-rail')).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Plegar a iconos' }));
    expect(app?.hasAttribute('data-rail')).toBe(true);
    expect(preferences.getItem(NAV_KEY)).toBe('1');
  });

  it('apagar desde la cabecera pide confirmación y deja la pantalla en «servidor detenido»', async () => {
    location.hash = '#token=0123456789abcdef0123';
    render(App, { props: { fetchImpl } });
    await waitFor(() => expect(screen.getByText('al día')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar cv serve' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(calls.some((call) => call.startsWith('POST'))).toBe(false);
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar cv serve' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(screen.getByText('Servidor detenido')).toBeTruthy());
    expect(calls.filter((call) => call === 'POST /api/v1/shutdown')).toHaveLength(1);
  });

  it('si apagar responde 401, vuelve a la puerta de sesión', async () => {
    location.hash = '#token=0123456789abcdef0123';
    render(App, { props: { fetchImpl } });
    await waitFor(() => expect(screen.getByText('al día')).toBeTruthy());
    shutdownStatus = 401;
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar cv serve' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Apagar' }));
    await waitFor(() => expect(screen.getByLabelText('Token de sesión')).toBeTruthy());
  });
});
