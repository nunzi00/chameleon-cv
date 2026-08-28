import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Lógica de negocio: cobertura del 100 % obligatoria (principio no negociable n.º 2).
      include: ['src/core/**/*.ts', 'src/parsers/**/*.ts', 'src/renderers/**/*.ts'],
      reporter: ['text', 'html'],
      reportsDirectory: 'coverage',
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
