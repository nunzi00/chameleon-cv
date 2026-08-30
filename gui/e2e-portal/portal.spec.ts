/**
 * Portal construido (T-8.6 S4): la portada responde «qué es y qué no hace» sin desplazarse en un portátil de 13″
 * (1440×900), el modo oscuro mantiene el contraste AA en texto y marca, y ninguna petición sale del sitio (sin fuentes
 * ni recursos externos). Corre contra `vitepress preview` del build real (gui/playwright.portal.config.ts); vive en gui/
 * porque es donde está instalado Playwright.
 */
import { expect, test, type Page } from '@playwright/test';

/** Luminancia relativa (WCAG 2.x) de un color `rgb(r, g, b)` computado. */
function luminance(rgb: string): number {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g)!.slice(0, 3).map((v) => Number(v) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1! + 0.05) / (l2! + 0.05);
}

async function colors(page: Page, selector: string): Promise<{ color: string; background: string }> {
  return page.locator(selector).first().evaluate((element) => {
    const style = getComputedStyle(element);
    // El fondo efectivo: el primer antecesor con fondo opaco.
    let node: Element | null = element;
    let background = 'rgba(0, 0, 0, 0)';
    while (node !== null && (background === 'rgba(0, 0, 0, 0)' || background === 'transparent')) {
      background = getComputedStyle(node).backgroundColor;
      node = node.parentElement;
    }
    return { color: style.color, background };
  });
}

test('la portada responde «qué es y qué no hace» sin desplazarse en un portátil de 13″ y enlaza los tres caminos', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Chameleon CV');
  await expect(page.getByText('Un perfil, muchos CV.')).toBeVisible();
  await expect(page.getByText('Local y soberano · sin cuenta, sin telemetría')).toBeVisible();
  const what = page.getByRole('heading', { name: 'Qué hace y qué no hace' });
  const box = await what.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(900);
  await expect(page.getByRole('heading', { name: 'Qué no hace', exact: true })).toBeVisible();
  await expect(page.getByText('No inventa')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Inicio rápido' }).first()).toHaveAttribute('href', /guide\/quickstart/);
  await expect(page.getByRole('link', { name: /Ver la galería/ })).toHaveAttribute('href', /guide\/theme-gallery/);
  await expect(page.getByRole('img', { name: /tema functional/ })).toHaveAttribute('src', /themes\/functional\.png/);
  await expect(page.getByText('MIT · sin telemetría · es-ES')).toBeVisible();
});

test('modo oscuro: el texto y la marca mantienen contraste AA sobre el fondo, en la portada y en una guía', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.evaluate(() => {
    document.documentElement.classList.add('dark');
    localStorage.setItem('vitepress-theme-appearance', 'dark');
  });
  await expect(page.locator('html.dark')).toHaveCount(1);
  const muted = await colors(page, '.cv-home-muted');
  expect(contrast(muted.color, muted.background)).toBeGreaterThanOrEqual(4.5);
  const lead = await colors(page, '.cv-home-list strong');
  expect(contrast(lead.color, lead.background)).toBeGreaterThanOrEqual(4.5);
  const link = await colors(page, '.cv-home-link');
  expect(contrast(link.color, link.background)).toBeGreaterThanOrEqual(4.5);
  await page.goto('/guide/quickstart');
  await expect(page.locator('html.dark')).toHaveCount(1);
  const body = await colors(page, '.vp-doc p');
  expect(contrast(body.color, body.background)).toBeGreaterThanOrEqual(4.5);
});

test('ninguna petición sale del sitio: ni fuentes descargadas ni recursos externos', async ({ page, baseURL }) => {
  const foreign: string[] = [];
  page.on('request', (request) => {
    if (!request.url().startsWith(baseURL!)) {
      foreign.push(request.url());
    }
  });
  await page.goto('/');
  await page.goto('/guide/theme-gallery');
  await page.waitForLoadState('networkidle');
  expect(foreign).toEqual([]);
  const fonts = await page.evaluate(() => Array.from(document.fonts).map((font) => font.family));
  expect(fonts.filter((family) => /inter/i.test(family))).toEqual([]);
});
