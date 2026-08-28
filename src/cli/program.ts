/**
 * Definición de la CLI `cv` con commander. `runCli` devuelve el código de salida en lugar de
 * terminar el proceso, para que la CLI completa sea testeable con un contexto inyectado.
 */
import { Command, CommanderError } from 'commander';

import { runAnalyzeOffer, type AnalyzeOfferOptions } from './commands/analyze-offer';
import { runBuildProfile, type BuildProfileOptions } from './commands/build-profile';
import { runGenerateCv, type GenerateCvOptions } from './commands/generate-cv';
import { runValidate, type ValidateOptions } from './commands/validate';
import type { CliContext } from './context';
import { DEFAULT_ARTIFACT_PATH, DEFAULT_DATA_DIR, DEFAULT_OUTPUT_DIR } from './defaults';
import { parseLimit } from './limits';
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
    .command('validate')
    .description('comprueba las fuentes sin escribir nada')
    .option('-d, --data <dir>', 'directorio de fuentes', DEFAULT_DATA_DIR)
    .action(async (options: ValidateOptions) => {
      onExit(await runValidate(context, options));
    });

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
    .command('generate-cv')
    .description(`genera el CV en Markdown a partir del artefacto (por defecto en ${DEFAULT_OUTPUT_DIR}/cv-<nombre>[-<especialidad>][-<oferta>].md)`)
    .option('-s, --specialty <id>', 'especialidad: elige la versión del CV (titular, resumen y filtro); sin ella, el CV completo')
    .option('-f, --from-job-offer <file>', 'oferta de empleo en texto plano («-» = entrada estándar): afina el CV puntuando y reordenando')
    .option('-n, --top-n <n>', 'logros por experiencia/proyecto y logros transversales', parseLimit)
    .option('--max-skills <n>', 'skills como máximo', parseLimit)
    .option('--max-projects <n>', 'proyectos como máximo', parseLimit)
    .option('--max-certifications <n>', 'certificaciones como máximo', parseLimit)
    .option('--compact', 'preset: --top-n 4 --max-skills 12 --max-projects 4 --max-certifications 5 (los límites explícitos prevalecen)', false)
    .option('-p, --profile <file>', 'ruta del artefacto', DEFAULT_ARTIFACT_PATH)
    .option('-d, --data <dir>', 'directorio de fuentes, solo para avisar si el artefacto está obsoleto', DEFAULT_DATA_DIR)
    .option('-o, --output <file>', 'fichero de salida')
    .option('-t, --template <file>', 'plantilla Handlebars propia (por defecto templates/cv.md.hbs)')
    .option('-l, --locale <locale>', 'idioma de etiquetas y fechas (por defecto, el del perfil o «es»)')
    .option('--explain', 'explica en stderr qué se ha incluido, puntuado y recortado, y por qué', false)
    .option('--stdout', 'escribe el CV en la salida estándar en lugar de en un fichero', false)
    .action(async (options: GenerateCvOptions) => {
      onExit(await runGenerateCv(context, options));
    });

  program
    .command('analyze-offer')
    .description('analiza una oferta contra el perfil sin generar nada: adecuación, evidencias y carencias')
    .argument('<offer>', 'fichero de texto de la oferta, o «-» para la entrada estándar')
    .option('-s, --specialty <id>', 'especialidad real con la que analizar; sin ella, la virtual de la oferta')
    .option('-p, --profile <file>', 'ruta del artefacto', DEFAULT_ARTIFACT_PATH)
    .option('-d, --data <dir>', 'directorio de fuentes, solo para avisar si el artefacto está obsoleto', DEFAULT_DATA_DIR)
    .option('--explain', 'añade la auditoría por ítem', false)
    .option('--json', 'salida estructurada para scripts', false)
    .action(async (offer: string, options: AnalyzeOfferOptions) => {
      onExit(await runAnalyzeOffer(context, offer, options));
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
