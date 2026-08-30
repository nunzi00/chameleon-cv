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
