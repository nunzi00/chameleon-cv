import { defineConfig } from '@playwright/test';

/**
 * E2E del portal construido (T-8.6 S4, docs/gui-design/plan-sprints.md §S4): sirve website/.vitepress/dist con
 * «vitepress preview» (lo que publica Pages) y comprueba la portada, el modo oscuro y que ninguna petición sale
 * del propio sitio. Requiere `npm run docs:build` antes.
 */
export default defineConfig({
  testDir: 'e2e-portal',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  webServer: {
    command: 'npm --prefix ../website run preview -- --port 4173 --host 127.0.0.1',
    url: 'http://127.0.0.1:4173/',
    reuseExistingServer: false,
    timeout: 60_000,
  },
  use: {
    baseURL: 'http://127.0.0.1:4173/',
    browserName: 'chromium',
    viewport: { width: 1440, height: 900 },
    locale: 'es-ES',
    screenshot: 'only-on-failure',
  },
});
