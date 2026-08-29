import { checkArtifactFreshness, freshnessWarning } from '../app/freshness';
import type { FileSystem } from '../parsers';
import { formatWarning } from './output';

export { checkArtifactFreshness, freshnessWarning, type AppWarning, type Freshness } from '../app/freshness';

/** Aviso estándar de `generate-cv` y `analyze-offer` cuando el artefacto puede estar obsoleto. */
export async function warnIfStale(context: { readonly stderr: (text: string) => void; readonly datasetFileSystem: FileSystem }, artifactPath: string, sourcesRoot: string): Promise<void> {
  const warning = freshnessWarning(await checkArtifactFreshness(context.datasetFileSystem, artifactPath, sourcesRoot));
  if (warning !== undefined) {
    context.stderr(formatWarning(warning));
  }
}
