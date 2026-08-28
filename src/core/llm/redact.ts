/**
 * Seudonimización (T-4.2, `docs/llm-integration.md` §4.2, canon C4): la única puerta por la que
 * un texto sale hacia un modelo. Sustituye el nombre del usuario, opcionalmente las empresas, y
 * siempre emails, teléfonos y URLs por marcadores estables; devuelve la tabla para deshacerlo en
 * las propuestas. Función pura: la minimización de campos (qué se envía) la hace el llamador
 * construyendo el fragmento; aquí se limpia el contenido de lo que se envía.
 */

export interface RedactionOptions {
  /** Nombre completo del usuario; sus partes con 3+ letras también se sustituyen. */
  readonly fullName: string;
  /** Empresas a seudonimizar (`[EMPRESA-n]`); por defecto se conservan como contexto. */
  readonly companies?: readonly string[] | undefined;
}

export interface Redaction {
  /** Marcador → texto original, en orden de creación. */
  readonly table: ReadonlyMap<string, string>;
  /** Texto seudonimizado. */
  redact(text: string): string;
  /** Deshace los marcadores en una propuesta del modelo. */
  restore(text: string): string;
}

export const PLACEHOLDERS = { name: '[NOMBRE]', email: '[EMAIL]', phone: '[TELÉFONO]', url: '[URL]' } as const;

const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.\p{L}{2,}/gu;
/** URLs sin la puntuación final de la frase (`www.ejemplo.com.` → `www.ejemplo.com`). */
const URL = /\b(?:https?:\/\/|www\.)[^\s)]*[^\s).,;:!?]/giu;
/** Teléfonos internacionales o nacionales con 9+ dígitos, con separadores habituales. */
const PHONE = /(?<![\p{L}\p{N}])\+?\d[\d ().-]{7,}\d(?![\p{L}\p{N}])/gu;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Coincidencia de palabra completa respetando letras Unicode. El nombre completo se busca sin
 * distinguir mayúsculas; sus partes y las empresas, con la grafía exacta: son nombres propios y
 * «Ejemplo» no debe convertir «un programa de ejemplo» en «un programa de [NOMBRE]».
 */
function wordPattern(term: string, caseSensitive: boolean): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}(?![\\p{L}\\p{N}])`, caseSensitive ? 'gu' : 'giu');
}

/** Partes del nombre con 3+ letras (evita sustituir «de», «la»…). */
export function nameParts(fullName: string): string[] {
  return [...new Set(fullName.split(/\s+/).filter((part) => [...part].filter((character) => /\p{L}/u.test(character)).length >= 3))];
}

export function createRedaction(options: RedactionOptions): Redaction {
  const table = new Map<string, string>();
  const rules: Array<{ readonly pattern: RegExp; readonly placeholder: string }> = [];
  const fullName = options.fullName.trim();
  if (fullName !== '') {
    table.set(PLACEHOLDERS.name, fullName);
    rules.push({ pattern: wordPattern(fullName, false), placeholder: PLACEHOLDERS.name });
    for (const part of nameParts(fullName)) {
      rules.push({ pattern: wordPattern(part, true), placeholder: PLACEHOLDERS.name });
    }
  }
  (options.companies ?? []).forEach((company, index) => {
    const placeholder = `[EMPRESA-${index + 1}]`;
    table.set(placeholder, company);
    rules.push({ pattern: wordPattern(company, true), placeholder });
  });

  const counted = (kind: 'email' | 'phone' | 'url', found: string): string => {
    const base = PLACEHOLDERS[kind];
    for (const [placeholder, original] of table) {
      if (original === found && placeholder.startsWith(base.slice(0, -1))) {
        return placeholder;
      }
    }
    const placeholder = `${base.slice(0, -1)}-${[...table.keys()].filter((key) => key.startsWith(base.slice(0, -1))).length + 1}]`;
    table.set(placeholder, found);
    return placeholder;
  };

  return {
    table,
    redact(text) {
      let result = text.replace(EMAIL, (found) => counted('email', found)).replace(URL, (found) => counted('url', found)).replace(PHONE, (found) => counted('phone', found));
      for (const rule of rules) {
        result = result.replace(rule.pattern, rule.placeholder);
      }
      return result;
    },
    restore(text) {
      let result = text;
      for (const [placeholder, original] of table) {
        result = result.split(placeholder).join(original);
      }
      return result;
    },
  };
}
