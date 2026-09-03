/**
 * `theme.toml` (T-5.1, Hito 5): las variables de diseño de un tema —colores, tipografías,
 * tamaños, espaciados y página— leídas de TOML y validadas con zod antes de llegar a Typst.
 * Todo es estricto: una clave desconocida o un valor fuera de rango es un error con su ruta.
 */
import { TomlError, parse } from 'smol-toml';
import { z } from 'zod';

import { describeError } from '../shared/errors';

z.config(z.locales.es());

const Color = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { error: 'Color inválido: usa #rrggbb (p. ej. "#1f4e79")' })
  .transform((value) => value.toLowerCase());
const FontName = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[\p{L}\p{N} .+_-]+$/u, { error: 'Nombre de fuente inválido: letras, dígitos, espacios y . + _ -' });
const Points = z.number().min(4, { error: 'Tamaño demasiado pequeño (mínimo 4 pt)' }).max(72, { error: 'Tamaño demasiado grande (máximo 72 pt)' });
const Ems = z.number().min(0.1, { error: 'Espaciado demasiado pequeño (mínimo 0.1 em)' }).max(4, { error: 'Espaciado demasiado grande (máximo 4 em)' });
const Millimetres = z.number().min(0, { error: 'Margen negativo' }).max(80, { error: 'Margen demasiado grande (máximo 80 mm)' });

/** Tamaños de página admitidos (nombres de Typst). */
export const PAPER_SIZES = ['a4', 'a5', 'a3', 'us-letter', 'us-legal'] as const;

export const THEME_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * Las secciones que un tema puede reordenar. La portada —nombre, titular, contacto y resumen— no entra: es lo
 * primero en todos los CV del catálogo, y hacerla movible sería ofrecer una opción que nadie quiere.
 */
export const LAYOUT_SECTIONS = ['experience', 'projects', 'skills', 'achievements', 'education', 'certifications', 'languages'] as const;
export type LayoutSection = (typeof LAYOUT_SECTIONS)[number];

export const ThemeConfigSchema = z.strictObject({
  theme: z.strictObject({
    /** Si se indica, debe coincidir con el nombre del directorio del tema. */
    name: z.string().regex(THEME_NAME_PATTERN, { error: 'Nombre de tema inválido: minúsculas, dígitos y guiones' }).optional(),
    description: z.string().trim().max(200).optional(),
    /** Versión del formato de theme.toml. */
    version: z.literal(1),
    /** Autoría (T-8.3): quién lo hizo, con qué licencia (se sugiere un identificador SPDX) y dónde vive. */
    author: z.string().trim().min(1).max(120).optional(),
    license: z.string().trim().min(1).max(60).optional(),
    homepage: z.string().trim().max(2048).pipe(z.url({ protocol: /^https$/, error: 'homepage debe ser una URL https' })).optional(),
    /** Qué aporta el tema (T-8.12): una organización del contenido (`organization`) o un estilo sobre la cronológica (`style`). */
    kind: z.enum(['organization', 'style'], { error: 'kind debe ser organization o style' }).optional(),
  }),
  colors: z.strictObject({
    /** Cuerpo de texto. */
    text: Color,
    /** Nombre y títulos de entrada. */
    primary: Color,
    /** Metadatos, fechas y etiquetas de sección. */
    secondary: Color,
    /** Enlaces. */
    accent: Color,
    /** Reglas y filetes. */
    rule: Color,
  }),
  fonts: z.strictObject({
    body: FontName,
    heading: FontName,
    mono: FontName,
  }),
  /** En puntos. */
  sizes: z.strictObject({
    name: Points,
    headline: Points,
    contact: Points,
    section: Points,
    title: Points,
    meta: Points,
    body: Points,
    footer: Points,
    code: Points,
  }),
  /** En «em» del cuerpo. */
  spacing: z.strictObject({
    leading: Ems,
    paragraph: Ems,
    list: Ems,
  }),
  page: z.strictObject({
    paper: z.enum(PAPER_SIZES),
    /** En milímetros. */
    margins: z.strictObject({ top: Millimetres, right: Millimetres, bottom: Millimetres, left: Millimetres }),
  }),
  /**
   * La **organización** del contenido, dicha de forma declarativa (T-9.26). Hasta aquí, lo que un tema hacía
   * con las secciones vivía en su `template.typ`, que es código Typst: legible para el motor PDF e invisible
   * para cualquier otra salida. Por eso el ODT solo tenía una forma posible.
   *
   * Esto NO sustituye a la plantilla —una columna lateral o una tabla de dos columnas no caben en tres
   * claves—: la describe en lo que sí es común a todas las salidas (qué va antes, dónde viven los logros y
   * cuánto se cuenta de cada puesto), que es lo que un documento editable puede reproducir.
   */
  layout: z
    .strictObject({
      /** Orden de las secciones; las que falten van detrás, en el orden por defecto. La portada no se mueve. */
      sections: z
        .array(z.enum(LAYOUT_SECTIONS))
        .max(LAYOUT_SECTIONS.length)
        .refine((values) => new Set(values).size === values.length, { error: 'sections no admite secciones repetidas' })
        .optional(),
      /** `per-entry` (por defecto): cada logro bajo su puesto. `consolidated`: todos juntos, con su origen. */
      achievements: z.enum(['per-entry', 'consolidated'], { error: 'achievements debe ser per-entry o consolidated' }).optional(),
      /** `detailed` (por defecto) o `compact`: una línea por puesto, sin resumen ni logros. */
      experience: z.enum(['detailed', 'compact'], { error: 'experience debe ser detailed o compact' }).optional(),
    })
    .optional(),
});

export type ThemeConfig = z.output<typeof ThemeConfigSchema>;
/** `organization` (orden y agrupación de las secciones) o `style` (maquetación sobre la cronológica), T-8.12. */
export type ThemeKind = NonNullable<ThemeConfig['theme']['kind']>;

export type ThemeParseResult = { readonly ok: true; readonly config: ThemeConfig } | { readonly ok: false; readonly errors: readonly string[] };

/** Mensaje de un error de sintaxis TOML con su línea; solo la primera línea del diagnóstico. */
export function tomlErrorMessage(error: unknown): string {
  const first = describeError(error).split('\n', 1).join('');
  return error instanceof TomlError ? `línea ${error.line}: ${first}` : first;
}

export type TomlParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly errors: readonly string[] };

/** TOML → esquema zod; cada error lleva su ruta (`colors.primary: …`) o la línea del fallo de sintaxis. */
export function parseTomlWith<T>(schema: z.ZodType<T>, text: string): TomlParseResult<T> {
  let data: unknown;
  try {
    data = parse(text);
  } catch (error) {
    return { ok: false, errors: [tomlErrorMessage(error)] };
  }
  const result = schema.safeParse(data);
  if (!result.success) {
    return { ok: false, errors: result.error.issues.map((issue) => `${issue.path.length === 0 ? '<raíz>' : issue.path.join('.')}: ${issue.message}`) };
  }
  return { ok: true, value: result.data };
}

export function parseThemeConfig(text: string): ThemeParseResult {
  const parsed = parseTomlWith(ThemeConfigSchema, text);
  return parsed.ok ? { ok: true, config: parsed.value } : parsed;
}
