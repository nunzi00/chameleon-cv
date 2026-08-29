/**
 * Estado del espacio de trabajo para un cliente (docs/api-headless.md §5, `GET /status`): versión,
 * artefacto (existe, valida, está al día), especialidades, Typst, proveedor local y temas. Nunca sale a
 * la red más allá del loopback del proveedor local.
 */
import { resolve } from 'node:path';

import { isMissingFile, readProfileArtifact } from '../artifact';
import type { LlmStatus } from '../llm';
import type { TypstStatus } from '../typst';
import type { AppContext } from './context';
import { checkArtifactFreshness } from './freshness';
import { themeInventory, type ThemeInventory } from './themes';

export interface ArtifactSummary {
  readonly status: 'missing' | 'invalid' | 'fresh' | 'stale' | 'unknown';
  readonly detail: string | undefined;
  readonly specialties: readonly string[];
}

export interface WorkspaceStatus {
  readonly version: string;
  readonly cwd: string;
  readonly artifact: ArtifactSummary;
  readonly typst: TypstStatus;
  readonly llm: LlmStatus;
  readonly themes: ThemeInventory;
}

export function readVersion(source: string): string {
  const parsed: unknown = JSON.parse(source);
  if (typeof parsed === 'object' && parsed !== null && 'version' in parsed && typeof parsed.version === 'string') {
    return parsed.version;
  }
  return '0.0.0';
}

async function artifactSummary(context: AppContext, artifactPath: string, sourcesRoot: string): Promise<ArtifactSummary> {
  try {
    await context.artifactFileSystem.readFile(artifactPath);
  } catch (error) {
    return isMissingFile(error) ? { status: 'missing', detail: undefined, specialties: [] } : { status: 'unknown', detail: String(error), specialties: [] };
  }
  const artifact = await readProfileArtifact(context.artifactFileSystem, artifactPath);
  if (!artifact.ok) {
    return { status: 'invalid', detail: artifact.errors.join('; '), specialties: [] };
  }
  const specialties = artifact.profile.specialties.map((specialty) => specialty.id);
  const freshness = await checkArtifactFreshness(context.datasetFileSystem, artifactPath, sourcesRoot);
  if (freshness.status === 'fresh') {
    return { status: 'fresh', detail: undefined, specialties };
  }
  return freshness.status === 'stale' ? { status: 'stale', detail: freshness.newestSource, specialties } : { status: 'unknown', detail: freshness.reason, specialties };
}

export async function inspectWorkspace(context: AppContext, options: { readonly profile: string; readonly data: string }): Promise<WorkspaceStatus> {
  return {
    version: readVersion(await context.assets.text('package.json')),
    cwd: context.cwd,
    artifact: await artifactSummary(context, resolve(context.cwd, options.profile), resolve(context.cwd, options.data)),
    typst: await context.typstStatus({}),
    llm: await context.llmStatus({}),
    themes: await themeInventory(context),
  };
}
