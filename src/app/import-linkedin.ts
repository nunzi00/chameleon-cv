/**
 * Importar la exportación de datos de LinkedIn como borrador de fuentes (docs/cv-import.md §8). Comparte con
 * `import-cv` el destino, el nombre de la carpeta y el informe (`writeDraft`); lo único propio es de dónde sale
 * el `DraftProfile`: aquí de CSV estructurado en vez de una maquetación adivinada, así que no hay «sin situar».
 *
 * Sin red. La URL de un perfil no se descarga: el `robots.txt` de LinkedIn prohíbe el acceso automatizado y esa
 * URL devuelve el muro de acceso, no el CV. La exportación oficial es la vía sancionada y la de más fidelidad.
 */
import { draftFiles, importLinkedInExport } from '../import';
import type { AppContext } from './context';
import { dataError } from './errors';
import { writeDraft, type ImportCvOptions, type ImportCvResult } from './import-cv';

export type ImportLinkedInResult = ImportCvResult;

/** Del zip de la exportación al borrador escrito; `origin` solo se usa en el informe. */
export async function importLinkedInDraft(
  context: AppContext,
  bytes: Uint8Array,
  origin: string,
  options: Pick<ImportCvOptions, 'name' | 'replace'>,
): Promise<ImportLinkedInResult> {
  const parsed = importLinkedInExport(bytes);
  if (!parsed.ok) {
    return { ok: false, error: dataError(parsed.message) };
  }
  const result = draftFiles(parsed.draft);
  const importedAt = (context.now?.() ?? new Date()).toISOString();
  return writeDraft(context, result, origin, importedAt, [], options);
}
