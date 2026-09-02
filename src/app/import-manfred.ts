/**
 * Importar un MAC de Manfred como borrador de fuentes (T-9.22, `docs/cv-import.md` §12). Comparte con
 * `import-cv` el destino, el nombre de la carpeta y el informe (`writeDraft`); lo único propio es de dónde sale
 * el `DraftProfile`: aquí de un JSON estructurado en vez de una maquetación adivinada.
 *
 * Sin red: el `$schema` que el fichero declara no se descarga. Lo que el MAC trae y el perfil no guarda encabeza
 * el informe como aviso, para que se vea qué se quedó en Manfred.
 */
import { draftFiles, importManfredMac } from '../import';
import type { AppContext } from './context';
import { dataError } from './errors';
import { writeDraft, type ImportCvOptions, type ImportCvResult } from './import-cv';

export type ImportManfredResult = ImportCvResult;

/** Del JSON del MAC al borrador escrito; `origin` solo se usa en el informe. */
export async function importManfredDraft(context: AppContext, bytes: Uint8Array, origin: string, options: Pick<ImportCvOptions, 'name' | 'replace'>): Promise<ImportManfredResult> {
  const parsed = importManfredMac(bytes);
  if (!parsed.ok) {
    return { ok: false, error: dataError(parsed.message) };
  }
  const plain = draftFiles(parsed.draft);
  // Lo no importado va delante: explica lo que falta antes que lo que el esquema degradó.
  const result = { ...plain, issues: [...parsed.notes.map((reason) => ({ reason })), ...plain.issues] };
  const importedAt = (context.now?.() ?? new Date()).toISOString();
  return writeDraft(context, result, origin, importedAt, [], options);
}
