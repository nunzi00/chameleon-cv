import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from '@playwright/test';

import { openWithToken, serverState } from './helpers';

test.describe.configure({ mode: 'serial' });

const state = serverState();

test('la sesión entra por el fragmento, lo retira de la URL y la guarda en la pestaña; sin token, la puerta', async ({ page, browser }) => {
  await openWithToken(page, state);
  await expect(page).toHaveURL(`${state.url}#/estado`);
  expect(await page.evaluate(() => sessionStorage.getItem('chameleon-cv.token'))).toBe(state.token);
  await expect(page.getByRole('link', { name: 'Estado' })).toHaveAttribute('aria-current', 'page');
  const fresh = await browser.newContext();
  const anonymous = await fresh.newPage();
  await anonymous.goto(state.url);
  await expect(anonymous.getByLabel('Token de sesión')).toBeVisible();
  await anonymous.getByLabel('Token de sesión').fill(state.token);
  await anonymous.getByRole('button', { name: 'Entrar' }).click();
  await expect(anonymous.getByRole('heading', { name: 'Estado' })).toBeVisible();
  await fresh.close();
});

test('Estado muestra el espacio de trabajo real, valida y compila', async ({ page }) => {
  await openWithToken(page, state);
  await expect(page.getByText(state.workspace)).toBeVisible();
  await expect(page.getByText('al día')).toBeVisible();
  await page.getByRole('button', { name: 'Validar' }).click();
  await expect(page.getByText(/Fuentes válidas: \d+ ficheros/)).toBeVisible();
  await page.getByRole('button', { name: 'Compilar' }).click();
  await expect(page.getByText(/Artefacto compilado en/)).toBeVisible();
});

test('Fuentes abre un fichero en CodeMirror, guarda con If-Match y el cambio llega al disco', async ({ page }) => {
  await openWithToken(page, state, '#/fuentes/profile.md');
  const editor = page.locator('.cm-content');
  await expect(editor).toBeVisible();
  await expect(editor).toContainText('schemaVersion');
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type(' Editado desde la prueba E2E.');
  await expect(page.getByText('cambios sin guardar')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar' }).click();
  await expect(page.getByText(/Guardado\. Fuentes válidas/)).toBeVisible();
  expect(readFileSync(join(state.workspace, 'data', 'sources', 'profile.md'), 'utf8')).toContain('Editado desde la prueba E2E.');
});

test('Generar analiza una oferta del espacio de trabajo y genera el CV en Markdown y en PDF', async ({ page }) => {
  await openWithToken(page, state, '#/generar');
  await page.getByLabel('Especialidad').selectOption('backend');
  await page.getByLabel('Oferta').selectOption('file');
  await page.getByLabel(/Fichero \(relativo/).fill('ofertas/nexo.txt');
  await page.getByRole('button', { name: 'Analizar oferta' }).click();
  await expect(page.getByRole('heading', { name: 'Adecuación a la oferta' })).toBeVisible();
  await expect(page.getByText(/\d+ de \d+ requisitos demostrados/)).toBeVisible();
  await page.getByLabel('Formato').selectOption('md');
  await page.getByRole('button', { name: 'Generar CV' }).click();
  await expect(page.getByText(/CV escrito en output\/.*\.md/)).toBeVisible();
  await expect(page.locator('pre.cv-text')).toContainText('#');
  await page.getByText('Informe de decisiones').click();
  await expect(page.getByText(/Especialidad «backend»/)).toBeVisible();
  await page.getByLabel('Formato').selectOption('pdf');
  await page.getByLabel('Motor').selectOption('pdfkit');
  await page.getByRole('button', { name: 'Generar CV' }).click();
  await expect(page.getByText(/CV escrito en output\/.*\.pdf/)).toBeVisible();
  const frame = page.locator('iframe[title^="Vista previa de"]');
  await expect(frame).toHaveAttribute('src', /^blob:/);
  await expect(page.getByRole('link', { name: /Descargar .*\.pdf/ })).toBeVisible();
});

test('Salidas lista lo generado y muestra el Markdown', async ({ page }) => {
  await openWithToken(page, state, '#/salidas');
  await expect(page.getByText(/\d+ ficheros en/)).toBeVisible();
  await page.getByRole('button', { name: /Markdown .*\.md/ }).click();
  await expect(page.locator('pre.cv-text')).toContainText('#');
  await expect(page.getByRole('link', { name: 'Descargar' })).toBeVisible();
});

test('Co-piloto lanza un improve contra el doble del proveedor, lo sigue por SSE y deja la revisión escrita', async ({ page }) => {
  await openWithToken(page, state, '#/copiloto');
  await expect(page.getByText('proveedor local listo')).toBeVisible();
  await page.getByLabel(/Logros por ejecución/).fill('2');
  await page.getByLabel(/Propuestas por logro/).fill('1');
  await page.getByLabel('Usar la caché de respuestas').uncheck();
  await page.getByRole('button', { name: 'Lanzar' }).click();
  await expect(page.getByText(/hacia openai-compatible/)).toBeVisible();
  await expect(page.getByText('terminado')).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('pre.cv-progress')).toContainText('[1/2]');
  await expect(page.getByText(/Revisión escrita en output\/revision-improve-/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Abrir la revisión' })).toBeVisible();
  const outputs = readdirSync(join(state.workspace, 'output'));
  expect(outputs.some((name) => name.startsWith('revision-improve-'))).toBe(true);
});

test('Revisiones abre la revisión del co-piloto, guarda una marca, muestra el plan y aplica a las fuentes con copia .bak', async ({ page }) => {
  await openWithToken(page, state, '#/revisiones');
  await page.getByRole('button', { name: /revision-improve-/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Antes' }).first()).toBeVisible();
  const checkbox = page.getByRole('checkbox').first();
  await checkbox.check();
  await expect(page.getByText('marcas sin guardar')).toBeVisible();
  await page.getByRole('button', { name: 'Guardar marcas' }).click();
  await expect(page.getByText(/Marcas guardadas \(1 propuesta marcada\)/)).toBeVisible();
  await page.getByRole('button', { name: 'Plan de aplicación' }).click();
  await expect(page.getByRole('heading', { name: 'Plan de aplicación' })).toBeVisible();
  await page.getByRole('button', { name: 'Escribir en las fuentes' }).click();
  await page.getByRole('button', { name: 'Escribir', exact: true }).click();
  await expect(page.getByText(/1 cambio aplicado en 1 fichero/)).toBeVisible();
  const sources = join(state.workspace, 'data', 'sources');
  const changed = readdirSync(join(sources, 'experience')).some((name) => name.endsWith('.md') && readFileSync(join(sources, 'experience', name), 'utf8').includes('Logré: '));
  expect(changed).toBe(true);
  expect(readdirSync(join(sources, 'experience')).some((name) => name.endsWith('.bak'))).toBe(true);
});

test('Apagar detiene el servidor tras confirmar (última prueba)', async ({ page }) => {
  await openWithToken(page, state);
  await page.getByRole('button', { name: 'Apagar el servidor' }).click();
  await page.getByRole('button', { name: 'Apagar', exact: true }).click();
  await expect(page.getByText('Servidor detenido')).toBeVisible();
});
