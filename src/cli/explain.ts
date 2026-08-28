import type { SelectionReport } from '../core/selection';

/** Informe legible de una selección (`--explain`): una línea por decisión, logros indentados. */
export function formatSelectionReport(report: SelectionReport): string {
  const included = report.decisions.filter((decision) => decision.included).length;
  const lines = [
    `Especialidad «${report.specialtyId}» (vocabulario: ${report.vocabulary.join(', ')}): ${included} de ${report.decisions.length} ítems incluidos`,
  ];
  for (const decision of report.decisions) {
    const marker = decision.included ? '+' : '-';
    const indent = decision.parentId === undefined ? '' : '    ';
    const label = decision.parentId === undefined ? `${decision.section} ${decision.id}` : decision.id;
    const tags = decision.matchedTags.length === 0 ? '' : ` (${decision.matchedTags.join(', ')})`;
    lines.push(`${indent}${marker} ${label}: ${decision.reason}${tags}`);
  }
  return `${lines.join('\n')}\n`;
}
