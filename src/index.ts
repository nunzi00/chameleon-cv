#!/usr/bin/env node
/**
 * Punto de entrada del binario `cv`. Solo cablea el proceso: la lógica vive en `src/cli/`.
 */
import { createNodeContext, runCli } from './cli';
import { EXIT_FAILURE } from './cli/output';
import { describeError } from './shared/errors';

runCli(process.argv.slice(2), createNodeContext()).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    process.stderr.write(`Error inesperado: ${describeError(error)}\n`);
    process.exitCode = EXIT_FAILURE;
  },
);
