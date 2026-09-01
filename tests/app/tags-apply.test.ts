/**
 * Escribir en las fuentes las etiquetas que el co-piloto sugirió (T-9.15). Lo que se prueba aquí es lo que
 * distingue a esto de un `sed`: que solo se añade lo que falta, que se añade **detrás de las etiquetas que la
 * viñeta ya tenía** y sin tocar el resto de la línea, y que en cuanto algo no cuadra —la fuente cambió, el
 * fichero no se puede leer o no se puede escribir— no se escribe nada y se dice por qué.
 */
import { describe, expect, it } from 'vitest';

import { applyTags, planApplyTags } from '../../src/app/tags-apply';
import { buildSourceIndex } from '../../src/app/provenance';
import { loadDataset, defaultSourceParsers } from '../../src/parsers';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const ACME = [
  '---',
  'company: ACME Corp',
  'role: Senior Backend Engineer',
  'start: 2021-03',
  'end: 2024-06',
  '---',
  '',
  '## Logros',
  '',
  '- Reduje la latencia p95 un **40 %**. #performance',
  '- Lideré la migración a Kubernetes. ',
  '',
].join('\n');

async function index(fs: MemoryFileSystem): Promise<ReturnType<typeof buildSourceIndex>> {
  const dataset = await loadDataset('/work/data/sources', { fileSystem: fs, parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error(JSON.stringify(dataset.errors));
  }
  return buildSourceIndex(dataset.profile, dataset.provenance);
}

/** El mismo disco con una operación rota: el resto sigue funcionando, como cuando falla de verdad. */
function rompe(fs: MemoryFileSystem, method: string, message: string): MemoryFileSystem {
  return new Proxy(fs, { get: (target, key) => (key === method ? () => Promise.reject(new Error(message)) : Reflect.get(target, key, target)) });
}

function workspace(acme = ACME): MemoryFileSystem {
  return new MemoryFileSystem({ '/work/data/sources/profile.md': '---\nfullName: Ada Ejemplo\n---\n', '/work/data/sources/experience/acme.md': acme });
}

describe('planApplyTags: qué se escribiría, antes de tocar nada', () => {
  it('el mismo logro dos veces, uno que no está en las fuentes y uno sin etiquetas válidas se quedan fuera', async () => {
    const fs = workspace();
    const sources = await index(fs);
    const [id] = [...sources.achievements.keys()];
    expect(planApplyTags(sources, [{ id: id!, tags: ['kubernetes'] }, { id: id!, tags: ['php'] }])).toEqual([
      { ok: true, id, file: 'experience/acme.md', line: expect.any(Number) as number, text: expect.any(String) as string, add: ['kubernetes'] },
      { ok: false, id, reason: 'repetido en la misma petición' },
    ]);
    expect(planApplyTags(sources, [{ id: 'exp-inventado-9', tags: ['php'] }])[0]).toMatchObject({ ok: false, reason: expect.stringContaining('no está en las fuentes') as string });
    // «PIN» y una cadena vacía no pasan el esquema de etiquetas: no queda ninguna que escribir.
    expect(planApplyTags(sources, [{ id: id!, tags: ['  ', '#nope!'] }])[0]).toMatchObject({ ok: false, reason: 'ninguna etiqueta válida que añadir' });
  });
});

describe('applyTags: la escritura mínima', () => {
  it('añade solo lo que falta, detrás de las que ya había, y deja copia', async () => {
    const fs = workspace();
    const sources = await index(fs);
    const [primero, segundo] = [...sources.achievements.keys()];
    const plan = planApplyTags(sources, [
      { id: primero!, tags: ['performance', 'php', 'PHP'] },
      { id: segundo!, tags: ['kubernetes'] },
    ]);
    const outcome = await applyTags(appContext(fs), 'data/sources', plan);
    expect(outcome.ok && outcome.result.applied).toEqual([
      { id: segundo, added: ['kubernetes'] },
      { id: primero, added: ['php'] },
    ]);
    expect(outcome.ok && outcome.result.written).toEqual([{ file: 'experience/acme.md', backup: 'acme.md.bak', ids: [segundo, primero] }]);
    const escrito = fs.file('/work/data/sources/experience/acme.md')?.content ?? '';
    expect(escrito).toContain('un **40 %**. #performance #php\n');
    // La viñeta acaba en un espacio suelto y sigue ahí: se inserta donde acaba el texto, no se \"limpia\" la línea.
    expect(escrito).toContain('a Kubernetes. #kubernetes \n');
    expect(fs.file('/work/data/sources/experience/acme.md.bak')?.content).toBe(ACME);
  });

  it('lo que la viñeta ya tenía no se repite, y si nada queda por escribir el fichero no se toca', async () => {
    const fs = workspace();
    const sources = await index(fs);
    const [primero] = [...sources.achievements.keys()];
    const outcome = await applyTags(appContext(fs), 'data/sources', planApplyTags(sources, [{ id: primero!, tags: ['performance'] }]));
    expect(outcome.ok && outcome.result).toMatchObject({ written: [], applied: [], skipped: [{ id: primero, reason: 'ya las tenía' }] });
    expect(fs.file('/work/data/sources/experience/acme.md')?.content).toBe(ACME);
    expect(fs.file('/work/data/sources/experience/acme.md.bak')).toBeUndefined();
  });

  it('si el logro cambió a mano desde que se sugirió, ese no se escribe', async () => {
    const fs = workspace();
    const sources = await index(fs);
    const [primero] = [...sources.achievements.keys()];
    const plan = planApplyTags(sources, [{ id: primero!, tags: ['php'] }]);
    await fs.writeFile('/work/data/sources/experience/acme.md', ACME.replace('Reduje la latencia p95 un **40 %**.', 'Otra cosa completamente distinta.'), 0o600);
    const outcome = await applyTags(appContext(fs), 'data/sources', plan);
    expect(outcome.ok && outcome.result.skipped).toEqual([{ id: primero, reason: 'el logro ya no está tal cual en experience/acme.md (¿editado a mano?)' }]);
    expect(outcome.ok && outcome.result.written).toEqual([]);
  });

  it('un fichero que no se puede leer o que no se puede escribir para la tanda entera', async () => {
    const fs = workspace();
    const sources = await index(fs);
    const [primero] = [...sources.achievements.keys()];
    const plan = planApplyTags(sources, [{ id: primero!, tags: ['php'] }]);

    const sinLectura = appContext(fs, { datasetFileSystem: rompe(fs, 'readTextFile', 'disco ocupado') });
    const leer = await applyTags(sinLectura, 'data/sources', plan);
    expect(leer.ok === false && leer.error.message).toContain('No se pudo leer experience/acme.md: disco ocupado');

    const sinEscritura = appContext(fs, { artifactFileSystem: rompe(fs, 'writeFile', 'solo lectura') });
    const escribir = await applyTags(sinEscritura, 'data/sources', plan);
    expect(escribir.ok === false && escribir.error.message).toContain('No se pudo escribir experience/acme.md: solo lectura');
    // Y nada a medias: la fuente sigue como estaba.
    expect(fs.file('/work/data/sources/experience/acme.md')?.content).toBe(ACME);
  });
});
