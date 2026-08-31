/**
 * Calidad de la extracción (T-8.4b F2, docs/cv-import.md §2): avisos sobre el TEXTO recuperado del fichero,
 * antes de estructurarlo. No cambian el borrador ni descartan nada: alimentan el informe para que quien revisa
 * sepa por qué faltan cosas (un escaneo con OCR sucio, una plantilla sin rellenar o un PDF sin capa de texto).
 */

/** Marcadores de plantilla: «[Tu nombre]», «<Company Name>», «Lorem ipsum», «XXXX». */
const PLACEHOLDER = /\[[^\]\n]{2,40}\]|<[^<>\n]{2,40}>|lorem ipsum|\bxx+\b|\btu nombre\b|\byour name\b|\bnombre y apellidos?\b|\bjob title\b|\bcompany name\b|\bnombre de la empresa\b/giu;

/** Un fragmento con residuos de OCR: símbolos de ruido, una cifra dentro de la palabra, dos puntos entre letras o «201&». */
function isGarbled(word: string): boolean {
  if (!/[\p{L}0-9]/u.test(word)) {
    return false;
  }
  return /[<>~|■°^\\]/u.test(word) || /\p{L}[0-9]\p{L}/u.test(word) || /\p{L}:\p{L}/u.test(word) || /[0-9][&#*]|[&#*][0-9]/u.test(word);
}

export interface QualityInput {
  /** El texto tal como se extrajo del fichero. */
  readonly text: string;
  /** Entradas reconocidas (experiencias + proyectos + formaciones + certificaciones). */
  readonly entries: number;
}

/** Avisos de calidad, en orden de gravedad; vacío si el texto no da motivos de sospecha. */
export function qualityWarnings({ text, entries }: QualityInput): readonly string[] {
  const warnings: string[] = [];
  const words = text.split(/\s+/).filter((word) => word !== '');
  if (words.length < 40) {
    warnings.push(`el texto extraído es muy corto (${words.length} palabras): puede que el fichero sea una imagen sin capa de texto`);
    return warnings;
  }
  const garbled = words.filter(isGarbled);
  if (garbled.length >= 6 && garbled.length / words.length > 0.02) {
    warnings.push(`la extracción parece un escaneo con OCR de baja calidad (${garbled.length} fragmentos ilegibles, por ejemplo «${garbled.slice(0, 3).join('», «')}»): revisa fechas, nombres y centros`);
  }
  const placeholders = text.match(PLACEHOLDER) ?? [];
  if (placeholders.length >= 3) {
    warnings.push(`parece una plantilla sin rellenar (${placeholders.length} marcadores, por ejemplo «${placeholders.slice(0, 2).join('», «')}»): rellénala antes de importarla`);
  }
  if (entries === 0) {
    warnings.push('no se reconoció ninguna entrada con fechas: revisa el texto sin situar del final; puede que no sea un CV o que su maquetación no se reconozca');
  }
  return warnings;
}
