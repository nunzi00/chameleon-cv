/**
 * Verificador de integridad semántica (T-4.3; canon C2 extendido el 2026-08-28: «sin invención» =
 * integridad semántica completa). Determinista y sin modelo: compara cada propuesta con el
 * original y su contexto permitido y rechaza —explicando por qué— si añade cifras, entidades o
 * contexto que no estaban, o si omite cifras o entidades que sí estaban. Es el cinturón de
 * seguridad: la IA sugiere, el código verifica.
 */
import { containsTerm, normalizeLine, normalizeText } from '../keywords';

export type ViolationCode =
  | 'VIOLATION_C2_NUMBER_ADDED'
  | 'VIOLATION_C2_ENTITY_ADDED'
  | 'VIOLATION_C2_CONTEXT_ADDED'
  | 'VIOLATION_C2_FACT_OMITTED'
  | 'VIOLATION_LENGTH'
  | 'VIOLATION_NO_CHANGE'
  | 'VIOLATION_EMPTY';

export interface Violation {
  readonly code: ViolationCode;
  readonly details: readonly string[];
}

export interface Verdict {
  readonly accepted: boolean;
  readonly violations: readonly Violation[];
}

export interface VerifyOptions {
  /** Textos cuyo contenido también se admite (impacto, rol, empresa): hechos del propio ítem. */
  readonly allowed?: readonly string[] | undefined;
  /** Términos del perfil (tags, skills, tecnologías, diccionario): entidades vigiladas aunque sean minúsculas. */
  readonly vocabulary?: Iterable<string> | undefined;
  readonly maxLength?: number | undefined;
  readonly locale?: string | undefined;
}

type TokenKind = 'number' | 'technical' | 'proper' | 'word' | 'verb' | 'stop' | 'short';

interface Token {
  readonly raw: string;
  readonly norm: string;
  readonly stem: string;
  readonly kind: TokenKind;
}

const STOPWORDS_ES = new Set(
  'de del la el los las un una unos unas y e o u en con por para sin sobre al a que se su sus lo mas menos como es son fue ser mi mis este esta estos estas ese esa esos esas entre hasta desde durante tras ante bajo cada todo toda todos todas otro otra otros otras muy ya no ni tambien mediante gracias traves asi cual cuales donde cuando mientras ademas mismo misma mismos mismas sido siendo han hay ha he hemos les le nos me te ti nuestro nuestra nuestros nuestras vuestro vuestra ello ella ellos ellas'.split(
    ' ',
  ),
);
const STOPWORDS_EN = new Set(
  'the a an and or of to in on for with by from at as is are was were be been being that this these those it its into over under than then while through across via also more less our their my his her we you they them us who which what where when how not no nor so such both each any all'.split(
    ' ',
  ),
);
const STOPWORDS = new Set([...STOPWORDS_ES, ...STOPWORDS_EN]);

const VERB_SUFFIXES_ES = ['ando', 'endo', 'ados', 'adas', 'idos', 'idas', 'ado', 'ada', 'ido', 'ida', 'aron', 'ieron', 'aban', 'ían', 'aba', 'ía', 'amos', 'emos', 'imos', 'ar', 'er', 'ir', 'é', 'í', 'ó'];
const VERB_SUFFIXES_EN = ['ing', 'ed'];
const DERIVATIONAL_ES = ['mente', 'ciones', 'cion', 'siones', 'sion', 'idades', 'idad', 'adores', 'adora', 'ador', 'ismos', 'ismo', 'istas', 'ista', 'ia', 'a', 'o', 'e'];
const DERIVATIONAL_EN = ['ness', 'ment', 'ing', 'ly', 'ed', 'er', 'es', 'e'];
const MIN_STEM = 4;

const NUMBER = /^\d+(?:[.,]\d+)?%?$/u;

function stripMarkdown(text: string): string {
  return text.replace(/[*`_]/g, '');
}

/** Raíz aproximada: quita el plural y, después, un sufijo derivativo, sin bajar de cuatro letras. */
export function stem(norm: string, locale: string): string {
  let word = norm;
  if (word.length > MIN_STEM + 1 && word.endsWith('es')) {
    word = word.slice(0, -2);
  } else if (word.length > MIN_STEM && word.endsWith('s')) {
    word = word.slice(0, -1);
  }
  for (const suffix of locale.startsWith('en') ? DERIVATIONAL_EN : DERIVATIONAL_ES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= MIN_STEM) {
      return word.slice(0, -suffix.length);
    }
  }
  return word;
}

function isVerbLike(lowerRaw: string, locale: string): boolean {
  const suffixes = locale.startsWith('en') ? VERB_SUFFIXES_EN : VERB_SUFFIXES_ES;
  return suffixes.some((suffix) => lowerRaw.endsWith(suffix) && lowerRaw.length > suffix.length + 2);
}

function classify(raw: string, index: number, locale: string): Token {
  const norm = normalizeText(raw);
  const letters = [...raw].filter((character) => /\p{L}/u.test(character));
  const digits = /\d/u.test(raw);
  if (NUMBER.test(raw)) {
    return { raw, norm: raw.replace(',', '.').replace('%', ''), stem: '', kind: 'number' };
  }
  if (digits || /[+#/]/u.test(raw) || (letters.length >= 2 && letters.every((character) => character === character.toUpperCase()))) {
    return { raw, norm, stem: norm, kind: 'technical' };
  }
  if (STOPWORDS.has(norm)) {
    return { raw, norm, stem: norm, kind: 'stop' };
  }
  if (letters.length < 2) {
    return { raw, norm, stem: norm, kind: 'short' };
  }
  if (index > 0 && /\p{Lu}/u.test(raw.charAt(0))) {
    return { raw, norm, stem: stem(norm, locale), kind: 'proper' };
  }
  if (letters.length < MIN_STEM) {
    return { raw, norm, stem: norm, kind: 'short' };
  }
  if (isVerbLike(raw.toLowerCase(), locale)) {
    return { raw, norm, stem: stem(norm, locale), kind: 'verb' };
  }
  return { raw, norm, stem: stem(norm, locale), kind: 'word' };
}

export function tokenize(text: string, locale = 'es'): Token[] {
  const matches = stripMarkdown(text).match(/[\p{L}\p{N}][\p{L}\p{N}.,+#/%-]*/gu) ?? [];
  return matches.map((match) => match.replace(/[.,/-]+$/u, '')).filter((match) => match !== '').map((raw, index) => classify(raw, index, locale));
}

interface Facts {
  readonly numbers: Set<string>;
  readonly entities: Set<string>;
  readonly stems: Set<string>;
  readonly vocabulary: Set<string>;
}

function factsOf(texts: readonly string[], vocabulary: readonly string[], locale: string): Facts {
  const facts: Facts = { numbers: new Set(), entities: new Set(), stems: new Set(), vocabulary: new Set() };
  for (const text of texts) {
    for (const token of tokenize(text, locale)) {
      if (token.kind === 'number') {
        facts.numbers.add(token.norm);
      } else if (token.kind === 'technical' || token.kind === 'proper') {
        facts.entities.add(token.norm);
        facts.stems.add(token.stem);
      } else if (token.kind !== 'stop') {
        facts.stems.add(token.stem);
        facts.stems.add(token.norm);
      }
    }
    const normalized = normalizeLine(stripMarkdown(text));
    for (const term of vocabulary) {
      if (containsTerm(normalized, term)) {
        facts.vocabulary.add(term);
      }
    }
  }
  return facts;
}

export function verifyProposal(original: string, proposal: string, options: VerifyOptions = {}): Verdict {
  const locale = options.locale ?? 'es';
  const vocabulary = [...new Set([...(options.vocabulary ?? [])].map((term) => normalizeLine(term)).filter((term) => term !== ''))];
  const violations: Violation[] = [];
  const cleanProposal = stripMarkdown(proposal).trim();

  if (cleanProposal === '') {
    return { accepted: false, violations: [{ code: 'VIOLATION_EMPTY', details: [] }] };
  }
  if (normalizeLine(cleanProposal) === normalizeLine(stripMarkdown(original))) {
    return { accepted: false, violations: [{ code: 'VIOLATION_NO_CHANGE', details: [] }] };
  }
  if (options.maxLength !== undefined && [...cleanProposal].length > options.maxLength) {
    violations.push({ code: 'VIOLATION_LENGTH', details: [`${[...cleanProposal].length} > ${options.maxLength}`] });
  }

  const known = factsOf([original, ...(options.allowed ?? [])], vocabulary, locale);
  const source = factsOf([original], vocabulary, locale);
  const candidate = factsOf([proposal], vocabulary, locale);
  const proposalTokens = tokenize(proposal, locale);

  const numbersAdded = [...candidate.numbers].filter((number) => !known.numbers.has(number));
  if (numbersAdded.length > 0) {
    violations.push({ code: 'VIOLATION_C2_NUMBER_ADDED', details: numbersAdded });
  }

  const entitiesAdded = [
    ...proposalTokens.filter((token) => (token.kind === 'technical' || token.kind === 'proper') && !known.entities.has(token.norm) && !known.stems.has(token.stem)).map((token) => token.raw),
    ...[...candidate.vocabulary].filter((term) => !known.vocabulary.has(term)),
  ];
  if (entitiesAdded.length > 0) {
    violations.push({ code: 'VIOLATION_C2_ENTITY_ADDED', details: [...new Set(entitiesAdded)] });
  }

  const reportedAsEntity = new Set(candidate.vocabulary.values());
  const contextAdded = proposalTokens
    .filter((token) => token.kind === 'word' && !known.stems.has(token.stem) && !known.stems.has(token.norm) && !reportedAsEntity.has(token.norm))
    .map((token) => token.raw);
  if (contextAdded.length > 0) {
    violations.push({ code: 'VIOLATION_C2_CONTEXT_ADDED', details: [...new Set(contextAdded)] });
  }

  const omitted = [
    ...[...source.numbers].filter((number) => !candidate.numbers.has(number)),
    ...[...source.entities].filter((entity) => !candidate.entities.has(entity) && !candidate.stems.has(stem(entity, locale))),
    ...[...source.vocabulary].filter((term) => !candidate.vocabulary.has(term)),
  ];
  if (omitted.length > 0) {
    violations.push({ code: 'VIOLATION_C2_FACT_OMITTED', details: [...new Set(omitted)] });
  }

  return { accepted: violations.length === 0, violations };
}

/** Etiqueta legible de un veredicto: «✓ aceptada» o «✗ CODE (detalles) · CODE (…)». */
export function describeVerdict(verdict: Verdict): string {
  if (verdict.accepted) {
    return '✓ aceptada';
  }
  return `✗ ${verdict.violations.map((violation) => (violation.details.length === 0 ? violation.code : `${violation.code} (${violation.details.join(', ')})`)).join(' · ')}`;
}
