/**
 * Recordar cómo generas TU CV (T-9.18). La pantalla de Generar tiene una docena de decisiones —especialidad,
 * formato, motor, tema, idioma, límites, compacto— y casi siempre son las mismas: volver a elegirlas en cada
 * visita es trabajo que la interfaz puede ahorrarte.
 *
 * Lo que **no** se recuerda, y a propósito: la oferta (es de cada búsqueda, no una preferencia), la selección
 * concreta de skills y proyectos (depende de la oferta), `build` (recompilar es una acción, no un ajuste) y el
 * co-piloto con su proveedor —dejar marcado algo que envía datos sería decidir por ti, y eso es justo lo que el
 * producto no hace (C2, C11)—.
 *
 * Al restaurar se comprueba que lo guardado siga existiendo: una especialidad que borraste o un tema que
 * desinstalaste se descartan en silencio, y el formulario se queda con su valor por defecto.
 */
import type { KeyValueStorage } from '../storage';
import type { GenerateForm } from './form';

export const GENERATE_KEY = 'cv.generar.opciones';

/** Solo decisiones de forma: lo que se repite entre CV, no lo que cambia con cada oferta. */
const REMEMBERED = ['specialty', 'format', 'engine', 'theme', 'locale', 'topN', 'maxSkills', 'maxProjects', 'maxCertifications', 'compact'] as const;

export type RememberedOptions = Partial<Pick<GenerateForm, (typeof REMEMBERED)[number]>>;

export function rememberOptions(storage: KeyValueStorage, form: GenerateForm): void {
  try {
    const stored: Record<string, unknown> = {};
    for (const key of REMEMBERED) {
      stored[key] = form[key];
    }
    storage.setItem(GENERATE_KEY, JSON.stringify(stored));
  } catch {
    // Sin persistencia: la pantalla sigue funcionando, solo que sin memoria.
  }
}

function stored(storage: KeyValueStorage): RememberedOptions {
  try {
    const raw = storage.getItem(GENERATE_KEY);
    const parsed: unknown = raw === null ? undefined : JSON.parse(raw);
    return typeof parsed === 'object' && parsed !== null ? (parsed as RememberedOptions) : {};
  } catch {
    return {};
  }
}

export interface Available {
  readonly specialties: readonly string[];
  readonly themes: readonly string[];
  /** Sin Typst instalado, el motor guardado no se puede usar. */
  readonly typstUsable: boolean;
}

/** El formulario con lo recordado que siga siendo válido; lo demás se queda como estaba. */
export function restoreOptions(storage: KeyValueStorage, form: GenerateForm, available: Available): GenerateForm {
  const saved = stored(storage);
  const keep = <T>(value: T | undefined, ok: (value: T) => boolean): T | undefined => (value !== undefined && ok(value) ? value : undefined);
  const specialty = keep(saved.specialty, (value) => value === '' || available.specialties.includes(value));
  const theme = keep(saved.theme, (value) => value === '' || available.themes.includes(value));
  const engine = keep(saved.engine, (value) => value === 'pdfkit' || available.typstUsable);
  return {
    ...form,
    ...(specialty === undefined ? {} : { specialty }),
    ...(theme === undefined ? {} : { theme }),
    ...(engine === undefined ? {} : { engine }),
    ...(saved.format === undefined ? {} : { format: saved.format }),
    ...(saved.locale === undefined ? {} : { locale: saved.locale }),
    ...(saved.topN === undefined ? {} : { topN: saved.topN }),
    ...(saved.maxSkills === undefined ? {} : { maxSkills: saved.maxSkills }),
    ...(saved.maxProjects === undefined ? {} : { maxProjects: saved.maxProjects }),
    ...(saved.maxCertifications === undefined ? {} : { maxCertifications: saved.maxCertifications }),
    ...(saved.compact === undefined ? {} : { compact: saved.compact }),
  };
}
