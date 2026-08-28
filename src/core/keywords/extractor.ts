/**
 * Extractor determinista de requisitos (T-2.1, `docs/scoring.md` §4): el texto de la oferta se
 * analiza por líneas contra el vocabulario del perfil; el diccionario incorporado solo detecta
 * carencias sobre lo que queda tras enmascarar el vocabulario.
 */
import { DEFAULT_DICTIONARY } from './dictionary';
import { matchTerms, type TermHits } from './matcher';
import { normalizeInput } from './normalize';
import { classifyLines, strongestEmphasis, type ClassifiedLine } from './sections';
import { JobRequirementsSchema, type Emphasis, type JobRequirements, type RequirementTerm, type Vocabulary } from './types';
import { extractExperienceYears } from './years';

export interface ExtractionOptions {
  readonly requiredWeight?: number;
  readonly unknownWeight?: number;
  readonly desirableWeight?: number;
  /** Refuerzo por cada aparición adicional, hasta `maxBoostedOccurrences`. */
  readonly frequencyBoost?: number;
  readonly maxBoostedOccurrences?: number;
  readonly contextsPerTerm?: number;
  /** Diccionario de carencias; por defecto, el incorporado. */
  readonly dictionary?: readonly string[];
}

export const DEFAULT_EXTRACTION_OPTIONS: Required<ExtractionOptions> = {
  requiredWeight: 1,
  unknownWeight: 0.75,
  desirableWeight: 0.5,
  frequencyBoost: 0.25,
  maxBoostedOccurrences: 3,
  contextsPerTerm: 2,
  dictionary: DEFAULT_DICTIONARY,
};

const CONTEXT_MAX_LENGTH = 160;

function baseWeight(emphasis: Emphasis, settings: Required<ExtractionOptions>): number {
  if (emphasis === 'required') {
    return settings.requiredWeight;
  }
  return emphasis === 'desirable' ? settings.desirableWeight : settings.unknownWeight;
}

function truncate(text: string): string {
  return text.length > CONTEXT_MAX_LENGTH ? `${text.slice(0, CONTEXT_MAX_LENGTH - 1)}…` : text;
}

function contextsOf(hits: TermHits<ClassifiedLine>, limit: number): string[] {
  const seen = new Set<string>();
  const contexts: string[] = [];
  for (const hit of hits.all) {
    const context = hit.line.original.trim();
    if (!seen.has(context)) {
      seen.add(context);
      contexts.push(truncate(context));
    }
  }
  return contexts.slice(0, limit);
}

function roundWeight(weight: number): number {
  return Math.round(weight * 1000) / 1000;
}

export function extractJobRequirements(offerText: string, vocabulary: Vocabulary, options: ExtractionOptions = {}): JobRequirements {
  const settings: Required<ExtractionOptions> = { ...DEFAULT_EXTRACTION_OPTIONS, ...options };
  const lines = classifyLines(normalizeInput(offerText));
  const { hits, masked } = matchTerms(lines, [...vocabulary.keys()]);

  const found: Array<{ term: RequirementTerm; hits: TermHits<ClassifiedLine> }> = [];
  for (const [term, tags] of vocabulary) {
    const termHits = hits.get(term);
    if (termHits === undefined) {
      continue;
    }
    const emphasis = strongestEmphasis(termHits.all.map((hit) => hit.line.emphasis));
    const occurrences = termHits.all.length;
    const boost = 1 + settings.frequencyBoost * Math.min(occurrences - 1, settings.maxBoostedOccurrences);
    found.push({
      term: {
        term,
        tags: [...tags],
        occurrences,
        emphasis,
        weight: roundWeight(baseWeight(emphasis, settings) * boost),
        contexts: contextsOf(termHits, settings.contextsPerTerm),
      },
      hits: termHits,
    });
  }
  found.sort(
    (a, b) =>
      b.term.weight - a.term.weight || a.hits.first.lineIndex - b.hits.first.lineIndex || a.hits.first.offset - b.hits.first.offset,
  );

  const tagWeights: Record<string, number> = {};
  for (const { term } of found) {
    for (const tag of term.tags) {
      tagWeights[tag] = Math.max(tagWeights[tag] ?? 0, term.weight);
    }
  }

  const maskedLines = masked.map((normalized) => ({ normalized }));
  const gapCandidates = settings.dictionary.filter((entry) => !vocabulary.has(entry));
  const gapHits = matchTerms(maskedLines, gapCandidates).hits;
  const gaps = [...gapHits.entries()]
    .sort(([, a], [, b]) => a.first.lineIndex - b.first.lineIndex || a.first.offset - b.first.offset)
    .map(([gap]) => gap);

  const experienceYears = extractExperienceYears(lines.map((line) => line.normalized));
  return JobRequirementsSchema.parse({
    terms: found.map(({ term }) => term),
    tagWeights,
    ...(experienceYears === undefined ? {} : { experienceYears }),
    gaps,
  });
}
