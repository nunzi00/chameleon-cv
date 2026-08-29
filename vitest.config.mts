import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      // Lógica de negocio: cobertura del 100 % obligatoria (principio no negociable n.º 2).
      include: ['src/core/**/*.ts', 'src/parsers/**/*.ts', 'src/renderers/**/*.ts', 'src/artifact/**/*.ts', 'src/cli/**/*.ts', 'src/shared/**/*.ts', 'src/pdf/**/*.ts', 'src/pdf/**/*.mts', 'src/typst/**/*.ts', 'src/llm/**/*.ts', 'src/themes/**/*.ts', 'src/release/**/*.ts', 'src/app/**/*.ts', 'src/serve/**/*.ts'],
      reporter: ['text', 'html'],
      exclude: ['src/cli/stdin.ts', 'src/pdf/worker.mts', 'src/pdf/polyfills.mts'],
      reportsDirectory: 'coverage',
      thresholds: { statements: 100, branches: 100, functions: 100, lines: 100 },
    },
  },
});
