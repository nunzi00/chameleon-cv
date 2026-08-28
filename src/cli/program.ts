/**
 * Definición de la CLI `cv` con commander. `runCli` devuelve el código de salida en lugar de
 * terminar el proceso, para que la CLI completa sea testeable con un contexto inyectado.
 */
import { Command, CommanderError } from 'commander';

import { runAnalyzeOffer, type AnalyzeOfferOptions } from './commands/analyze-offer';
import { runBuild, type BuildOptions } from './commands/build';
import { runGenerateCv, type GenerateCvOptions } from './commands/generate-cv';
import { TEMPLATE_DATASET_DIR, runInit, type InitOptions } from './commands/init';
import { IMPROVE_DEFAULTS, runImproveCommand, runLlmCacheClear, type ImproveOptions } from './commands/improve';
import { runApplyCommand, type ApplyOptions } from './commands/apply';
import { runLlmStatus, type LlmStatusCommandOptions } from './commands/llm';
import { SUGGEST_TAGS_DEFAULTS, parseMaxTags, runSuggestTagsCommand, type SuggestTagsOptions } from './commands/suggest-tags';
import { SUMMARIZE_DEFAULTS, runSummarizeCommand, type SummarizeOptions } from './commands/summarize';
import { runTypstInstall, runTypstStatus, type TypstInstallOptions } from './commands/typst';
import { runValidate, type ValidateOptions } from './commands/validate';
import { parseEngine, parseFormat } from './format';
import type { CliContext } from './context';
import { DEFAULT_ARTIFACT_PATH, DEFAULT_DATA_DIR, DEFAULT_OUTPUT_DIR } from './defaults';
import { parseLimit, parseProposals } from './limits';
import { EXIT_FAILURE, EXIT_OK } from './output';
import { packageVersion } from './version';
import { TYPST_VERSION } from '../renderers/typst';

export function createProgram(context: CliContext, onExit: (code: number) => void): Command {
  const program = new Command().enablePositionalOptions()
    .name('cv')
    .description('Chameleon CV: genera CVs dinámicos y personalizados a partir de tus fuentes Markdown y CSV. Todo se procesa en local.')
    .version(packageVersion(), '-V, --version', 'muestra la versión')
    .helpOption('-h, --help', 'muestra esta ayuda')
    .exitOverride()
    .configureOutput({ writeOut: context.stdout, writeErr: context.stderr });

  program
    .command('init')
    .description('crea un espacio de trabajo: data/sources con un dataset de ejemplo y un .gitignore; nunca sobrescribe nada')
    .argument('[dir]', 'directorio del espacio de trabajo', '.')
    .option('--template <dir>', 'dataset de ejemplo alternativo', TEMPLATE_DATASET_DIR)
    .action(async (directory: string, options: InitOptions) => {
      onExit(await runInit(context, directory, options));
    });

  program
    .command('validate')
    .description('comprueba las fuentes sin escribir nada')
    .option('-d, --data <dir>', 'directorio de fuentes', DEFAULT_DATA_DIR)
    .action(async (options: ValidateOptions) => {
      onExit(await runValidate(context, options));
    });

  program
    .command('build')
    .alias('build-profile')
    .description(`compila las fuentes y escribe el artefacto canónico (por defecto ${DEFAULT_ARTIFACT_PATH}): la puerta de calidad del perfil`)
    .option('-d, --data <dir>', 'directorio de fuentes', DEFAULT_DATA_DIR)
    .option('-o, --out <file>', 'ruta del artefacto', DEFAULT_ARTIFACT_PATH)
    .option('--check', 'no escribe nada: falla si las fuentes tienen problemas o si el artefacto falta o no está al día', false)
    .option('-v, --verbose', 'muestra un resumen al terminar', false)
    .action(async (options: BuildOptions) => {
      onExit(await runBuild(context, options));
    });

  program
    .command('generate-cv')
    .description(`genera el CV en Markdown a partir del artefacto (por defecto en ${DEFAULT_OUTPUT_DIR}/cv-<nombre>[-<especialidad>][-<oferta>].md)`)
    .option('-s, --specialty <id>', 'especialidad: elige la versión del CV (titular, resumen y filtro); sin ella, el CV completo')
    .option('-f, --from-job-offer <file>', 'oferta de empleo en texto plano o PDF («-» = entrada estándar, solo texto): afina el CV puntuando y reordenando')
    .option('-n, --top-n <n>', 'logros por experiencia/proyecto y logros transversales', parseLimit)
    .option('--max-skills <n>', 'skills como máximo', parseLimit)
    .option('--max-projects <n>', 'proyectos como máximo', parseLimit)
    .option('--max-certifications <n>', 'certificaciones como máximo', parseLimit)
    .option('--compact', 'preset: --top-n 4 --max-skills 12 --max-projects 4 --max-certifications 5 (los límites explícitos prevalecen)', false)
    .option('-p, --profile <file>', 'ruta del artefacto', DEFAULT_ARTIFACT_PATH)
    .option('-d, --data <dir>', 'directorio de fuentes, solo para avisar si el artefacto está obsoleto', DEFAULT_DATA_DIR)
    .option('-o, --output <file>', 'fichero de salida')
    .option('--format <fmt>', 'formato de salida: md o pdf', parseFormat, 'md')
    .option('--engine <engine>', 'motor de --format pdf: pdfkit (por defecto, sin dependencias) o typst (binario oficial, calidad editorial)', parseEngine, 'pdfkit')
    .option('--typst-path <file>', 'binario de Typst (por defecto: CHAMELEON_TYPST, la caché de usuario o el PATH)')
    .option('--typst-any-version', 'acepta una versión de Typst distinta de la fijada', false)
    .option('-t, --template <file>', 'plantilla propia: Handlebars con --format md (por defecto templates/cv.md.hbs), .typ con --engine typst (por defecto templates/typst/cv.typ)')
    .option('-l, --locale <locale>', 'idioma de etiquetas y fechas (por defecto, el del perfil o «es»)')
    .option('--explain', 'explica en stderr qué se ha incluido, puntuado y recortado, y por qué', false)
    .option('--stdout', 'escribe el CV en la salida estándar en lugar de en un fichero (solo --format md)', false)
    .option('--build', 'recompila el artefacto desde las fuentes antes de generar (equivale a un «cv build» previo)', false)
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
    .option('--build', 'recompila el artefacto desde las fuentes antes de analizar (equivale a un «cv build» previo)', false)
    .action(async (offer: string, options: AnalyzeOfferOptions) => {
      onExit(await runAnalyzeOffer(context, offer, options));
    });

  const typst = program.command('typst').description('gestiona el binario de Typst (motor PDF opcional): instalación verificada y estado');
  typst
    .command('install')
    .description(`descarga el release oficial de Typst ${TYPST_VERSION} para esta plataforma, verifica su SHA-256 contra el manifiesto del repositorio y lo instala en la caché de usuario (única operación de red de cv)`)
    .option('--force', 'reinstala aunque ya exista un binario correcto', false)
    .action(async (options: TypstInstallOptions) => {
      onExit(await runTypstInstall(context, options));
    });
  typst
    .command('status')
    .description('muestra qué binario de Typst se usaría, su versión y de dónde sale')
    .action(async () => {
      onExit(await runTypstStatus(context));
    });

  const improve = program
    .command('improve')
    // Las opciones de «improve apply» (--dry-run, -d) no deben ser capturadas por «improve» (mismos nombres).
    .enablePositionalOptions()
    .description('co-piloto: propone reescrituras con más impacto para tus logros y las verifica (canon C2); escribe un fichero de revisión, nunca tus fuentes (salvo «improve apply», que aplica lo que marques)')
    .option('-s, --specialty <id>', 'solo los logros que entran en esa especialidad')
    .option('-f, --from-job-offer <file>', 'oferta (texto o PDF; «-» = stdin): solo los logros que sobreviven a la adaptación, y sus términos guían la reescritura')
    .option('-n, --top-n <n>', 'logros por experiencia/proyecto y transversales (como en generate-cv)', parseLimit)
    .option('--max-skills <n>', '(como en generate-cv)', parseLimit)
    .option('--max-projects <n>', '(como en generate-cv)', parseLimit)
    .option('--max-certifications <n>', '(como en generate-cv)', parseLimit)
    .option('--compact', 'preset de límites de generate-cv', false)
    .option('--only <ids>', 'ids de logros separados por comas')
    .option('--proposals <n>', 'propuestas por logro (1-3)', parseProposals, IMPROVE_DEFAULTS.proposals)
    .option('--max-length <n>', 'longitud máxima de cada propuesta', parseLimit, IMPROVE_DEFAULTS.maxLength)
    .option('--max-items <n>', 'logros como máximo por ejecución (presupuesto)', parseLimit, IMPROVE_DEFAULTS.maxItems)
    .option('--redact-companies', 'seudonimiza también las empresas ([EMPRESA-n])', false)
    .option('-l, --locale <locale>', 'idioma de las propuestas (por defecto, el del perfil)')
    .option('-o, --output <file>', 'fichero de revisión (por defecto output/revision-improve-<fecha>[-<esp>][-<oferta>].md)')
    .option('--no-cache', 'no leer ni guardar la caché local de respuestas')
    .option('--show-prompt', 'imprime el prompt exacto y termina', false)
    .option('--show-payload', 'imprime los fragmentos seudonimizados que saldrían', false)
    .option('--dry-run', 'no envía nada: solo dice qué saldría y a dónde', false)
    .option('-p, --profile <file>', 'ruta del artefacto', DEFAULT_ARTIFACT_PATH)
    .option('-d, --data <dir>', 'directorio de fuentes, solo para avisar si el artefacto está obsoleto', DEFAULT_DATA_DIR)
    .option('--provider <id>', 'proveedor de modelos: ollama u openai-compatible (locales) o, con consentimiento explícito de red, openai o anthropic')
    .option('--model <name>', 'modelo del proveedor elegido')
    .option('--yes', 'acepta por adelantado el aviso de coste de un proveedor remoto', false)
    .option('--build', 'recompila el artefacto antes', false)
    .action(async (options: ImproveOptions) => {
      onExit(await runImproveCommand(context, options));
    });
  improve
    .command('apply <review>')
    .description('aplica a tus fuentes las propuestas marcadas [x] en un fichero de revisión de improve o summarize: solo lo marcado, cambio mínimo, copia de seguridad previa (<fichero>.bak) y comprobación por huella (si el original cambió, no escribe nada)')
    .option('-d, --data <dir>', 'directorio de fuentes (por defecto, el registrado en la revisión o data/sources)')
    .option('--delete-review', 'elimina el fichero de revisión tras aplicarlo', false)
    .option('--dry-run', 'muestra qué cambiaría sin escribir nada', false)
    .action(async (review: string, options: Omit<ApplyOptions, 'review'>) => {
      onExit(await runApplyCommand(context, { ...options, review }));
    });

  program
    .command('summarize')
    .description('co-piloto: propone el resumen profesional a partir del perfil filtrado y lo verifica (canon C2); escribe un fichero de revisión, nunca tus fuentes')
    .option('-s, --specialty <id>', 'resumen para esa versión del CV')
    .option('-f, --from-job-offer <file>', 'oferta (texto o PDF; «-» = stdin): resumen orientado a ella con el perfil adaptado')
    .option('-n, --top-n <n>', '(como en generate-cv)', parseLimit)
    .option('--max-skills <n>', '(como en generate-cv)', parseLimit)
    .option('--max-projects <n>', '(como en generate-cv)', parseLimit)
    .option('--max-certifications <n>', '(como en generate-cv)', parseLimit)
    .option('--compact', 'preset de límites de generate-cv', false)
    .option('--paragraphs <n>', 'párrafos del resumen (1-3)', parseProposals, SUMMARIZE_DEFAULTS.paragraphs)
    .option('--proposals <n>', 'propuestas (1-3)', parseProposals, SUMMARIZE_DEFAULTS.proposals)
    .option('--max-length <n>', 'longitud máxima total de cada propuesta', parseLimit, SUMMARIZE_DEFAULTS.maxLength)
    .option('--redact-companies', 'seudonimiza también las empresas ([EMPRESA-n])', false)
    .option('-l, --locale <locale>', 'idioma del resumen (por defecto, el del perfil)')
    .option('-o, --output <file>', 'fichero de revisión (por defecto output/revision-summarize-<fecha>[-<esp>][-<oferta>].md)')
    .option('--no-cache', 'no leer ni guardar la caché local de respuestas')
    .option('--show-prompt', 'imprime el prompt exacto y termina', false)
    .option('--show-payload', 'imprime el perfil seudonimizado que saldría', false)
    .option('--dry-run', 'no envía nada: solo dice qué saldría y a dónde', false)
    .option('-p, --profile <file>', 'ruta del artefacto', DEFAULT_ARTIFACT_PATH)
    .option('-d, --data <dir>', 'directorio de fuentes, solo para avisar si el artefacto está obsoleto', DEFAULT_DATA_DIR)
    .option('--provider <id>', 'proveedor de modelos: ollama u openai-compatible (locales) o, con consentimiento explícito de red, openai o anthropic')
    .option('--model <name>', 'modelo del proveedor elegido')
    .option('--yes', 'acepta por adelantado el aviso de coste de un proveedor remoto', false)
    .option('--build', 'recompila el artefacto antes', false)
    .action(async (options: SummarizeOptions) => {
      onExit(await runSummarizeCommand(context, options));
    });

  const suggest = program.command('suggest').description('co-piloto: sugerencias estructurales a partir del diccionario cerrado del perfil (las tags de tus especialidades); nunca escribe en tus fuentes');
  suggest
    .command('tags [text]')
    .description('propone, solo del diccionario cerrado (las tags de las especialidades), las etiquetas de un texto («-» = stdin) o de los logros del perfil; imprime por stdout una lista limpia para copiarla en tus fuentes (#tag1 #tag2)')
    .option('-s, --specialty <id>', 'restringe el diccionario a las tags de esa especialidad')
    .option('--only <ids>', 'ids de logros separados por comas')
    .option('--untagged', 'solo los logros sin etiquetas', false)
    .option('--max-tags <n>', 'etiquetas como máximo por logro (1-10)', parseMaxTags, SUGGEST_TAGS_DEFAULTS.maxTags)
    .option('--max-items <n>', 'logros como máximo por ejecución (presupuesto)', parseLimit, SUGGEST_TAGS_DEFAULTS.maxItems)
    .option('--redact-companies', 'seudonimiza también las empresas ([EMPRESA-n])', false)
    .option('-l, --locale <locale>', 'idioma de las justificaciones (por defecto, el del perfil)')
    .option('--explain', 'explica cada etiqueta: evidencia calculada por código (literal, contexto, inferida), si es nueva y la justificación del modelo', false)
    .option('--no-cache', 'no leer ni guardar la caché local de respuestas')
    .option('--show-prompt', 'imprime el prompt exacto y termina', false)
    .option('--show-payload', 'imprime los fragmentos seudonimizados que saldrían', false)
    .option('--dry-run', 'no envía nada: solo dice qué saldría y a dónde', false)
    .option('-p, --profile <file>', 'ruta del artefacto', DEFAULT_ARTIFACT_PATH)
    .option('-d, --data <dir>', 'directorio de fuentes, solo para avisar si el artefacto está obsoleto', DEFAULT_DATA_DIR)
    .option('--provider <id>', 'proveedor de modelos: ollama u openai-compatible (locales) o, con consentimiento explícito de red, openai o anthropic')
    .option('--model <name>', 'modelo del proveedor elegido')
    .option('--yes', 'acepta por adelantado el aviso de coste de un proveedor remoto', false)
    .option('--build', 'recompila el artefacto antes', false)
    .action(async (text: string | undefined, options: Omit<SuggestTagsOptions, 'text'>) => {
      onExit(await runSuggestTagsCommand(context, { ...options, text }));
    });

  const llm = program.command('llm').description('co-piloto de IA (Hito 4): estado del proveedor local; nunca envía datos sin una orden explícita');
  llm
    .command('status')
    .description('muestra el proveedor local que se usaría y si responde, la procedencia de las claves remotas (nunca su valor) y la lista blanca; con --provider <remoto> comprueba también ese proveedor')
    .option('--provider <id>', 'proveedor a comprobar (openai o anthropic acceden a la red)')
    .option('--model <name>', 'modelo del proveedor a comprobar')
    .action(async (options: LlmStatusCommandOptions) => {
      onExit(await runLlmStatus(context, options));
    });
  llm
    .command('cache')
    .description('caché local de respuestas del co-piloto')
    .command('clear')
    .description('vacía la caché local de respuestas (ficheros 0600 en tu caché de usuario)')
    .action(async () => {
      onExit(await runLlmCacheClear(context));
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
