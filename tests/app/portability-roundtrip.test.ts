import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { canonicalOrder, exportProfile, importProfile, parseProfileJson } from '../../src/app/portability';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

/** Los datasets reales del repositorio, cargados en memoria bajo /work/data/sources. */
const DATASETS = ['templates/dataset', 'tests/acceptance/bench/workspace/data/sources'];

function treeOf(directory: string, target: string): Record<string, string> {
  const tree: Record<string, string> = {};
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      Object.assign(tree, treeOf(path, `${target}/${entry.name}`));
    } else {
      tree[`${target}/${entry.name}`] = readFileSync(path, 'utf8');
    }
  }
  return tree;
}

function value(json: string): unknown {
  const parsed = parseProfileJson(json);
  if (!parsed.ok) {
    throw new Error(parsed.error.message);
  }
  return parsed.value;
}

describe.each(DATASETS)('ida y vuelta sobre %s', (dataset) => {
  it('build(import(export(S))) ≡ export(S) y la regeneración es idempotente byte a byte', async () => {
    const fs = new MemoryFileSystem(treeOf(resolve(process.cwd(), dataset), '/work/data/sources'));
    const context = appContext(fs);
    const exported = await exportProfile(context, { data: 'data/sources' });
    expect(exported.ok).toBe(true);
    if (!exported.ok) {
      return;
    }
    const imported = await importProfile(context, value(exported.json), { data: 'data/imported' });
    expect(imported.ok).toBe(true);
    if (!imported.ok) {
      return;
    }
    expect(imported.outcome.plan.warnings.filter((warning) => warning.startsWith('El orden'))).toEqual([]);
    const reexported = await exportProfile(context, { data: 'data/imported' });
    expect(reexported.ok && reexported.profile).toEqual(canonicalOrder(exported.profile).profile);
    expect(reexported.ok && reexported.json).toBe(exported.json);
    const again = await importProfile(context, value(reexported.ok ? reexported.json : ''), { data: 'data/imported2' });
    expect(again.ok && again.outcome.written).toEqual(imported.outcome.written);
    for (const path of imported.outcome.written) {
      expect(fs.file(`/work/data/imported2/${path}`)?.content).toBe(fs.file(`/work/data/imported/${path}`)?.content);
    }
  });
});
