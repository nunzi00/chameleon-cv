/**
 * Generar el CV (`docs/trimming-cli.md` §4): artefacto → (oferta) → selección → puntuación → recorte →
 * renderer. Devuelve el documento y un informe estructurado; no imprime nada y solo escribe si el
 * cliente se lo pide (`writeCvFile`). La CLI reproduce con él su salida byte a byte.
 */
import { dirname, resolve } from 'node:path';

import type { MasterProfile } from '../core/schema';
import { applyLimits, type MatchReport, type RemovedItem, type SectionLimits } from '../core/scoring';
import type { SelectionReport } from '../core/selection';
import { loadFonts, renderMarkdownCv, renderPdfCv, type TypstRenderErrorCode } from '../renderers';
import { describeError } from '../shared/errors';
import { DEFAULT_THEME, applyThemeOverrides, loadProjectConfig, loadTheme, overriddenKeys } from '../themes';
import { projectThemeRoots } from './assets';
import type { AppContext } from './context';
import { buildProfile, loadProfile } from './dataset';
import { DEFAULT_OUTPUT_DIR } from './defaults';
import { dataError, environmentError, errorWithExit, type AppError } from './errors';
import type { CvEngine, CvFormat } from './format';
import { checkArtifactFreshness, freshnessWarning, type AppWarning } from './freshness';
import { resolveLimits, type LimitOptions } from './limits';
import { readOffer, type OfferInput, type OfferText } from './offer';
import { slugify } from './slug';
import { tailorProfile } from './tailor';

/** El CV contiene datos personales: solo el propietario puede leerlo. */
export const OUTPUT_MODE = 0o600;

export interface GenerateRequest extends LimitOptions {
  readonly profile: string;
  readonly data: string;
  readonly specialty?: string | undefined;
  readonly offer?: OfferInput | undefined;
  /** Fichero de salida (relativo al directorio de trabajo); por defecto `output/cv-<nombre>[-<especialidad>][-<oferta>].<formato>`. */
  readonly output?: string | undefined;
  /** Plantilla propia: Handlebars con `md`, `.typ` con el motor Typst. */
  readonly templatePath?: string | undefined;
  readonly locale?: string | undefined;
  readonly format: CvFormat;
  readonly engine: CvEngine;
  readonly typstPath?: string | undefined;
  readonly typstAnyVersion: boolean;
  readonly theme?: string | undefined;
  /** Recompila el artefacto desde las fuentes antes de generar. */
  readonly build: boolean;
}

export interface ThemeReport {
  readonly name: string;
  readonly builtin: boolean;
  readonly overridden: readonly string[];
}

export interface GenerateReport {
  readonly selection: SelectionReport | undefined;
  readonly match: MatchReport | undefined;
  readonly limits: SectionLimits;
  readonly removed: readonly RemovedItem[];
  readonly profileBeforeTrim: MasterProfile;
  /** Solo con el motor Typst, en cuanto se resuelve el tema (antes de renderizar). */
  theme: ThemeReport | undefined;
}

export type GeneratedCv =
  | { readonly kind: 'md'; readonly outputPath: string; readonly markdown: string }
  | { readonly kind: 'pdf'; readonly outputPath: string; readonly pdf: Buffer };

export type GenerateResult =
  | { readonly ok: true; readonly cv: GeneratedCv; readonly report: GenerateReport; readonly warnings: readonly AppWarning[] }
  | { readonly ok: false; readonly error: AppError; readonly report: GenerateReport | undefined; readonly warnings: readonly AppWarning[] };

/** `output/cv-<nombre>[-<especialidad>][-<oferta>].<formato>`, relativo al directorio de trabajo. */
export function defaultOutputPath(profile: MasterProfile, specialty: string | undefined, offer?: string, format: CvFormat = 'md'): string {
  const name = slugify(profile.personal.fullName) || 'perfil';
  const specialtySuffix = specialty === undefined ? '' : `-${specialty}`;
  const offerSuffix = offer === undefined ? '' : `-${offer}`;
  return `${DEFAULT_OUTPUT_DIR}/cv-${name}${specialtySuffix}${offerSuffix}.${format}`;
}

/** La plantilla Typst que no compila es un problema de datos (1); binario ausente, versión, tiempo o proceso, del entorno (2). */
export function typstExitCode(code: TypstRenderErrorCode): 1 | 2 {
  return code === 'compile-error' || code === 'theme-invalid' ? 1 : 2;
}

type PdfOutcome = { readonly ok: true; readonly pdf: Buffer } | { readonly ok: false; readonly error: AppError };

async function renderWithTypst(context: AppContext, profile: MasterProfile, request: GenerateRequest, report: GenerateReport): Promise<PdfOutcome> {
  // Tema (T-5.1) y anulaciones de cv.toml (T-5.2): --theme > cv.toml [theme].name > default; theme.toml + [theme] de cv.toml, revalidado.
  const project = await loadProjectConfig(context.cwd, context.datasetFileSystem);
  if (!project.ok) {
    return { ok: false, error: dataError(project.message) };
  }
  const overrides = project.config?.theme;
  const loaded = await loadTheme(request.theme ?? overrides?.name ?? DEFAULT_THEME, await projectThemeRoots(context));
  if (!loaded.ok) {
    return { ok: false, error: dataError(loaded.message) };
  }
  const theme = applyThemeOverrides(loaded.theme, overrides);
  report.theme = { name: theme.name, builtin: theme.builtin, overridden: overriddenKeys(overrides) };
  const result = await context.typstRenderer(profile, {
    locale: request.locale,
    template: request.templatePath === undefined ? undefined : resolve(context.cwd, request.templatePath),
    explicitPath: request.typstPath === undefined ? undefined : resolve(context.cwd, request.typstPath),
    allowAnyVersion: request.typstAnyVersion,
    theme,
    fontsDirectory: await context.assets.directory('templates/fonts'),
  });
  if (result.ok) {
    return { ok: true, pdf: result.pdf };
  }
  const message = result.error.code === 'compile-error' ? `La plantilla Typst no compiló:\n${result.error.message}` : result.error.message;
  return { ok: false, error: errorWithExit(message, typstExitCode(result.error.code)) };
}

export async function generateCv(context: AppContext, request: GenerateRequest): Promise<GenerateResult> {
  const warnings: AppWarning[] = [];
  const artifactPath = resolve(context.cwd, request.profile);
  if (request.build) {
    const built = await buildProfile(context, { data: request.data, out: request.profile, check: false });
    if (!built.ok) {
      return { ok: false, error: built.error, report: undefined, warnings };
    }
  }
  const loaded = await loadProfile(context, request);
  if (!loaded.ok) {
    return { ok: false, error: loaded.error, report: undefined, warnings };
  }
  if (!request.build) {
    const warning = freshnessWarning(await checkArtifactFreshness(context.datasetFileSystem, artifactPath, resolve(context.cwd, request.data)));
    if (warning !== undefined) {
      warnings.push(warning);
    }
  }
  let offer: OfferText | undefined;
  if (request.offer !== undefined) {
    const read = await readOffer(context, request.offer);
    if (!read.ok) {
      return { ok: false, error: read.error, report: undefined, warnings };
    }
    offer = read.offer;
  }
  const tailored = tailorProfile(loaded.profile, { specialty: request.specialty, offer });
  if (!tailored.ok) {
    return { ok: false, error: tailored.error, report: undefined, warnings };
  }
  const limits = resolveLimits(request);
  const trimmed = applyLimits(tailored.tailored.profile, limits, tailored.tailored.scoreOf);
  const report: GenerateReport = { selection: tailored.tailored.selection, match: tailored.tailored.match, limits, removed: trimmed.removed, profileBeforeTrim: tailored.tailored.profile, theme: undefined };
  const outputPath = resolve(context.cwd, request.output ?? defaultOutputPath(trimmed.profile, request.specialty, tailored.tailored.offerName, request.format));

  if (request.format === 'pdf') {
    const rendered = request.engine === 'typst' ? await renderWithTypst(context, trimmed.profile, request, report) : { ok: true as const, pdf: await renderPdfCv(trimmed.profile, { locale: request.locale, fonts: await loadFonts(context.assets) }) };
    return rendered.ok ? { ok: true, cv: { kind: 'pdf', outputPath, pdf: rendered.pdf }, report, warnings } : { ok: false, error: rendered.error, report, warnings };
  }

  let template: string;
  if (request.templatePath === undefined) {
    template = await context.assets.text('templates/cv.md.hbs');
  } else {
    const templatePath = resolve(context.cwd, request.templatePath);
    try {
      template = await context.datasetFileSystem.readTextFile(templatePath);
    } catch (error) {
      return { ok: false, error: environmentError(`No se pudo leer la plantilla «${templatePath}»: ${describeError(error)}`), report, warnings };
    }
  }
  return { ok: true, cv: { kind: 'md', outputPath, markdown: renderMarkdownCv(trimmed.profile, { locale: request.locale, template }) }, report, warnings };
}

/** Escribe el CV generado (0600) creando el directorio; `undefined` si todo fue bien. */
export async function writeCvFile(context: Pick<AppContext, 'artifactFileSystem'>, cv: GeneratedCv): Promise<AppError | undefined> {
  try {
    await context.artifactFileSystem.mkdir(dirname(cv.outputPath));
    if (cv.kind === 'pdf') {
      await context.artifactFileSystem.writeBinaryFile(cv.outputPath, cv.pdf, OUTPUT_MODE);
    } else {
      await context.artifactFileSystem.writeFile(cv.outputPath, cv.markdown, OUTPUT_MODE);
    }
  } catch (error) {
    return environmentError(`No se pudo escribir el CV en «${cv.outputPath}»: ${describeError(error)}`);
  }
  return undefined;
}
