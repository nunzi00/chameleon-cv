/**
 * El informe de decisiones (`--explain`) y el análisis de una oferta, en texto para la pantalla: la misma lógica y
 * el mismo vocabulario que los formateadores de la CLI (src/cli/explain.ts), sobre las estructuras de la API.
 */
import type { AnalyzeResponse, GenerateReportPayload } from '../api/types';

type Selection = NonNullable<GenerateReportPayload['selection']>;
type Match = NonNullable<GenerateReportPayload['match']>;
type Decision = Selection['decisions'][number];

function decisionLine(decision: Decision, suffix = ''): string {
  const marker = decision.included ? '+' : '−';
  const indent = decision.parentId === undefined ? '' : '    ';
  const label = decision.parentId === undefined ? `${decision.section} ${decision.id}` : decision.id;
  const tags = decision.matchedTags.length === 0 ? '' : ` (${decision.matchedTags.join(', ')})`;
  return `${indent}${marker} ${label}: ${decision.reason}${tags}${suffix}`;
}

export function selectionLines(report: Selection): readonly string[] {
  const included = report.decisions.filter((decision) => decision.included).length;
  return [`Especialidad «${report.specialtyId}» (vocabulario: ${report.vocabulary.join(', ')}): ${included} de ${report.decisions.length} ítems incluidos`, ...report.decisions.map((decision) => decisionLine(decision))];
}

export function matchLines(report: Match): readonly string[] {
  const { requirements } = report;
  const years = requirements.experienceYears === undefined ? '' : `, ${requirements.experienceYears} años exigidos`;
  const gaps = requirements.gaps.length === 0 ? 'sin carencias detectadas' : `carencias: ${requirements.gaps.join(', ')}`;
  const lines = [`Oferta: ${requirements.terms.length} requisitos reconocidos${years} · ${gaps}`];
  if (requirements.terms.length > 0) {
    lines.push(`  ${requirements.terms.map((term) => `${term.term} (${term.emphasis}${term.occurrences > 1 ? ` ×${term.occurrences}` : ''}, ${term.weight.toFixed(2)})`).join(' · ')}`);
  }
  for (const decision of report.decisions) {
    const terms = decision.matchedTerms.length === 0 ? '' : ` [${decision.matchedTerms.join(', ')}]`;
    lines.push(decisionLine(decision, decision.included ? ` · ${decision.score.toFixed(2)}${terms}` : ''));
  }
  if (requirements.terms.length > 0) {
    const uncovered = requirements.terms.map((term) => term.term).filter((term) => !report.decisions.some((decision) => decision.included && decision.matchedTerms.includes(term)));
    lines.push(uncovered.length === 0 ? 'Todos los requisitos reconocidos están demostrados' : `No demostrado: ${uncovered.join(', ')}`);
  }
  return lines;
}

export function describeLimits(limits: GenerateReportPayload['limits']): string {
  const parts = [
    limits.achievementsPerContainer === undefined ? undefined : `${limits.achievementsPerContainer} logros por experiencia y proyecto`,
    limits.achievements === undefined ? undefined : `${limits.achievements} logros transversales`,
    limits.skills === undefined ? undefined : `${limits.skills} skills`,
    limits.projects === undefined ? undefined : `${limits.projects} proyectos`,
    limits.certifications === undefined ? undefined : `${limits.certifications} certificaciones`,
  ].filter((part): part is string => part !== undefined);
  return parts.length === 0 ? 'sin límites' : parts.join(', ');
}

export function trimLines(removed: GenerateReportPayload['removed'], limits: GenerateReportPayload['limits']): readonly string[] {
  const header = `Recortes (${describeLimits(limits)})`;
  if (removed.length === 0) {
    return [`${header}: ninguno`];
  }
  const groups = new Map<string, string[]>();
  for (const item of removed) {
    const key = item.parentId ?? item.section;
    const entries = groups.get(key) ?? [];
    entries.push(`${item.id} (${item.score.toFixed(2)})`);
    groups.set(key, entries);
  }
  return [`${header}: ${removed.length} ${removed.length === 1 ? 'ítem fuera' : 'ítems fuera'}`, ...[...groups].map(([key, entries]) => `  ${key}: ${entries.join(', ')}`)];
}

export function themeLine(theme: GenerateReportPayload['theme']): string | undefined {
  if (theme === undefined) {
    return undefined;
  }
  return `Tema: ${theme.name} (${theme.builtin ? 'distribuido' : 'del proyecto'})${theme.overridden.length === 0 ? '' : `; cv.toml anula ${theme.overridden.join(', ')}`}`;
}

export interface ReportSection {
  readonly title: string;
  readonly lines: readonly string[];
}

/** Las secciones del informe en el orden en que se decidieron: selección, oferta, recortes y tema. */
export function reportSections(report: GenerateReportPayload): readonly ReportSection[] {
  const sections: ReportSection[] = [{ title: 'Selección', lines: report.selection === undefined ? ['Sin especialidad: se genera el CV completo, sin selección'] : selectionLines(report.selection) }];
  if (report.match !== undefined) {
    sections.push({ title: 'Oferta', lines: matchLines(report.match) });
  }
  sections.push({ title: 'Recortes', lines: trimLines(report.removed, report.limits) });
  const theme = themeLine(report.theme);
  if (theme !== undefined) {
    sections.push({ title: 'Tema', lines: [theme] });
  }
  return sections;
}

export interface TermView {
  readonly term: string;
  readonly detail: string;
  readonly evidence: readonly string[];
}

export interface AnalysisView {
  readonly headline: string;
  readonly adequacy: string;
  /** Porcentaje de requisitos demostrados (sin requisitos reconocidos, `undefined`). */
  readonly percent: number | undefined;
  readonly counts: { readonly demonstrated: number; readonly recognized: number };
  readonly demonstrated: readonly TermView[];
  readonly missing: readonly TermView[];
  readonly gaps: readonly string[];
  readonly ranking: readonly { readonly id: string; readonly label: string; readonly score: string }[];
}

/** El resumen de adecuación de `cv analyze-offer`, a partir de la respuesta de POST /analyze-offer. */
export function analysisView(response: AnalyzeResponse): AnalysisView {
  const { offer, summary } = response;
  const years = offer.experienceYears === undefined ? '' : ` · ${offer.experienceYears} años de experiencia exigidos`;
  const adequacy =
    summary.recognized === 0
      ? 'La oferta no menciona nada del vocabulario del perfil (etiqueta tu contenido o añade alias en skills.csv)'
      : `${summary.demonstrated} de ${summary.recognized} requisitos demostrados (${Math.round(summary.ratio * 100)} %) · imprescindibles: ${summary.requiredDemonstrated} de ${summary.requiredTotal}`;
  const terms = offer.terms.map((term) => ({ term: term.term, detail: `${term.emphasis}${term.occurrences > 1 ? ` ×${term.occurrences}` : ''} · ${term.weight.toFixed(2)}`, evidence: response.coverage[term.term] ?? [] }));
  return {
    headline: `Oferta ${offer.source} · ${summary.recognized} requisitos reconocidos${years}`,
    adequacy,
    percent: summary.recognized === 0 ? undefined : Math.round(summary.ratio * 100),
    counts: { demonstrated: summary.demonstrated, recognized: summary.recognized },
    demonstrated: terms.filter((term) => term.evidence.length > 0),
    missing: terms.filter((term) => term.evidence.length === 0),
    gaps: offer.gaps,
    ranking: response.ranking.map((evidence) => ({ id: evidence.id, label: evidence.label, score: evidence.score.toFixed(2) })),
  };
}
