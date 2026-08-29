import { readFileSync } from 'node:fs';

import type { Page } from '@playwright/test';

import { STATE_FILE, type ServerState } from './global-setup';

export function serverState(): ServerState {
  return JSON.parse(readFileSync(STATE_FILE, 'utf8')) as ServerState;
}

/** Entra con el token en el fragmento, como hace `cv serve --open`, y espera a la pantalla Estado. */
export async function openWithToken(page: Page, state: ServerState, route = '#/estado'): Promise<void> {
  await page.goto(`${state.url}#token=${state.token}`);
  await page.getByRole('heading', { name: 'Estado' }).waitFor();
  if (route !== '#/estado') {
    await page.goto(`${state.url}${route}`);
  }
}
