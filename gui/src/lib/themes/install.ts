/**
 * «Instalar tema…» (T-8.3, docs/theme-gallery.md §4.5): los dos rechazos de una instalación desde URL (403 sin
 * --allow-remote y 409 con el consentimiento pendiente), el resumen de lo instalado y la etiqueta de cada tema en
 * el selector (autoría y origen).
 */
import { ApiError } from '../api/client';
import type { ThemeInstallResponse, ThemesResponse } from '../api/types';

export type InstallProblem =
  | { readonly kind: 'remote-disabled'; readonly message: string }
  | { readonly kind: 'consent-required'; readonly message: string; readonly estimateId: string; readonly source: string; readonly host: string; readonly limit: string };

function megabytes(bytes: unknown): string {
  return typeof bytes === 'number' ? `${Math.round(bytes / 1024 / 1024)} MiB` : 'límite del servidor';
}

export function installProblem(error: unknown): InstallProblem | undefined {
  if (!(error instanceof ApiError)) {
    return undefined;
  }
  if (error.code === 'remote-disabled') {
    return { kind: 'remote-disabled', message: error.message };
  }
  if (error.code === 'consent-required' && typeof error.details['estimateId'] === 'string') {
    return {
      kind: 'consent-required',
      message: error.message,
      estimateId: error.details['estimateId'],
      source: typeof error.details['source'] === 'string' ? error.details['source'] : '',
      host: typeof error.details['host'] === 'string' ? error.details['host'] : '',
      limit: megabytes(error.details['limitBytes']),
    };
  }
  return undefined;
}

/** Una línea para el aviso: qué se ha hecho (o se haría), con la huella para contrastarla con la publicada. */
export function describeInstalled(installed: ThemeInstallResponse): string {
  const { plan, written, backup } = installed;
  const files = `${plan.files.length} ${plan.files.length === 1 ? 'fichero' : 'ficheros'}`;
  const digest = `SHA-256 ${plan.archiveSha256.slice(0, 16)}…`;
  if (!written) {
    return `Plan: «${plan.name}» se instalaría en ${plan.directory} (${files}, ${digest})${plan.replaces === undefined ? '' : '; reemplazaría el tema existente'}. Nada escrito.`;
  }
  return `Tema «${plan.name}» instalado en ${plan.directory} (${files}, ${digest})${backup === undefined ? '' : `; el anterior se apartó a ${backup}`}.`;
}

/** Etiqueta del selector: nombre, autoría y si es un tema instalado. */
export function themeOptionLabel(entry: ThemesResponse['entries'][number]): string {
  const author = entry.author === undefined ? '' : ` — ${entry.author}`;
  const origin = entry.origin === undefined ? '' : ' (instalado)';
  return `${entry.name}${author}${origin}`;
}
