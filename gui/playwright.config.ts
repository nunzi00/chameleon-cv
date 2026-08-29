import { defineConfig } from '@playwright/test';

/**
 * E2E contra cv serve real (docs/gui-mvp.md §5): el arranque global crea un espacio de trabajo temporal (cv init,
 * cv build, una oferta), lanza el servidor con dist/index.js (o con el ejecutable de CV_BINARY) y deja la URL y el
 * token en e2e/.state.json. Un solo trabajador y orden serial: las pruebas comparten el servidor y la última lo apaga.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  use: {
    browserName: 'chromium',
    viewport: { width: 1280, height: 800 },
    colorScheme: 'light',
    locale: 'es-ES',
    screenshot: 'only-on-failure',
  },
});
