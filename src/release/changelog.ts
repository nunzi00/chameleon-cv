/**
 * Notas de la release a partir de `CHANGELOG.md` (formato «Keep a Changelog», T-6.6). La sección
 * `## [<versión>] - <fecha>` es la única fuente de las notas que se publican con cada release: si
 * falta, no lleva fecha o está vacía, el flujo se detiene antes de empaquetar (canon C12: se valida
 * el proceso, no el resultado).
 */

export interface ChangelogSection {
  readonly version: string;
  /** Lo que sigue al guion de la cabecera (`## [1.0.0] - 2026-08-29`); ausente en `## [Unreleased]`. */
  readonly date: string | undefined;
  /** Cuerpo de la sección sin la cabecera, sin las definiciones de enlace del pie del fichero y recortado. */
  readonly body: string;
}

export type ReleaseNotesResult =
  | { readonly ok: true; readonly date: string; readonly notes: string }
  | { readonly ok: false; readonly message: string };

const HEADING = /^## \[([^\]]+)\](?:\s+-\s+(\S.*?))?\s*$/;
const LINK_DEFINITION = /^\[[^\]]+\]:\s+\S+/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Secciones `## [versión]` del registro de cambios, en el orden del fichero (el preámbulo no cuenta). */
export function changelogSections(changelog: string): ChangelogSection[] {
  const sections: ChangelogSection[] = [];
  let current: { version: string; date: string | undefined; lines: string[] } | undefined;
  const close = (): void => {
    if (current !== undefined) {
      sections.push({ version: current.version, date: current.date, body: current.lines.filter((line) => !LINK_DEFINITION.test(line)).join('\n').trim() });
    }
  };
  for (const line of changelog.split(/\r?\n/)) {
    const heading = HEADING.exec(line);
    if (heading === null) {
      current?.lines.push(line);
    } else {
      close();
      current = { version: String(heading[1]), date: heading[2], lines: [] };
    }
  }
  close();
  return sections;
}

/** Notas de una versión concreta: su sección, con fecha ISO y cuerpo no vacío; si no, el motivo. */
export function releaseNotes(changelog: string, version: string): ReleaseNotesResult {
  const sections = changelogSections(changelog);
  const section = sections.find((candidate) => candidate.version === version);
  if (section === undefined) {
    const present = sections.map((candidate) => candidate.version);
    return { ok: false, message: `CHANGELOG.md no tiene la sección «## [${version}]»${present.length === 0 ? '' : ` (secciones presentes: ${present.join(', ')})`}` };
  }
  if (section.date === undefined || !ISO_DATE.test(section.date)) {
    return { ok: false, message: `la sección «## [${version}]» de CHANGELOG.md no lleva fecha: se espera «## [${version}] - AAAA-MM-DD»` };
  }
  if (section.body === '') {
    return { ok: false, message: `la sección «## [${version}]» de CHANGELOG.md está vacía` };
  }
  return { ok: true, date: section.date, notes: section.body };
}
