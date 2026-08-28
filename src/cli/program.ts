/**
 * Definición de la CLI `cv` con commander. `runCli` devuelve el código de salida en lugar de
 * terminar el proceso, para que la CLI completa sea testeable con un contexto inyectado.
 */
import { Command, CommanderError } from 'commander';

import { runBuildProfile, type BuildProfileOptions } from './commands/build-profile';
import { runValidate, type ValidateOptions } from './commands/validate';
import type { CliContext } from './context';
import { DEFAULT_ARTIFACT_PATH, DEFAULT_DATA_DIR } from './defaults';
import { EXIT_FAILURE, EXIT_OK } from './output';
import { packageVersion } from './version';

export function createProgram(context: CliContext, onExit: (code: number) => void): Command {
  const program = new Command()
    .name('cv')
    .description('Chameleon CV: genera CVs dinámicos y personalizados a partir de tus fuentes Markdown y CSV. Todo se procesa en local.')
    .version(packageVersion(), '-V, --version', 'muestra la versión')
    .helpOption('-h, --help', 'muestra esta ayuda')
    .exitOverride()
    .configureOutput({ writeOut: context.stdout, writeErr: context.stderr });

  program
    .command('build-profile')
    .description(`compila las fuentes y escribe el artefacto canónico (por defecto ${DEFAULT_ARTIFACT_PATH})`)
    .option('-d, --data <dir>', 'directorio de fuentes', DEFAULT_DATA_DIR)
    .option('-o, --out <file>', 'ruta del artefacto', DEFAULT_ARTIFACT_PATH)
    .option('-v, --verbose', 'muestra un resumen al terminar', false)
    .action(async (options: BuildProfileOptions) => {
      onExit(await runBuildProfile(context, options));
    });

  program
    .command('validate')
    .description('comprueba las fuentes sin escribir nada')
    .option('-d, --data <dir>', 'directorio de fuentes', DEFAULT_DATA_DIR)
    .action(async (options: ValidateOptions) => {
      onExit(await runValidate(context, options));
    });

  return program;
}

/** Ejecuta `cv` con los argumentos del usuario (sin `node` ni el nombre del binario). */
export async function runCli(argv: readonly string[], context: CliContext): Promise<number> {
  let exitCode = EXIT_OK;
  const program = createProgram(context, (code) => {
    exitCode = code;
  });
  try {
    await program.parseAsync([...argv], { from: 'user' });
  } catch (error) {
    if (error instanceof CommanderError) {
      return error.exitCode === 0 ? EXIT_OK : EXIT_FAILURE;
    }
    throw error;
  }
  return exitCode;
}
