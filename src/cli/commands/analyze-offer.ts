/**
 * `cv analyze-offer <oferta>`: inspección sin generación (`docs/trimming-cli.md` §4.5). Resumen
 * legible por defecto, `--explain` para la auditoría por ítem y `--json` para máquinas.
 * Nunca escribe ficheros.
 */
import { resolve } from 'node:path';

import { readProfileArtifact } from '../../artifact';
import { buildVocabulary, extractJobRequirements } from '../../core/keywords';
import { summarizeMatch, tailorToOffer } from '../../core/scoring';
import type { CliContext } from '../context';
import { formatMatchReport, formatMatchSummary, formatSelectionReport } from '../explain';
import { warnIfStale } from '../freshness';
import { readOfferText } from '../offer';
import { buildBeforeUse } from './build';
import { EXIT_DATA_ERROR, EXIT_OK } from '../output';

export interface AnalyzeOfferOptions {
  readonly profile: string;
  readonly data: string;
  readonly specialty?: string | undefined;
  readonly explain: boolean;
  readonly json: boolean;
  readonly build: boolean;
}

export async function runAnalyzeOffer(context: CliContext, source: string, options: AnalyzeOfferOptions): Promise<number> {
  const artifactPath = resolve(context.cwd, options.profile);
  if (options.build) {
    const built = await buildBeforeUse(context, options);
    if (built !== EXIT_OK) {
      return built;
    }
  }
  const artifact = await readProfileArtifact(context.artifactFileSystem, artifactPath);
  if (!artifact.ok) {
    for (const error of artifact.errors) {
      context.stderr(`${error}\n`);
    }
    return EXIT_DATA_ERROR;
  }
  if (!options.build) {
    await warnIfStale(context, artifactPath, resolve(context.cwd, options.data));
  }

  const offer = await readOfferText(context, source);
  if (!offer.ok) {
    context.stderr(`${offer.message}\n`);
    return offer.exitCode;
  }
  const requirements = extractJobRequirements(offer.offer.text, buildVocabulary(artifact.profile));
  const tailored = tailorToOffer(artifact.profile, requirements, { specialtyId: options.specialty });
  if (!tailored.ok) {
    context.stderr(`${tailored.error.message}\n`);
    return EXIT_DATA_ERROR;
  }
  const { scored } = tailored;
  const summary = summarizeMatch(scored.report, scored.profile);

  if (options.json) {
    const payload = {
      offer: { source: offer.offer.name, ...requirements },
      summary: {
        recognized: summary.recognized,
        demonstrated: summary.demonstrated,
        ratio: summary.ratio,
        requiredTotal: summary.requiredTotal,
        requiredDemonstrated: summary.requiredDemonstrated,
      },
      coverage: scored.report.coverage,
      decisions: scored.report.decisions,
      ranking: summary.topEvidence,
    };
    context.stdout(`${JSON.stringify(payload, null, 2)}\n`);
    return EXIT_OK;
  }

  context.stdout(formatMatchSummary(summary, offer.offer.name));
  if (options.explain) {
    context.stdout(`\n${formatSelectionReport(scored.selection.report)}${formatMatchReport(scored.report)}`);
  }
  return EXIT_OK;
}
