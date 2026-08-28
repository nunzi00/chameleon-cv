/**
 * TypstRenderer (T-3.2): `MasterProfile` → `StructuredView` → documento principal → Typst contenido
 * → PDF. Misma vista que pdfkit; misma fecha de creación reproducible; mismos criterios de
 * aceptación (round-trip con el golden). Devuelve un resultado, no excepciones: que falte el
 * binario o que la plantilla no compile son situaciones esperadas que la CLI traduce a códigos.
 */
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { basename, dirname, resolve } from 'node:path';

import type { MasterProfile } from '../../core/schema';
import { describeError } from '../../shared/errors';
import { DEFAULT_LOCALE } from '../markdown/renderer';
import { FONTS_DIRECTORY } from '../pdf/fonts';
import { creationDate } from '../pdf/renderer';
import { buildStructuredView } from '../structured';
import {
  TYPST_ENV_VARIABLE,
  TYPST_RELEASES_URL,
  TYPST_VERSION,
  compileTypst,
  containedEnvironment,
  locateTypst,
  runProcess,
  typstVersion,
  type CompileErrorCode,
  type LocateOptions,
  type ProcessRunner,
  type TypstLocation,
} from './engine';
import { mainDocument } from './source';

/** Plantilla base distribuida (`templates/typst/cv.typ`); su directorio es el `--root`. */
export const DEFAULT_TYPST_TEMPLATE = resolve(__dirname, '..', '..', '..', 'templates', 'typst', 'cv.typ');

export interface TypstRenderOptions extends LocateOptions {
  readonly locale?: string | undefined;
  /** Plantilla `.typ` propia; debe exportar `cv`. Por defecto la distribuida. */
  readonly template?: string | undefined;
  readonly allowAnyVersion?: boolean | undefined;
  readonly createdAt?: Date | undefined;
  readonly fontsDirectory?: string | undefined;
  readonly timeoutMs?: number | undefined;
  readonly runner?: ProcessRunner | undefined;
  readonly isReadable?: ((path: string) => Promise<boolean>) | undefined;
}

export type TypstRenderErrorCode = 'not-found' | 'version-mismatch' | 'template-unreadable' | CompileErrorCode;

export interface TypstRenderError {
  readonly code: TypstRenderErrorCode;
  readonly message: string;
}

export type TypstRenderResult =
  | { readonly ok: true; readonly pdf: Buffer; readonly binary: TypstLocation; readonly version: string }
  | { readonly ok: false; readonly error: TypstRenderError };

export async function isReadableFile(path: string): Promise<boolean> {
  try {
    await access(path, constants.R_OK);
    return true;
  } catch {
    return false;
  }
}

export function notFoundMessage(): string {
  return `No se encontró Typst ${TYPST_VERSION}: ejecuta «cv typst install», indica su ruta con --typst-path o ${TYPST_ENV_VARIABLE}, o instálalo en el PATH (${TYPST_RELEASES_URL})`;
}

export async function renderTypstCv(profile: MasterProfile, options: TypstRenderOptions = {}): Promise<TypstRenderResult> {
  const runner = options.runner ?? runProcess;
  const platform = options.platform ?? process.platform;
  const env = containedEnvironment(platform, options.env ?? process.env);

  const binary = await locateTypst(options);
  if (binary === undefined) {
    return { ok: false, error: { code: 'not-found', message: notFoundMessage() } };
  }

  const version = await typstVersion(binary.path, runner, env);
  if (!version.ok) {
    return { ok: false, error: { code: 'failed', message: `No se pudo ejecutar Typst en «${binary.path}»: ${version.message}` } };
  }
  if (version.version !== TYPST_VERSION && options.allowAnyVersion !== true) {
    return {
      ok: false,
      error: {
        code: 'version-mismatch',
        message: `Typst ${version.version} en «${binary.path}»; se requiere ${TYPST_VERSION} (o usa --typst-any-version bajo tu responsabilidad)`,
      },
    };
  }

  const template = resolve(options.template ?? DEFAULT_TYPST_TEMPLATE);
  if (!(await (options.isReadable ?? isReadableFile)(template))) {
    return { ok: false, error: { code: 'template-unreadable', message: `No se pudo leer la plantilla Typst «${template}»` } };
  }

  const locale = options.locale ?? profile.meta.locale ?? DEFAULT_LOCALE;
  const view = buildStructuredView(profile, locale);
  const created = options.createdAt ?? creationDate(profile);
  let result;
  try {
    result = await compileTypst(
      {
        binary: binary.path,
        source: mainDocument(view, `/${basename(template)}`),
        root: dirname(template),
        fontsDirectory: options.fontsDirectory ?? FONTS_DIRECTORY,
        creationTimestamp: Math.floor(created.getTime() / 1000),
        timeoutMs: options.timeoutMs,
        env,
      },
      runner,
    );
  } catch (error) {
    return { ok: false, error: { code: 'failed', message: `No se pudo ejecutar Typst: ${describeError(error)}` } };
  }
  return result.ok ? { ok: true, pdf: result.pdf, binary, version: version.version } : { ok: false, error: { code: result.code, message: result.message } };
}
