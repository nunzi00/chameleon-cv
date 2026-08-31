/**
 * Segunda puerta estática (T-9.3, deuda B-6): reglas que el compilador NO cubre —promesas sin esperar,
 * condiciones que no pueden ser falsas, aserciones de tipo inútiles—. `tsc` sigue siendo la primera puerta;
 * aquí solo entra lo que aporta señal nueva, para que la puerta no se convierta en ruido que nadie lee.
 */
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: ['dist/**', 'build/**', 'coverage/**', 'gui/**', 'website/**', 'scripts/**', 'node_modules/**', 'eslint.config.mjs', '**/*.mts'],
  },
  {
    files: ['src/**/*.ts', 'tests/**/*.ts'],
    extends: [tseslint.configs.base],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/await-thenable': 'error',
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-array-delete': 'error',
      '@typescript-eslint/no-for-in-array': 'error',
      '@typescript-eslint/no-implied-eval': 'error',
      '@typescript-eslint/prefer-promise-reject-errors': 'error',
      '@typescript-eslint/require-array-sort-compare': 'error',
      '@typescript-eslint/unbound-method': 'error',
    },
  },
  {
    // Las pruebas rechazan a propósito con valores que no son Error (un string, un objeto suelto) para ejercitar
    // `describeError` y el camino de «lo que llegue, se explica»: ahí la regla iría contra lo que se quiere probar.
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/prefer-promise-reject-errors': 'off' },
  },
);
