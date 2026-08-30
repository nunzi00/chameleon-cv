import type { MasterProfile } from '../core/schema';
import { type MatchReport, type MatchSummary, type RemovedItem, type SectionLimits, type SuggestedSpecialty, labelOrId } from '../core/scoring';
import type { ItemDecision, SelectionReport } from '../core/selection';
import { describeLimits } from './limits';

function decisionLine(decision: ItemDecision, suffix = ''): string {
  const marker = decision.included ? '+' : '-';
  const indent = decision.parentId === undefined ? '' : '    ';
  const label = decision.parentId === undefined ? `${decision.section} ${decision.id}` : decision.id;
  const tags = decision.matchedTags.length === 0 ? '' : ` (${decision.matchedTags.join(', ')})`;
  return `${indent}${marker} ${label}: ${decision.reason}${tags}${suffix}`;
}

/** Informe legible de una selección (`--explain`): una línea por decisión, logros indentados. */
export function formatSelectionReport(report: SelectionReport): string {
  const included = report.decisions.filter((decision) => decision.included).length;
  const lines = [
    `Especialidad «${report.specialtyId}» (vocabulario: ${report.vocabulary.join(', ')}): ${included} de ${report.decisions.length} ítems incluidos`,
    ...report.decisions.map((decision) => decisionLine(decision)),
  ];
  return `${lines.join('\n')}\n`;
}

/** Informe de adecuación a una oferta (`docs/scoring.md` §5.4): requisitos, decisiones puntuadas y cobertura. */
export function formatMatchReport(report: MatchReport): string {
  const { requirements } = report;
  const years = requirements.experienceYears === undefined ? '' : `, ${requirements.experienceYears} años exigidos`;
  const gaps = requirements.gaps.length === 0 ? 'sin carencias detectadas' : `carencias: ${requirements.gaps.join(', ')}`;
  const lines = [`Oferta: ${requirements.terms.length} requisitos reconocidos${years} · ${gaps}`];
  if (requirements.terms.length > 0) {
    lines.push(
      `  ${requirements.terms
        .map((term) => `${term.term} (${term.emphasis}${term.occurrences > 1 ? ` ×${term.occurrences}` : ''}, ${term.weight.toFixed(2)})`)
        .join(' · ')}`,
    );
  }
  for (const decision of report.decisions) {
    const terms = decision.matchedTerms.length === 0 ? '' : ` [${decision.matchedTerms.join(', ')}]`;
    lines.push(decisionLine(decision, decision.included ? ` · ${decision.score.toFixed(2)}${terms}` : ''));
  }
  const uncovered = requirements.terms
    .map((term) => term.term)
    .filter((term) => !report.decisions.some((decision) => decision.included && decision.matchedTerms.includes(term)));
  if (requirements.terms.length > 0) {
    lines.push(uncovered.length === 0 ? 'Todos los requisitos reconocidos están demostrados' : `No demostrado: ${uncovered.join(', ')}`);
  }
  return `${lines.join('\n')}\n`;
}

/** Resumen de recortes (`docs/trimming-cli.md` §4.4), agrupado por contenedor o sección. */
export function formatTrimReport(removed: readonly RemovedItem[], limits: SectionLimits, profileBeforeTrim: MasterProfile): string {
  const header = `Recortes (${describeLimits(limits)})`;
  const keptLine = limits.keep !== undefined && limits.keep.length > 0 ? `  evidencias conservadas por la oferta (no se recortan): ${limits.keep.join(', ')}\n` : '';
  if (removed.length === 0) {
    return `${header}: ninguno\n${keptLine}`;
  }
  const groups = new Map<string, string[]>();
  for (const item of removed) {
    const key = item.parentId ?? item.section;
    const label = item.parentId === undefined ? `${item.id} ${labelOrId(profileBeforeTrim, item.section, item.id)}` : item.id;
    const entries = groups.get(key) ?? [];
    entries.push(`${label} (${item.score.toFixed(2)})`);
    groups.set(key, entries);
  }
  const lines = [`${header}: ${removed.length} ${removed.length === 1 ? 'ítem fuera' : 'ítems fuera'}`];
  for (const [key, entries] of groups) {
    lines.push(`  ${key}: ${entries.join(', ')}`);
  }
  return `${lines.join('\n')}\n${keptLine}`;
}

/** Resumen de adecuación de `cv analyze-offer` (`docs/trimming-cli.md` §4.5). */
export function formatMatchSummary(summary: MatchSummary, offer: string, suggested?: SuggestedSpecialty | undefined): string {
  const years = summary.experienceYears === undefined ? '' : ` · ${summary.experienceYears} años de experiencia exigidos`;
  const lines = [`Oferta ${offer} · ${summary.recognized} requisitos reconocidos${years}`];
  if (summary.recognized === 0) {
    lines.push('Adecuación: la oferta no menciona nada del vocabulario del perfil (etiqueta tu contenido o añade alias en skills.csv)');
  } else {
    lines.push(
      `Adecuación: ${summary.demonstrated} de ${summary.recognized} requisitos demostrados (${Math.round(summary.ratio * 100)} %) · imprescindibles: ${summary.requiredDemonstrated} de ${summary.requiredTotal}`,
    );
  }
  if (suggested !== undefined) {
    lines.push(`Especialidad sugerida: ${suggested.id} (${suggested.title}; cubre ${suggested.covered} de ${suggested.total} requisitos con peso)`);
  }
  const demonstrated = summary.terms.filter((term) => term.evidence.length > 0);
  const missing = summary.terms.filter((term) => term.evidence.length === 0);
  const termLine = (term: MatchSummary['terms'][number]): string =>
    `  ${term.term.padEnd(14)} ${`${term.emphasis}${term.occurrences > 1 ? ` ×${term.occurrences}` : ''}`.padEnd(13)} ${term.weight.toFixed(2)}`;
  if (demonstrated.length > 0) {
    lines.push('', 'Demostrados', ...demonstrated.map((term) => `${termLine(term)}  ← ${term.evidence.join(', ')}`));
  }
  if (missing.length > 0) {
    lines.push('', 'No demostrados', ...missing.map((term) => `${termLine(term)}   (si lo tienes, etiquétalo o añade un alias en skills.csv)`));
  }
  lines.push('', 'Carencias (la oferta lo pide y el perfil no lo tiene etiquetado)', summary.gaps.length === 0 ? '  ninguna detectada' : `  ${summary.gaps.join(' · ')}`);
  if (summary.topEvidence.length > 0) {
    lines.push('', 'Mejores evidencias', ...summary.topEvidence.map((evidence, index) => `  ${index + 1}. ${evidence.id} · ${evidence.label} (${evidence.score.toFixed(2)})`));
  }
  return `${lines.join('\n')}\n`;
}
