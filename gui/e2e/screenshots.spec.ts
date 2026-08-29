import { mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { test } from '@playwright/test';

import { openWithToken, serverState } from './helpers';

/** Capturas para la guía «La interfaz web» (docs/gui-mvp.md §6): solo con CV_SCREENSHOTS=1; se versionan en el portal. */
const OUT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', 'website', 'src', 'public', 'gui');
test.skip(process.env['CV_SCREENSHOTS'] !== '1', 'solo con CV_SCREENSHOTS=1');
test.describe.configure({ mode: 'serial' });

const state = serverState();

test('capturas de las pantallas', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await openWithToken(page, state);
  await page.screenshot({ path: join(OUT, 'estado.png') });
  await page.goto(`${state.url}#/fuentes/experience%2Facme.md`);
  await page.locator('.cm-content').waitFor();
  await page.screenshot({ path: join(OUT, 'fuentes.png') });
  await page.goto(`${state.url}#/generar`);
  await page.getByLabel('Especialidad').selectOption('backend');
  await page.getByLabel('Oferta').selectOption('file');
  await page.getByLabel(/Fichero \(relativo/).fill('ofertas/nexo.txt');
  await page.getByRole('button', { name: 'Analizar oferta' }).click();
  await page.getByRole('heading', { name: 'Adecuación a la oferta' }).waitFor();
  await page.getByLabel('Formato').selectOption('md');
  await page.getByRole('button', { name: 'Generar CV' }).click();
  await page.getByText('Informe de decisiones').click();
  await page.screenshot({ path: join(OUT, 'generar.png'), fullPage: true });
  await page.goto(`${state.url}#/salidas`);
  await page.getByRole('button', { name: /Markdown .*\.md/ }).click();
  await page.locator('pre.cv-text').waitFor();
  await page.screenshot({ path: join(OUT, 'salidas.png') });
});
