import type { MatchReport } from '../core/scoring';
import type { ItemDecision, SelectionReport } from '../core/selection';

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
