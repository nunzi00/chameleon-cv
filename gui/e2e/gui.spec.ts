import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
  await expect(page.getByRole('banner').getByText(state.workspace)).toBeVisible();
  await expect(page.getByRole('main').getByText(state.workspace)).toBeVisible();
  await expect(page.getByRole('main').getByText('al día')).toBeVisible();
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
  await page.getByRole('tab', { name: 'Del espacio' }).click();
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

  // T-9.18: al volver, la pantalla recuerda CÓMO generas —especialidad, formato, motor— pero no la oferta.
  await page.reload();
  await expect(page.getByLabel('Especialidad')).toHaveValue('backend');
  await expect(page.getByLabel('Formato')).toHaveValue('pdf');
  await expect(page.getByLabel('Motor')).toHaveValue('pdfkit');
  await expect(page.getByLabel(/Fichero \(relativo/)).toHaveCount(0);
});

test('Generar refina la lectura de la oferta con el co-piloto y enseña cada etiqueta con su evidencia (T-9.10)', async ({ page }) => {
  await openWithToken(page, state, '#/generar');
  await page.getByRole('tab', { name: 'Del espacio' }).click();
  await page.getByLabel(/Fichero \(relativo/).fill('ofertas/nexo.txt');
  await page.getByLabel(/Refinar la lectura con el co-piloto/).check();
  await page.getByRole('button', { name: 'Analizar oferta' }).click();
  await expect(page.getByRole('heading', { name: 'Adecuación a la oferta' })).toBeVisible();
  // Lo que aportó el modelo se enseña con la frase de la oferta que lo justifica: sin eso no se puede juzgar.
  await expect(page.getByText(/El co-piloto añadió 1 etiqueta/)).toBeVisible();
  await expect(page.getByText('«mentoría»')).toBeVisible();
  // Y sigue AL LADO del formulario, no debajo: la pantalla es una rejilla de dos columnas y basta con colgar un
  // párrafo de ella para que el resultado caiga a una tercera fila (pasó al añadir la casilla, 1-sep).
  const form = await page.locator('.cv-generar-form').boundingBox();
  const result = await page.locator('.cv-generar-result').boundingBox();
  expect(result!.x).toBeGreaterThanOrEqual(form!.x + form!.width - 1);
});

test('Generar instala un tema de la comunidad desde un archivo del espacio de trabajo, lo verifica y lo ofrece en el selector', async ({ page }) => {
  await openWithToken(page, state, '#/generar');
  await page.getByText(/Temas de Typst/).click();
  await page.getByLabel(/Instalar tema/).fill('themes/comunidad.zip');
  await page.getByRole('button', { name: 'Ver el plan' }).click();
  await expect(page.getByText(/Plan: «comunidad» se instalaría en .*themes\/comunidad \(4 ficheros, SHA-256 bfbc3701c2d7c867…\)\. Nada escrito\./)).toBeVisible();
  await page.getByRole('button', { name: 'Instalar tema…' }).click();
  await expect(page.getByText(/Tema «comunidad» instalado en .*themes\/comunidad \(4 ficheros, SHA-256 bfbc3701c2d7c867…\)\./)).toBeVisible();
  expect(existsSync(join(state.workspace, 'themes', 'comunidad', '.origin.json'))).toBe(true);
  await page.getByLabel(/Instalar tema/).fill('https://ejemplo.org/temas/otro.zip');
  await page.getByRole('button', { name: 'Instalar tema…' }).click();
  await expect(page.getByText(/no descarga nada: arráncalo con «cv serve --allow-remote»/)).toBeVisible();
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
  // La versión anterior completa queda en el histórico de fuentes (T-8.10), no en una copia .bak junto a la fuente.
  expect(readdirSync(join(sources, 'experience')).some((name) => name.endsWith('.bak'))).toBe(false);
  expect(existsSync(join(state.workspace, 'output', 'historial-fuentes', 'index.json'))).toBe(true);
});

test('Estado exporta el perfil como descarga y lo importa sustituyendo las fuentes con copia; después compila', async ({ page }) => {
  await openWithToken(page, state);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Exportar perfil (JSON)' }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^perfil-\d{4}-\d{2}-\d{2}\.json$/);
  const exported = join(state.workspace, 'output', download.suggestedFilename());
  await download.saveAs(exported);
  const profile = JSON.parse(readFileSync(exported, 'utf8')) as { personal: { fullName: string } };
  expect(profile.personal.fullName.length).toBeGreaterThan(0);
  await expect(page.getByText(/Perfil exportado como perfil-/)).toBeVisible();
  await page.getByLabel('Fichero del perfil (JSON)').setInputFiles(exported);
  await expect(page.getByRole('heading', { name: 'Importar perfil' })).toBeVisible();
  await page.getByRole('checkbox', { name: /Sustituir las fuentes actuales/ }).check();
  await page.getByRole('button', { name: 'Ver plan' }).click();
  await expect(page.getByText(/ficheros en .*data\/sources/)).toBeVisible();
  await expect(page.getByText('Auto-chequeo superado: las fuentes regeneradas reproducen el perfil.')).toBeVisible();
  await page.getByRole('button', { name: 'Escribir en las fuentes' }).click();
  await expect(page.getByText(/Perfil importado en .* las fuentes anteriores quedan en .*\.bak/)).toBeVisible();
  expect(readdirSync(join(state.workspace, 'data')).some((name) => /^sources\.\d{8}-\d{6}\.bak$/.test(name))).toBe(true);
  await page.getByRole('button', { name: 'Compilar' }).click();
  await expect(page.getByText(/Artefacto compilado en/)).toBeVisible();
});

test('Ajustes muestra la configuración de cv.toml con sus orígenes, comprueba el proveedor local, guarda un cambio y lo deshace', async ({ page }) => {
  await openWithToken(page, state, '#/ajustes');
  await expect(page.getByText(/Efectivo: openai-compatible \(cv\.toml\)/)).toBeVisible();
  await expect(page.getByText('sin clave').first()).toBeVisible();
  await expect(page.getByText(/Cuota publicada: 30 peticiones\/min/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Comprobar groq' })).toBeDisabled();
  await page.getByRole('button', { name: 'Comprobar', exact: true }).click();
  await expect(page.getByText(/Responde: 1 modelo \(stub-model\)/)).toBeVisible();
  const model = page.getByLabel('Modelo', { exact: true });
  await model.fill('otro-modelo');
  await page.getByRole('button', { name: 'Guardar en cv.toml' }).click();
  await expect(page.getByText(/Guardado en .*cv\.toml/)).toBeVisible();
  expect(readFileSync(join(state.workspace, 'cv.toml'), 'utf8')).toContain('model = "otro-modelo"');
  await expect(page.getByText(/modelo otro-modelo \(cv\.toml\)/)).toBeVisible();
  await model.fill('stub-model');
  await page.getByRole('button', { name: 'Guardar en cv.toml' }).click();
  await expect(page.getByText(/modelo stub-model \(cv\.toml\)/)).toBeVisible();
  // Panel del runtime de Ollama (T-8.8): siempre presente, con su estado o el motivo por el que no aplica.
  await expect(page.getByText('Ollama local')).toBeVisible();
});

test('la barra lateral y la cabecera de contexto (T-8.6 S1): chips en toda pantalla, tema, teclado, plegado y 1024 px', async ({ page }) => {
  await openWithToken(page, state);
  const banner = page.getByRole('banner');
  await expect(banner.getByText('Artefacto al día')).toBeVisible();
  await expect(banner.getByText(/^Typst /)).toBeVisible();
  await expect(banner.getByText(/^Co-piloto/)).toBeVisible();
  await expect(banner.getByText(/^Remotos: /)).toBeVisible();
  await page.goto(`${state.url}#/salidas`);
  await page.getByRole('heading', { name: 'Salidas' }).waitFor();
  await expect(banner.getByText('Artefacto al día')).toBeVisible();

  await banner.getByRole('button', { name: 'Oscuro' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('cv.theme'))).toBe('dark');
  await page.reload();
  await page.getByRole('heading', { name: 'Salidas' }).waitFor();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await banner.getByRole('button', { name: 'Sistema' }).click();
  await expect(page.locator('html')).not.toHaveAttribute('data-theme', /./);

  await page.getByRole('link', { name: 'Fuentes' }).focus();
  const order: string[] = [];
  for (let i = 0; i < 13; i += 1) {
    order.push(await page.evaluate(() => document.activeElement?.querySelector('span')?.textContent?.trim() ?? ''));
    await page.keyboard.press('Tab');
  }
  expect(order).toEqual(['Fuentes', 'Importar CV', 'Borradores', 'Duplicados', 'Vida laboral', 'Estado del artefacto', 'Generar', 'LinkedIn', 'Salidas', 'Trabajos', 'Revisiones', 'Ajustes', 'Portada']);
  expect(await page.evaluate(() => getComputedStyle(document.activeElement as Element).outlineStyle)).toBe('solid');

  await page.getByRole('button', { name: 'Plegar a iconos' }).click();
  await expect(page.locator('.cv-app')).toHaveAttribute('data-rail', '');
  await page.reload();
  await page.getByRole('heading', { name: 'Salidas' }).waitFor();
  await expect(page.locator('.cv-app')).toHaveAttribute('data-rail', '');
  // Plegada, el texto del botón está oculto y su nombre accesible pasa a ser el title.
  await page.getByRole('button', { name: 'Desplegar la barra' }).click();
  await expect(page.locator('.cv-app')).not.toHaveAttribute('data-rail', /.*/);

  await page.setViewportSize({ width: 1024, height: 700 });
  for (const name of ['Apagar cv serve', 'Sistema', 'Claro']) {
    const box = await banner.getByRole('button', { name }).boundingBox();
    expect(box, name).not.toBeNull();
    expect((box?.x ?? 0) + (box?.width ?? 0), name).toBeLessThanOrEqual(1024);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
});

test('Apagar detiene el servidor tras confirmar (última prueba)', async ({ page }) => {
  await openWithToken(page, state);
  await page.getByRole('button', { name: 'Apagar cv serve' }).click();
  await page.getByRole('button', { name: 'Apagar', exact: true }).click();
  await expect(page.getByText('Servidor detenido')).toBeVisible();
});
