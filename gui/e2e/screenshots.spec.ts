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
  await page.goto(`${state.url}#/copiloto`);
  await page.getByText('proveedor local listo').waitFor();
  await page.getByLabel(/Logros por ejecución/).fill('2');
  await page.getByLabel(/Propuestas por logro/).fill('1');
  await page.getByLabel('Usar la caché de respuestas').uncheck();
  await page.getByRole('button', { name: 'Lanzar' }).click();
  await page.getByText('terminado').waitFor({ timeout: 30_000 });
  await page.screenshot({ path: join(OUT, 'copiloto.png'), fullPage: true });
  await page.getByRole('button', { name: 'Abrir la revisión' }).click();
  await page.getByRole('heading', { name: 'Antes' }).first().waitFor();
  await page.getByRole('checkbox').first().check();
  await page.getByRole('button', { name: 'Guardar marcas' }).click();
  await page.getByText(/Marcas guardadas/).waitFor();
  await page.getByRole('button', { name: 'Plan de aplicación' }).click();
  await page.getByRole('heading', { name: 'Plan de aplicación' }).waitFor();
  await page.screenshot({ path: join(OUT, 'revisiones.png'), fullPage: true });
});
