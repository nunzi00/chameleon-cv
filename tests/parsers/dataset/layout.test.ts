import { describe, expect, it } from 'vitest';

import { DATASET_LIMITS, isInside, planDataset, type PlanResult } from '../../../src/parsers/dataset/layout';
import { MemoryFileSystem, datasetTree, type MemoryEntry } from '../../helpers/memory-file-system';

async function plan(tree: Record<string, string | MemoryEntry>, root = '/data'): Promise<PlanResult> {
  return planDataset(root, new MemoryFileSystem(tree));
}

async function expectErrors(tree: Record<string, string | MemoryEntry>, root = '/data'): Promise<string[]> {
  const result = await plan(tree, root);
  if (result.ok) {
    throw new Error('Se esperaban errores');
  }
  return result.errors.map((error) => `${error.file}: ${error.message}`);
}

describe('planDataset', () => {
  it('devuelve los ficheros en orden de documento e ignora ocultos, README y ficheros que no son .md', async () => {
    const result = await plan(
      datasetTree({
        '/data/README.md': '# ignorado',
        '/data/.obsidian/workspace.json': '{}',
        '/data/.hidden.md': 'oculto',
        '/data/achievements.md': '- x',
        '/data/skills.csv': 'name',
        '/data/certifications.csv': 'name',
        '/data/projects/zeta.md': '',
        '/data/projects/alpha.md': '',
        '/data/experience/acme.md': '',
        '/data/experience/notes.txt': 'ignorado',
        '/data/experience/.draft.md': 'ignorado',
        '/data/experience/socket': { kind: 'other' },
        '/data/education/uni.md': '',
        '/data/specialties/backend.md': '',
      }),
    );
    expect(result).toEqual({
      ok: true,
      files: [
        { path: 'profile.md', absolutePath: '/data/profile.md' },
        { path: 'specialties/backend.md', absolutePath: '/data/specialties/backend.md' },
        { path: 'experience/acme.md', absolutePath: '/data/experience/acme.md' },
        { path: 'projects/alpha.md', absolutePath: '/data/projects/alpha.md' },
        { path: 'projects/zeta.md', absolutePath: '/data/projects/zeta.md' },
        { path: 'education/uni.md', absolutePath: '/data/education/uni.md' },
        { path: 'achievements.md', absolutePath: '/data/achievements.md' },
        { path: 'skills.csv', absolutePath: '/data/skills.csv' },
        { path: 'certifications.csv', absolutePath: '/data/certifications.csv' },
      ],
    });
  });

  it('sigue los enlaces simbólicos que se quedan dentro del dataset, resolviendo la ruta real', async () => {
    const result = await plan(
      datasetTree({
        '/data/.shared/real/acme.md': '',
        '/data/experience': { kind: 'symlink', target: '/data/.shared/real' },
        '/data/projects/link.md': { kind: 'symlink', target: '/data/.shared/real/acme.md' },
      }),
    );
    expect(result.ok && result.files.map((file) => `${file.path} -> ${file.absolutePath}`)).toEqual([
      'profile.md -> /data/profile.md',
      'experience/acme.md -> /data/.shared/real/acme.md',
      'projects/link.md -> /data/.shared/real/acme.md',
    ]);
  });

  it('rechaza enlaces rotos o que salen del dataset, en la raíz y en los directorios de entidades', async () => {
    expect(
      await expectErrors(
        datasetTree({
          '/etc/passwd': 'root',
          '/data/achievements.md': { kind: 'symlink', target: '/etc/passwd' },
          '/data/experience/escape.md': { kind: 'symlink', target: '/etc/passwd' },
          '/data/projects/broken.md': { kind: 'symlink', target: '/data/nope.md' },
        }),
      ),
    ).toEqual([
      'achievements.md: Enlace simbólico que apunta fuera del dataset',
      'experience/escape.md: Enlace simbólico que apunta fuera del dataset',
      'projects/broken.md: Enlace simbólico roto',
    ]);
  });

  it('exige que la raíz exista y sea un directorio', async () => {
    expect(await expectErrors(datasetTree(), '/nope')).toEqual(['.: No se encuentra el directorio del dataset: /nope']);
    expect(await expectErrors(datasetTree(), '/data/profile.md')).toEqual(['.: La ruta del dataset no es un directorio: /data/profile.md']);
  });

  it('es estricto en la raíz: ficheros, directorios y entradas desconocidos son error', async () => {
    expect(
      await expectErrors(
        datasetTree({
          '/data/notas.md': '',
          '/data/experiencia/acme.md': '',
          '/data/pipe': { kind: 'other' },
        }),
      ),
    ).toEqual([
      'experiencia/: Directorio no reconocido (admitidos: specialties, experience, projects, education)',
      'notas.md: Fichero no reconocido en la raíz del dataset (admitidos: profile.md, achievements.md, skills.csv, certifications.csv)',
      'pipe: Entrada de tipo no admitido (ni fichero ni directorio)',
    ]);
  });

  it('exige profile.md', async () => {
    expect(await expectErrors({ '/data/achievements.md': '- x' })).toEqual(['profile.md: Falta el fichero obligatorio']);
  });

  it('valida los nombres de fichero de las entidades y prohíbe subdirectorios', async () => {
    expect(
      await expectErrors(
        datasetTree({
          '/data/experience/Acme.md': '',
          '/data/experience/acme_v2.md': '',
          '/data/experience/acme.en.md': '',
          '/data/experience/2019/old.md': '',
        }),
      ),
    ).toEqual([
      'experience/2019/: No se admiten subdirectorios dentro de un directorio de entidades',
      'experience/Acme.md: Nombre de fichero inválido: usa minúsculas, dígitos y guiones (p. ej. acme.md)',
      'experience/acme.en.md: La extensión .<locale>.md está reservada para overlays de idioma (aún no soportados)',
      'experience/acme_v2.md: Nombre de fichero inválido: usa minúsculas, dígitos y guiones (p. ej. acme.md)',
    ]);
  });

  it('aplica los límites de tamaño y número de ficheros', async () => {
    expect(await expectErrors(datasetTree({ '/data/achievements.md': 'x'.repeat(DATASET_LIMITS.maxFileBytes + 1) }))).toEqual([
      `achievements.md: Fichero demasiado grande: ${DATASET_LIMITS.maxFileBytes + 1} bytes (máximo ${DATASET_LIMITS.maxFileBytes})`,
    ]);
    const many: Record<string, string> = {};
    for (let index = 0; index < DATASET_LIMITS.maxFiles; index += 1) {
      many[`/data/projects/p${String(index).padStart(3, '0')}.md`] = '';
    }
    expect(await expectErrors(datasetTree(many))).toEqual([
      `.: Demasiados ficheros: ${DATASET_LIMITS.maxFiles + 1} (máximo ${DATASET_LIMITS.maxFiles})`,
    ]);
  });
});

describe('isInside', () => {
  it('acepta la raíz y sus descendientes, no los hermanos con prefijo común', () => {
    expect(isInside('/data', '/data')).toBe(true);
    expect(isInside('/data', '/data/x/y.md')).toBe(true);
    expect(isInside('/data', '/data-backup/x.md')).toBe(false);
  });
});
