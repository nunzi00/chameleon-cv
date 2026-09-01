/**
 * Cerrar el bucle del alias (T-9.12): lo que el co-piloto tuvo que tender puede dejar de necesitarlo. Se prueba
 * lo que decide —a qué skill pertenece cada frase, y cuándo no se sabe— y cómo escribe: **fila a fila**, sin
 * reescribir el fichero ni tocar una coma de las demás skills.
 */
import { describe, expect, it } from 'vitest';

import { planAliases, saveAliases } from '../../src/app/aliases';
import { parseMasterProfile } from '../../src/core/schema';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const PROFILE = parseMasterProfile({
  meta: { schemaVersion: 1 },
  personal: { fullName: 'Ada Ejemplo', links: [] },
  specialties: [],
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  skills: [
    { id: 'skill-kafka', name: 'Apache Kafka', category: 'platform', aliases: ['kafka'], tags: ['kafka', 'mensajeria'] },
    { id: 'skill-rabbit', name: 'RabbitMQ', category: 'platform', aliases: [], tags: ['mensajeria'] },
    { id: 'skill-php', name: 'PHP', category: 'language', aliases: ['php 8'], tags: ['php'] },
  ],
  achievements: [],
  languages: [],
});

const CSV = ['name,category,level,years,aliases,tags', 'Apache Kafka,platform,advanced,,kafka,kafka|mensajeria', 'RabbitMQ,platform,advanced,,,mensajeria', '"PHP, el lenguaje",language,expert,,php 8,php', ''].join('\n');

function workspace(): MemoryFileSystem {
  return new MemoryFileSystem({ '/work/data/sources/skills.csv': CSV });
}

describe('planAliases: de una propuesta verificada a un alias concreto', () => {
  it('la etiqueta que es de UNA skill da un alias con nombre y apellidos', () => {
    expect(planAliases(PROFILE, [{ tag: 'kafka', evidence: 'sistemas de mensajería' }])).toEqual([
      { ok: true, tag: 'kafka', alias: 'sistemas de mensajería', skill: 'Apache Kafka' },
    ]);
  });

  it('si la etiqueta es de varias skills no se adivina: se dice de cuáles y se deja al usuario', () => {
    const [entry] = planAliases(PROFILE, [{ tag: 'mensajeria', evidence: 'colas de mensajes' }]);
    expect(entry).toMatchObject({ ok: false, tag: 'mensajeria' });
    expect(entry?.ok === false && entry.reason).toContain('Apache Kafka, RabbitMQ');
  });

  it('una etiqueta sin skill, una frase que ya se reconoce y una repetida no se guardan', () => {
    const plan = planAliases(PROFILE, [
      { tag: 'terraform', evidence: 'infraestructura como código' },
      { tag: 'php', evidence: 'PHP 8' },
      { tag: 'kafka', evidence: '  sistemas   de mensajería ' },
      { tag: 'kafka', evidence: 'sistemas de mensajería' },
      { tag: 'kafka', evidence: '   ' },
    ]);
    expect(plan.map((entry) => entry.ok)).toEqual([false, false, true]);
    expect(plan[0]?.ok === false && plan[0].reason).toContain('ninguna skill');
    expect(plan[1]?.ok === false && plan[1].reason).toContain('ya lo reconoce');
    // Los espacios de más se normalizan y la repetición se descarta antes de llegar al disco.
    expect(plan[2]).toMatchObject({ alias: 'sistemas de mensajería' });
  });
});

describe('saveAliases: se añade a la fila, no se reescribe el fichero', () => {
  it('el alias entra al final de su columna y el resto del fichero queda igual', async () => {
    const fs = workspace();
    const plan = planAliases(PROFILE, [{ tag: 'kafka', evidence: 'sistemas de mensajería' }]);
    const saved = await saveAliases(appContext(fs), 'data/sources', plan);
    expect(saved.ok && saved.result.written).toHaveLength(1);
    const lines = (fs.file('/work/data/sources/skills.csv')?.content ?? '').split('\n');
    expect(lines[1]).toBe('Apache Kafka,platform,advanced,,kafka|sistemas de mensajería,kafka|mensajeria');
    // Ni la cabecera, ni las otras filas, ni la fila entrecomillada se tocan.
    expect(lines[0]).toBe('name,category,level,years,aliases,tags');
    expect(lines[2]).toBe('RabbitMQ,platform,advanced,,,mensajeria');
    expect(lines[3]).toBe('"PHP, el lenguaje",language,expert,,php 8,php');
    expect(fs.file('/work/data/sources/skills.csv')?.mode).toBe(0o600);
  });

  it('una skill sin alias estrena la columna, y una coma en la frase se entrecomilla', async () => {
    const fs = workspace();
    const saved = await saveAliases(appContext(fs), 'data/sources', [{ ok: true, tag: 'mensajeria', alias: 'colas, temas y particiones', skill: 'RabbitMQ' }]);
    expect(saved.ok).toBe(true);
    expect((fs.file('/work/data/sources/skills.csv')?.content ?? '').split('\n')[2]).toBe('RabbitMQ,platform,advanced,,"colas, temas y particiones",mensajeria');
  });

  it('sin nada que guardar no se toca el fichero', async () => {
    const fs = workspace();
    const saved = await saveAliases(appContext(fs), 'data/sources', [{ ok: false, tag: 'x', alias: 'y', reason: 'porque no' }]);
    expect(saved.ok && saved.result.written).toEqual([]);
    expect(fs.file('/work/data/sources/skills.csv')?.content).toBe(CSV);
  });

  it('una skill que ya no está en el fichero se salta sin romper nada', async () => {
    const fs = workspace();
    const saved = await saveAliases(appContext(fs), 'data/sources', [{ ok: true, tag: 'kafka', alias: 'x', skill: 'Ya no existe' }]);
    expect(saved.ok && saved.result.written).toEqual([]);
    expect(fs.file('/work/data/sources/skills.csv')?.content).toBe(CSV);
  });

  it('si el disco falla al escribir, se dice y no se finge que se guardó', async () => {
    const fs = workspace();
    const roto = Object.assign(Object.create(fs) as MemoryFileSystem, { writeFile: () => Promise.reject(new Error('EROFS: solo lectura')) });
    const saved = await saveAliases(appContext(roto), 'data/sources', [{ ok: true, tag: 'kafka', alias: 'x', skill: 'Apache Kafka' }]);
    expect(saved).toMatchObject({ ok: false, error: { code: 'environment', message: expect.stringContaining('EROFS') as string } });
  });

  it('un CSV vacío o una fila con menos columnas de la cuenta no rompen nada', async () => {
    const vacio = new MemoryFileSystem({ '/work/data/sources/skills.csv': '' });
    expect(await saveAliases(appContext(vacio), 'data/sources', [{ ok: true, tag: 'kafka', alias: 'x', skill: 'Apache Kafka' }])).toMatchObject({ ok: false });
    // Y una fila tan corta que ni llega a la columna del nombre: se salta sin más.
    const sinNombre = new MemoryFileSystem({ '/work/data/sources/skills.csv': 'id,name,aliases\nsolo-un-campo\n' });
    const nada = await saveAliases(appContext(sinNombre), 'data/sources', [{ ok: true, tag: 'kafka', alias: 'colas', skill: 'Apache Kafka' }]);
    expect(nada.ok && nada.result.written).toEqual([]);

    // Una fila a medias —editada a mano— se salta; el resto del fichero sigue igual.
    const corto = new MemoryFileSystem({ '/work/data/sources/skills.csv': 'name,category,level,years,aliases,tags\nApache Kafka,platform\n' });
    const saved = await saveAliases(appContext(corto), 'data/sources', [{ ok: true, tag: 'kafka', alias: 'colas', skill: 'Apache Kafka' }]);
    expect(saved.ok && saved.result.written).toHaveLength(1);
    expect((corto.file('/work/data/sources/skills.csv')?.content ?? '').split('\n')[1]).toBe('Apache Kafka,platform,,,colas');
  });

  it('sin fichero, o sin las columnas que hacen falta, se explica en vez de adivinar', async () => {
    const entry = { ok: true as const, tag: 'kafka', alias: 'x', skill: 'Apache Kafka' };
    expect(await saveAliases(appContext(new MemoryFileSystem({})), 'data/sources', [entry])).toMatchObject({ ok: false, error: { code: 'not-found' } });
    const raro = new MemoryFileSystem({ '/work/data/sources/skills.csv': 'nombre,etiquetas\nApache Kafka,kafka\n' });
    expect(await saveAliases(appContext(raro), 'data/sources', [entry])).toMatchObject({ ok: false, error: { message: expect.stringContaining('«name» y «aliases»') as string } });
  });
});
