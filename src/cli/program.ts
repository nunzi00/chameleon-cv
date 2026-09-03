/**
 * Definición de la CLI `cv` con commander. `runCli` devuelve el código de salida en lugar de
 * terminar el proceso, para que la CLI completa sea testeable con un contexto inyectado.
 */
import { Command, CommanderError } from 'commander';

import { runAnalyzeOffer, type AnalyzeOfferOptions } from './commands/analyze-offer';
import { runImportCv, type ImportCvOptions } from './commands/import-cv';
import { runImportLinkedIn, type ImportLinkedInOptions } from './commands/import-linkedin';
import { runBuild, type BuildOptions } from './commands/build';
import { runGenerateCv, type GenerateCvOptions } from './commands/generate-cv';
import { runInit, type InitOptions } from './commands/init';
import { IMPROVE_DEFAULTS, runImproveCommand, runLlmCacheClear, type ImproveOptions } from './commands/improve';
import { runApplyCommand, runArchiveCommand, runUndoCommand, type ApplyOptions } from './commands/apply';
import { runHistoryList, runHistoryRestore, runHistoryShow, type HistoryOptions } from './commands/history';
import { type LlmRuntimeCommandOptions, type LlmStatusCommandOptions, runLlmDown, runLlmKeyList, runLlmKeyRemove, runLlmKeySet, runLlmModels, runLlmStatus, runLlmUp } from './commands/llm';
import { SUGGEST_TAGS_DEFAULTS, parseMaxTags, runSuggestTagsCommand, type SuggestTagsOptions } from './commands/suggest-tags';
import { SUMMARIZE_DEFAULTS, runSummarizeCommand, type SummarizeOptions } from './commands/summarize';
import { runThemeCreate, runThemeInstall, runThemeList, runThemePath, runThemeVerify, type ThemeCreateOptions, type ThemeInstallCliOptions, type ThemeListOptions } from './commands/theme';
import { DEFAULT_THEME } from '../themes';
import { runTypstInstall, runTypstStatus, type TypstInstallOptions } from './commands/typst';
import { runValidate, type ValidateOptions } from './commands/validate';
import { runExport, runImport, type ExportOptions, type ImportOptions } from './commands/portability';
import { parsePort, runServe, type ServeCommandOptions } from './commands/serve';
import { parseEngine, parseFormat } from './format';
import type { CliContext } from './context';
import { DEFAULT_ARTIFACT_PATH, DEFAULT_DATA_DIR, DEFAULT_OUTPUT_DIR } from './defaults';
import { parseLimit, parseList, parseProposals } from './limits';
import { runImportManfred, type ImportManfredOptions } from './commands/import-manfred';
import { runDraftsAdopt, runDraftsDuplicates, runDraftsList, runDraftsShow, type DraftsAdoptOptions, type DraftsListOptions } from './commands/drafts';
import { runDuplicatesList, runDuplicatesResolve, type DuplicatesListOptions, type DuplicatesResolveOptions } from './commands/duplicates';
import { EXIT_FAILURE, EXIT_OK } from './output';
import { readVersion } from './version';
import { TYPST_VERSION } from '../renderers/typst';
import { REMOTE_PROVIDER_IDS } from '../llm';

export function createProgram(context: CliContext, onExit: (code: number) => void, version: string): Command {
  const program = new Command().enablePositionalOptions()
    .name('cv')
    .description('Chameleon CV: genera CVs dinámicos y personalizados a partir de tus fuentes Markdown y CSV. Todo se procesa en local.')
    .version(version, '-V, --version', 'muestra la versión')
    .helpOption('-h, --help', 'muestra esta ayuda')
    .exitOverride()
    .configureOutput({ writeOut: context.stdout, writeErr: context.stderr });

  program
    .command('init')
    .description('crea un espacio de trabajo: data/sources con un dataset de ejemplo y un .gitignore; nunca sobrescribe nada')
    .argument('[dir]', 'directorio del espacio de trabajo', '.')
    .option('--template <dir>', 'dataset de ejemplo alternativo (por defecto, el distribuido)')
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
    .command('export')
    .description('exporta el perfil canónico (el mismo JSON que data/dist/profile.json) desde las fuentes, sin necesitar cv build: por la salida estándar o en un fichero (-o)')
    .option('-d, --data <dir>', 'directorio de fuentes', DEFAULT_DATA_DIR)
    .option('-o, --output <file>', 'fichero de salida (0600) en lugar de la salida estándar')
    .action(async (options: ExportOptions) => {
      onExit(await runExport(context, options));
    });

  program
    .command('import')
    .description('regenera las fuentes Markdown/CSV a partir de un perfil canónico en JSON (la inversa de cv build), comprobando antes que cv build las leería igual; solo en un directorio vacío o con --replace')
    .argument('<file>', 'perfil en JSON («-» = entrada estándar)')
    .option('-d, --data <dir>', 'directorio de fuentes de destino', DEFAULT_DATA_DIR)
    .option('--replace', 'sustituye un directorio con contenido tras renombrarlo entero como copia de seguridad (<dir>.<marca>.bak)', false)
    .option('--dry-run', 'muestra el plan y el resultado del auto-chequeo sin escribir nada', false)
    .action(async (file: string, options: ImportOptions) => {
      onExit(await runImport(context, file, options));
    });

  program
    .command('generate-cv')
    .description(`genera el CV en Markdown a partir del artefacto (por defecto en ${DEFAULT_OUTPUT_DIR}/cv-<nombre>[-<especialidad>][-<oferta>].md)`)
    .option('-s, --specialty <id>', 'especialidad: elige la versión del CV (titular, resumen y filtro); sin ella, el CV completo')
    .option('-f, --from-job-offer <file>', 'oferta en texto, PDF, «-» (entrada estándar) o URL https (exige --allow-remote): afina el CV puntuando y reordenando')
    .option('--allow-remote', 'permite descargar la oferta cuando -f es una URL https (una petición, con confirmación)', false)
    .option('--yes', 'no pregunta antes de descargar la URL', false)
    .option('--save-offer [ruta]', 'guarda el texto descargado en offers/ con cabecera de origen')
    .option('--replace', 'con --save-offer, sustituye el fichero si ya existe', false)
    .option('-n, --top-n <n>', 'logros por experiencia/proyecto y logros transversales', parseLimit)
    .option('--max-skills <n>', 'skills como máximo', parseLimit)
    .option('--max-projects <n>', 'proyectos como máximo', parseLimit)
    .option('--max-certifications <n>', 'certificaciones como máximo', parseLimit)
    .option('--skills <lista>', 'solo estas skills (nombres o ids separados por comas), antes de --max-skills; las desconocidas se avisan', parseList)
    .option('--projects <lista>', 'solo estos proyectos (nombres o ids separados por comas), antes de --max-projects; los desconocidos se avisan', parseList)
    .option('--exclude-skills <lista>', 'todas las skills menos estas (nombres o ids separados por comas); se aplica tras --skills', parseList)
    .option('--exclude-projects <lista>', 'todos los proyectos menos estos (nombres o ids separados por comas); se aplica tras --projects', parseList)
    .option('--compact', 'preset: --top-n 4 --max-skills 12 --max-projects 4 --max-certifications 5 (los límites explícitos prevalecen)', false)
    .option('--no-keep-evidence', 'con oferta, no proteger de los límites las evidencias que demuestran requisitos (por defecto se conservan)')
    .option('-p, --profile <file>', 'ruta del artefacto', DEFAULT_ARTIFACT_PATH)
    .option('-d, --data <dir>', 'directorio de fuentes, solo para avisar si el artefacto está obsoleto', DEFAULT_DATA_DIR)
    .option('-o, --output <file>', 'fichero de salida')
    .option('--format <fmt>', 'formato de salida: md, pdf (para entregar) u odt (documento abierto, para seguir editándolo en LibreOffice, Word o Google Docs)', parseFormat, 'md')
    .option('--engine <engine>', 'motor de --format pdf: pdfkit (por defecto, sin dependencias) o typst (binario oficial, calidad editorial)', parseEngine, 'pdfkit')
    .option('--typst-path <file>', 'binario de Typst (por defecto: CHAMELEON_TYPST, la caché de usuario o el PATH)')
    .option('--typst-any-version', 'acepta una versión de Typst distinta de la fijada', false)
    .option('--theme <name>', 'tema de diseño para --engine typst: themes/<name>/ del proyecto o de los distribuidos (por defecto «default»)')
    .option('-t, --template <file>', 'plantilla propia: Handlebars con --format md (por defecto templates/cv.md.hbs), .typ con --engine typst (por defecto templates/typst/cv.typ)')
    .option('-l, --locale <locale>', 'idioma de etiquetas y fechas (por defecto, el del perfil o «es»)')
    .option('--explain', 'explica en stderr qué se ha incluido, puntuado y recortado, y por qué', false)
    .option('--stdout', 'escribe el CV en la salida estándar en lugar de en un fichero (solo --format md)', false)
    .option('--build', 'recompila el artefacto desde las fuentes antes de generar (equivale a un «cv build» previo)', false)
    .action(async (options: GenerateCvOptions) => {
      onExit(await runGenerateCv(context, options));
    });

  program
    .command('import-cv')
    .description('importa un CV ya maquetado (PDF o DOCX) como borrador de fuentes en import/<nombre>/, con informe de lo reconocido; nunca escribe en data/sources/')
    .argument('<fichero>', 'el CV a importar (.pdf o .docx); con --all, la carpeta que los contiene')
    .option('-n, --name <nombre>', 'carpeta destino dentro de import/ (por defecto, el nombre del perfil o del fichero)')
    .option('--replace', 'sustituye un borrador existente con el mismo nombre, apartándolo entero como copia (import/<nombre>.<marca>.bak)', false)
    .option('--all', 'el argumento es una carpeta: importa todos los CV que haya en ella (primer nivel) y compara el resultado en una tabla', false)
    .option('--copilot', 'pide al co-piloto que PROPONGA sección para las líneas sin situar (van al README, no se aplican)', false)
    .option('--provider <id>', 'proveedor del co-piloto para --copilot (por defecto, el configurado)')
    .option('--model <modelo>', 'modelo del co-piloto para --copilot')
    .option('--yes', 'con --copilot y un proveedor remoto, confirma el envío por adelantado', false)
    .action(async (file: string, options: ImportCvOptions) => {
      onExit(await runImportCv(context, file, options));
    });

  program
    .command('import-linkedin')
    .description('importa la exportación oficial de datos de LinkedIn (el zip de «Obtener una copia de tus datos») como borrador en import/<nombre>/; datos estructurados, sin red y sin adivinar maquetación')
    .argument('<archivo>', 'el zip de la exportación de LinkedIn')
    .option('-n, --name <nombre>', 'carpeta destino dentro de import/ (por defecto, el nombre del perfil o del fichero)')
    .option('--replace', 'sustituye un borrador existente con el mismo nombre, apartándolo entero como copia (import/<nombre>.<marca>.bak)', false)
    .action(async (file: string, options: ImportLinkedInOptions) => {
      onExit(await runImportLinkedIn(context, file, options));
    });

  program
    .command('import-manfred')
    .description('importa un MAC de Manfred (el JSON de «Manfred Awesome CV») como borrador en import/<nombre>/; datos estructurados, sin red y sin adivinar maquetación')
    .argument('<fichero>', 'el MAC exportado (.json)')
    .option('-n, --name <nombre>', 'carpeta destino dentro de import/ (por defecto, el nombre del perfil o del fichero)')
    .option('--replace', 'sustituye un borrador existente con el mismo nombre, apartándolo entero como copia (import/<nombre>.<marca>.bak)', false)
    .action(async (file: string, options: ImportManfredOptions) => {
      onExit(await runImportManfred(context, file, options));
    });

  program
    .command('analyze-offer')
    .description('analiza una oferta contra el perfil sin generar nada: adecuación, evidencias y carencias; sin argumento, lista offers/')
    .argument('[offer]', 'fichero de texto o PDF, «-» para la entrada estándar, o una URL https (exige --allow-remote)')
    .argument('[más...]', 'más ofertas, solo con --rank: se comparan entre sí')
    .option('-s, --specialty <id>', 'especialidad real con la que analizar; sin ella, la virtual de la oferta')
    .option('-p, --profile <file>', 'ruta del artefacto', DEFAULT_ARTIFACT_PATH)
    .option('-d, --data <dir>', 'directorio de fuentes, solo para avisar si el artefacto está obsoleto', DEFAULT_DATA_DIR)
    .option('--explain', 'añade la auditoría por ítem', false)
    .option('--json', 'salida estructurada para scripts', false)
    .option('--build', 'recompila el artefacto desde las fuentes antes de analizar (equivale a un «cv build» previo)', false)
    .option('--copilot', 'pide además al co-piloto que lea la oferta y proponga etiquetas de TU perfil que el emparejado literal no vio; verificadas contra tu vocabulario, nunca deciden el CV', false)
    .option('--provider <id>', 'proveedor del co-piloto para --copilot (por defecto, el configurado)')
    .option('--model <modelo>', 'modelo del co-piloto para --copilot')
    .option('--save-aliases', 'guarda en skills.csv, como alias de tu skill, la frase que el co-piloto tuvo que tender: la próxima vez se reconoce sin modelo (solo con --copilot)')
    .option('--allow-remote', 'permite descargar la oferta cuando el origen es una URL https (una petición, con confirmación)', false)
    .option('--yes', 'no pregunta antes de descargar la URL (para scripts y sin terminal)', false)
    .option('--save-offer [ruta]', 'guarda el texto descargado en offers/ (nombre automático, o la ruta indicada) con cabecera de origen')
    .option('--replace', 'con --save-offer, sustituye el fichero si ya existe', false)
    .option('--list', 'lista offers/ y sale con código 0', false)
    .option('--rank', 'compara varias ofertas en una tabla (adecuación, imprescindibles, especialidad y carencias), de la que mejor encaja a la que menos', false)
    .action(async (offer: string | undefined, extra: string[], options: AnalyzeOfferOptions) => {
      onExit(await runAnalyzeOffer(context, offer, extra, options));
    });

  const drafts = program.command('drafts').description('los borradores de import/: verlos, comparar sus duplicados y adoptar entradas sueltas en data/sources/ (T-9.19)');
  drafts
    .command('list', { isDefault: true })
    .description('lista los borradores de import/ con su origen, lo que reconoció cada uno y lo que dejó en el informe')
    .action(async () => {
      onExit(await runDraftsList(context));
    });
  drafts
    .command('show <nombre>')
    .description('las experiencias, formaciones y proyectos de un borrador, con el id que hay que señalar para adoptarlos')
    .action(async (name: string) => {
      onExit(await runDraftsShow(context, name));
    });
  drafts
    .command('duplicates')
    .description('agrupa las entradas que parecen la misma cosa, entre borradores y contra tus fuentes de hoy; enseña los grupos, no fusiona ninguno')
    .option('-d, --data <dir>', 'directorio de fuentes con el que comparar', DEFAULT_DATA_DIR)
    .action(async (options: DraftsListOptions) => {
      onExit(await runDraftsDuplicates(context, options));
    });
  drafts
    .command('adopt <nombre>')
    .description('copia en data/sources/ las entradas señaladas del borrador, como ficheros NUEVOS con id libre; nunca sobrescribe una fuente tuya y no escribe nada si el perfil resultante no valida')
    .option('--entry <id...>', 'ids de las entradas a adoptar (repetible)')
    .option('--section <seccion>', 'adopta toda una sección del borrador: experience, education o projects')
    .option('-d, --data <dir>', 'directorio de fuentes de destino', DEFAULT_DATA_DIR)
    .option('--dry-run', 'enseña lo que escribiría sin escribir nada', false)
    .action(async (name: string, options: DraftsAdoptOptions) => {
      onExit(await runDraftsAdopt(context, name, options));
    });

  const duplicates = program.command('duplicates').description('lo que está repetido en TUS fuentes y cómo resolverlo (T-9.20); adoptar de varios borradores el mismo empleo es lo que lo crea');
  duplicates
    .command('list', { isDefault: true })
    .description('agrupa las entradas de data/sources que parecen la misma cosa; enseña los grupos con su id y su fichero, y no toca nada')
    .option('-d, --data <dir>', 'directorio de fuentes', DEFAULT_DATA_DIR)
    .action(async (options: DuplicatesListOptions) => {
      onExit(await runDuplicatesList(context, options));
    });
  duplicates
    .command('resolve <id>')
    .description('la entrada <id> se queda y absorbe de las señaladas SOLO los datos que le faltan; las absorbidas se borran y todo queda en el histórico, así que «cv history restore» lo deshace')
    .option('--absorb <id...>', 'ids de las entradas que se absorben y se borran (repetible)')
    .option('-d, --data <dir>', 'directorio de fuentes', DEFAULT_DATA_DIR)
    .option('--dry-run', 'enseña lo que haría sin escribir ni borrar nada', false)
    .action(async (keep: string, options: DuplicatesResolveOptions) => {
      onExit(await runDuplicatesResolve(context, keep, options));
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
    .option('--allow-new-numbers', 'admite cifras que no estén en tus fuentes: se aceptan pero se avisan una a una para que las compruebes (por defecto se rechazan, C2)', false)
    .option('-l, --locale <locale>', 'idioma de las propuestas (por defecto, el del perfil)')
    .option('-o, --output <file>', 'fichero de revisión (por defecto output/revision-improve-<fecha>[-<esp>][-<oferta>].md)')
    .option('--no-cache', 'no leer ni guardar la caché local de respuestas')
    .option('--no-wait-quota', 'si el proveedor agota la cuota y dice cuánto esperar, no esperar: detener la tanda a la primera (por defecto se espera y se reintenta hasta dos veces)')
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
    .option('--no-archive', 'deja la revisión donde está; por defecto, la que ya no deja nada pendiente se aparta a revisiones-archivadas/')
    .option('--dry-run', 'muestra qué cambiaría sin escribir nada', false)
    .action(async (review: string, options: Omit<ApplyOptions, 'review'>) => {
      onExit(await runApplyCommand(context, { ...options, review }));
    });
  improve
    .command('archive <review>')
    .description('aparta una revisión a revisiones-archivadas/, junto al directorio en el que está: deja de salir en la lista sin borrarse')
    .action(async (review: string) => {
      onExit(await runArchiveCommand(context, review, true));
    });
  improve
    .command('unarchive <review>')
    .description('devuelve a la vista una revisión archivada')
    .action(async (review: string) => {
      onExit(await runArchiveCommand(context, review, false));
    });
  improve
    .command('undo <review>')
    .description('deshace la última aplicación de esa revisión: devuelve cada fuente a como estaba (la versión de ahora queda en el histórico) y saca la revisión del archivo')
    .action(async (review: string) => {
      onExit(await runUndoCommand(context, review));
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
    .option('--allow-new-numbers', 'admite cifras que no estén en tus fuentes: se aceptan pero se avisan una a una para que las compruebes (por defecto se rechazan, C2)', false)
    .option('-l, --locale <locale>', 'idioma del resumen (por defecto, el del perfil)')
    .option('-o, --output <file>', 'fichero de revisión (por defecto output/revision-summarize-<fecha>[-<esp>][-<oferta>].md)')
    .option('--no-cache', 'no leer ni guardar la caché local de respuestas')
    .option('--no-wait-quota', 'si el proveedor agota la cuota y dice cuánto esperar, no esperar: detener la tanda a la primera (por defecto se espera y se reintenta hasta dos veces)')
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
    .option('--no-wait-quota', 'si el proveedor agota la cuota y dice cuánto esperar, no esperar: detener la tanda a la primera (por defecto se espera y se reintenta hasta dos veces)')
    .option('--apply', 'escribe en tus fuentes las etiquetas nuevas que aceptes (con terminal se pregunta una a una; deja copia .bak y hay que recompilar)', false)
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

  const theme = program.command('theme').description('temas de diseño de Typst: los distribuidos y los de themes/<nombre>/ de tu proyecto (T-5.1–T-5.3)');
  theme
    .command('list')
    .description('lista los temas disponibles: nombre, origen (distribuido, del proyecto o instalado), descripción, autoría y cuál es el tema por defecto')
    .option('--verify', 'recalcula las huellas de los temas instalados y marca los modificados', false)
    .action(async (options: ThemeListOptions) => {
      onExit(await runThemeList(context, options));
    });
  theme
    .command('path <name>')
    .description('imprime la ruta absoluta del directorio del tema, para copiarlo o editarlo')
    .action(async (name: string) => {
      onExit(await runThemePath(context, name));
    });
  theme
    .command('create <name>')
    .description('crea themes/<name>/ en tu proyecto a partir de un tema existente (theme.toml con el nuevo nombre y template.typ); nunca sobrescribe')
    .option('--from <theme>', 'tema del que partir', DEFAULT_THEME)
    .action(async (name: string, options: ThemeCreateOptions) => {
      onExit(await runThemeCreate(context, name, options));
    });
  theme
    .command('install <source>')
    .description(
      'instala en themes/<nombre>/ un tema de la comunidad desde una URL https a un .zip o .tar.gz (pide consentimiento antes de descargar) o desde un archivo o directorio local; lee el archivo en el propio proceso con una política cerrada, valida theme.toml, fija el origen y las huellas en .origin.json y nunca sobrescribe (T-8.3)',
    )
    .option('--as <name>', 'nombre del tema en el proyecto (por defecto, theme.name o el directorio raíz del archivo)')
    .option('--sha256 <hash>', 'huella SHA-256 del archivo publicada por su autor; si no coincide, no se instala')
    .option('--dry-run', 'muestra el plan (entradas, tamaños, huellas y nombre) sin escribir nada', false)
    .option('--replace', 'aparta un tema existente con ese nombre a themes/<nombre>.<marca>.bak/ antes de instalar', false)
    .option('--yes', 'acepta por adelantado el aviso de descarga', false)
    .action(async (source: string, options: ThemeInstallCliOptions) => {
      onExit(await runThemeInstall(context, source, options));
    });
  theme
    .command('verify [name]')
    .description('recalcula las huellas de un tema instalado (o de todos los del proyecto) y las compara con su .origin.json: intacto, modificado localmente o sin origen; código 1 si hay diferencias')
    .action(async (name: string | undefined) => {
      onExit(await runThemeVerify(context, name));
    });

  program
    .command('serve')
    .description('arranca el servidor local: la interfaz web en / y la API en /api/v1 sobre el espacio de trabajo; solo 127.0.0.1, token de sesión, sin CORS; Ctrl-C para parar')
    .option('--port <n>', 'puerto (0 = efímero)', parsePort, 4310)
    .option('--host <host>', 'dirección de escucha; 0.0.0.0 solo dentro de un contenedor cuyo puerto publique Docker en el loopback del anfitrión', '127.0.0.1')
    .option('--workspace <dir>', 'espacio de trabajo (por defecto, el directorio actual)')
    .option('-d, --data <dir>', 'directorio de fuentes', DEFAULT_DATA_DIR)
    .option('-p, --profile <file>', 'ruta del artefacto', DEFAULT_ARTIFACT_PATH)
    .option('--api-only', 'sin la página de inicio: solo /api/v1', false)
    .option('--open', 'abre el navegador con la URL y el token', false)
    .option('--allowed-hosts <hosts>', 'valores de Host admitidos además de 127.0.0.1 y localhost (separados por comas)')
    .option('--allow-remote', 'permite proveedores remotos en los trabajos del co-piloto (cada uno exige confirmar el coste estimado)')
    .option('--no-allow-remote', 'los prohíbe aunque cv.toml los permita: la bandera siempre gana sobre [serve] allow_remote')
    .action(async (options: ServeCommandOptions, command: Command) => {
      // Sin bandera explícita, `runServe` consulta `[serve] allow_remote` de cv.toml (T-8.17).
      const explicit = command.getOptionValueSource('allowRemote') === 'cli';
      onExit(await runServe(context, { ...options, allowRemote: explicit ? options.allowRemote === true : undefined }));
    });

  const history = program.command('history').description('histórico de versiones de las fuentes (output/historial-fuentes): lo que cv improve apply y cv history restore dejaron antes de escribir');
  history
    .option('--json', 'las entradas en JSON')
    .action(async (options: HistoryOptions) => {
      onExit(await runHistoryList(context, options));
    });
  history
    .command('show')
    .description('imprime la versión guardada de una fuente en una entrada del histórico')
    .argument('<entrada>', 'id de la entrada (cv history)')
    .argument('<ruta>', 'ruta relativa al directorio de fuentes (experience/acme.md)')
    .action(async (entry: string, path: string) => {
      onExit(await runHistoryShow(context, entry, path));
    });
  history
    .command('restore')
    .description('escribe la versión guardada sobre la fuente; la versión actual queda a su vez en el histórico')
    .argument('<entrada>', 'id de la entrada (cv history)')
    .argument('<ruta>', 'ruta relativa al directorio de fuentes')
    .action(async (entry: string, path: string) => {
      onExit(await runHistoryRestore(context, entry, path));
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
    .command('up')
    .description('arranca el Ollama local (ollama serve o un contenedor Docker con la imagen fijada) y descarga el modelo configurado si falta; nunca toca un Ollama ajeno')
    .option('--model <name>', 'modelo para este arranque (por defecto, el configurado)')
    .option('--runner <runner>', 'native o docker; por defecto native si hay ollama, si no docker')
    .option('--no-pull', 'no descargar el modelo si falta')
    .option('--source <origen>', 'de dónde descargar: ollama (registro, con el espejo de Hugging Face del catálogo como reserva) o huggingface (directo al espejo)')
    .option('--json', 'resultado en JSON (estado, líneas de progreso y, si falla, código y mensaje)')
    .action(async (options: LlmRuntimeCommandOptions) => {
      onExit(await runLlmUp(context, options));
    });
  llm
    .command('models')
    .description('catálogo de modelos locales (familia, razonamiento, tamaño, RAM, licencia, tareas y espejo) con lo que hay descargado en el Ollama configurado')
    .option('--json', 'catálogo y estado en JSON')
    .action(async (options: LlmRuntimeCommandOptions) => {
      onExit(await runLlmModels(context, options));
    });
  llm
    .command('down')
    .description('para el Ollama que arrancó cv (proceso propio o contenedor chameleon-ollama, que se conserva con sus modelos); nunca uno ajeno')
    .option('--json', 'resultado en JSON')
    .action(async (options: LlmRuntimeCommandOptions) => {
      onExit(await runLlmDown(context, options));
    });
  const key = llm.command('key').description('claves de los proveedores remotos: se guardan en tu fichero de claves (0600) y nunca se muestran');
  key
    .command('set')
    .description('guarda la clave de un proveedor remoto; la pide sin eco en la terminal o la lee de la entrada estándar (nunca como argumento)')
    .argument('<provider>', `proveedor remoto (${REMOTE_PROVIDER_IDS.join(', ')})`)
    .action(async (provider: string) => {
      onExit(await runLlmKeySet(context, provider));
    });
  key
    .command('remove')
    .description('elimina la clave de un proveedor remoto del fichero de claves')
    .argument('<provider>', 'proveedor remoto')
    .action(async (provider: string) => {
      onExit(await runLlmKeyRemove(context, provider));
    });
  key
    .command('list')
    .description('de dónde sale cada clave (entorno, fichero o ninguna); nunca su valor')
    .action(async () => {
      onExit(await runLlmKeyList(context));
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
  // La versión sale de los assets (package.json del repositorio o del binario), no de una ruta fija (T-6.2).
  const version = readVersion(await context.assets.text('package.json'));
  const program = createProgram(
    context,
    (code) => {
      exitCode = code;
    },
    version,
  );
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
