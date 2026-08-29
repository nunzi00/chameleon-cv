/** El formulario del co-piloto → el cuerpo de POST /jobs/{improve|summarize|suggest-tags}, con la validación que la API exigiría. */
import type { JobKind, JobRequest } from '../api/client';
import type { ImproveJobRequest, SuggestTagsJobRequest, SummarizeJobRequest } from '../api/types';
import { integerField, offerOf, type FormResult, type OfferMode } from '../generate/form';

export interface CopilotForm {
  readonly kind: JobKind;
  readonly specialty: string;
  readonly offerMode: OfferMode;
  readonly offerText: string;
  readonly offerFile: string;
  /** Ids de logros separados por comas o espacios (vacío = todos los de la selección). */
  readonly only: string;
  readonly proposals: string;
  readonly maxLength: string;
  readonly maxItems: string;
  readonly paragraphs: string;
  readonly maxTags: string;
  readonly untagged: boolean;
  /** Texto suelto para etiquetar (suggest-tags); vacío = los logros del perfil. */
  readonly text: string;
  readonly redactCompanies: boolean;
  readonly locale: string;
  readonly output: string;
  readonly cache: boolean;
  readonly provider: string;
  readonly model: string;
  readonly topN: string;
  readonly compact: boolean;
}

export const EMPTY_COPILOT_FORM: CopilotForm = {
  kind: 'improve',
  specialty: '',
  offerMode: 'none',
  offerText: '',
  offerFile: '',
  only: '',
  proposals: '',
  maxLength: '',
  maxItems: '',
  paragraphs: '',
  maxTags: '',
  untagged: false,
  text: '',
  redactCompanies: false,
  locale: '',
  output: '',
  cache: true,
  provider: '',
  model: '',
  topN: '',
  compact: false,
};

const OUTPUT_NAME = /^[\w.-]+$/;

type Bounded = { readonly ok: true; readonly value: number | undefined } | { readonly ok: false; readonly message: string };

function bounded(label: string, value: string, min: number, max: number): Bounded {
  const parsed = integerField(label, value);
  if (!parsed.ok || parsed.value === undefined) {
    return parsed;
  }
  return parsed.value >= min && parsed.value <= max ? parsed : { ok: false, message: `${label} debe estar entre ${min} y ${max}` };
}

/** `a, b  c` → ids únicos sin espacios; `undefined` si no hay ninguno. */
export function parseOnly(only: string): string[] | undefined {
  const ids = [...new Set(only.split(/[\s,]+/).map((id) => id.trim()).filter((id) => id !== ''))];
  return ids.length === 0 ? undefined : ids;
}

function common(form: CopilotForm): Pick<ImproveJobRequest, 'provider' | 'model' | 'cache' | 'redactCompanies' | 'locale'> {
  return {
    ...(form.provider.trim() === '' ? {} : { provider: form.provider.trim() }),
    ...(form.model.trim() === '' ? {} : { model: form.model.trim() }),
    ...(form.cache ? {} : { cache: false }),
    ...(form.redactCompanies ? { redactCompanies: true } : {}),
    ...(form.locale.trim() === '' ? {} : { locale: form.locale.trim() }),
  };
}

function selection(form: CopilotForm): FormResult<Pick<ImproveJobRequest, 'specialty' | 'offer' | 'topN' | 'compact'>> {
  const offer = offerOf(form);
  if (!offer.ok) {
    return offer;
  }
  const topN = integerField('Top N', form.topN);
  if (!topN.ok) {
    return topN;
  }
  return {
    ok: true,
    body: {
      ...(form.specialty === '' ? {} : { specialty: form.specialty }),
      ...(offer.body === undefined ? {} : { offer: offer.body }),
      ...(topN.value === undefined ? {} : { topN: topN.value }),
      ...(form.compact ? { compact: true } : {}),
    },
  };
}

function outputName(form: CopilotForm): FormResult<string | undefined> {
  const output = form.output.trim();
  if (output !== '' && !OUTPUT_NAME.test(output)) {
    return { ok: false, message: 'El nombre de la revisión solo admite letras, números, «.», «-» y «_» (sin directorios)' };
  }
  return { ok: true, body: output === '' ? undefined : output };
}

export function buildJobRequest(form: CopilotForm): FormResult<JobRequest> {
  const base = common(form);
  if (form.kind === 'suggest-tags') {
    const maxTags = bounded('Etiquetas por logro', form.maxTags, 1, 20);
    if (!maxTags.ok) {
      return maxTags;
    }
    const maxItems = bounded('Logros por ejecución', form.maxItems, 1, 500);
    if (!maxItems.ok) {
      return maxItems;
    }
    const text = form.text.trim();
    const body: SuggestTagsJobRequest = {
      ...base,
      ...(text === '' ? {} : { text }),
      ...(form.specialty === '' ? {} : { specialty: form.specialty }),
      ...(text === '' && parseOnly(form.only) !== undefined ? { only: parseOnly(form.only) } : {}),
      ...(text === '' && form.untagged ? { untagged: true } : {}),
      ...(maxTags.value === undefined ? {} : { maxTags: maxTags.value }),
      ...(maxItems.value === undefined ? {} : { maxItems: maxItems.value }),
    };
    return { ok: true, body: { kind: 'suggest-tags', body } };
  }
  const selected = selection(form);
  if (!selected.ok) {
    return selected;
  }
  const output = outputName(form);
  if (!output.ok) {
    return output;
  }
  const proposals = bounded('Propuestas', form.proposals, 1, 3);
  if (!proposals.ok) {
    return proposals;
  }
  if (form.kind === 'summarize') {
    const paragraphs = bounded('Párrafos', form.paragraphs, 1, 3);
    if (!paragraphs.ok) {
      return paragraphs;
    }
    const maxLength = bounded('Longitud máxima', form.maxLength, 100, 5000);
    if (!maxLength.ok) {
      return maxLength;
    }
    const body: SummarizeJobRequest = {
      ...base,
      ...selected.body,
      ...(paragraphs.value === undefined ? {} : { paragraphs: paragraphs.value }),
      ...(proposals.value === undefined ? {} : { proposals: proposals.value }),
      ...(maxLength.value === undefined ? {} : { maxLength: maxLength.value }),
      ...(output.body === undefined ? {} : { output: output.body }),
    };
    return { ok: true, body: { kind: 'summarize', body } };
  }
  const maxLength = bounded('Longitud máxima', form.maxLength, 40, 1000);
  if (!maxLength.ok) {
    return maxLength;
  }
  const maxItems = bounded('Logros por ejecución', form.maxItems, 1, 500);
  if (!maxItems.ok) {
    return maxItems;
  }
  const only = parseOnly(form.only);
  const body: ImproveJobRequest = {
    ...base,
    ...selected.body,
    ...(only === undefined ? {} : { only }),
    ...(proposals.value === undefined ? {} : { proposals: proposals.value }),
    ...(maxLength.value === undefined ? {} : { maxLength: maxLength.value }),
    ...(maxItems.value === undefined ? {} : { maxItems: maxItems.value }),
    ...(output.body === undefined ? {} : { output: output.body }),
  };
  return { ok: true, body: { kind: 'improve', body } };
}
