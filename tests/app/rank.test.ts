/**
 * Comparar varias ofertas (T-9.13): el motor es el de siempre y lo que se prueba aquí es la **agregación** —qué
 * lleva cada fila y en qué orden salen— y que una oferta rota no tumbe la comparación.
 */
import { describe, expect, it } from 'vitest';

import { rankOffers } from '../../src/app/rank';
import { serializeProfile } from '../../src/artifact';
import { parseMasterProfile } from '../../src/core/schema';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const PROFILE = parseMasterProfile({
  meta: { schemaVersion: 1 },
  personal: { fullName: 'Ada Ejemplo', links: [] },
  specialties: [{ id: 'backend', title: 'Backend', tags: ['php', 'kubernetes'] }],
  experience: [
    {
      id: 'exp-acme',
      company: 'ACME',
      role: 'Backend',
      dates: { start: '2020-01' },
      technologies: [],
      tags: ['php'],
      achievements: [{ id: 'exp-acme-1', text: 'Migré la plataforma.', tags: ['php', 'kubernetes'] }],
    },
  ],
  projects: [],
  education: [],
  certifications: [],
  skills: [
    { id: 'skill-php', name: 'PHP', category: 'language', aliases: [], tags: ['php'] },
    { id: 'skill-k8s', name: 'Kubernetes', category: 'platform', aliases: [], tags: ['kubernetes'] },
  ],
  achievements: [],
  languages: [],
});

/** Una encaja del todo, la otra a medias y la tercera no se puede leer. */
const ENCAJA = ['Backend', '', 'Requisitos:', '- PHP en producción.', '- Kubernetes.'].join('\n');
const A_MEDIAS = ['Plataforma', '', 'Requisitos:', '- PHP.', '- Terraform y AWS.'].join('\n');

function workspace(): MemoryFileSystem {
  return new MemoryFileSystem({
    '/work/data/sources/profile.md': '---\nfullName: Ada Ejemplo\n---\n',
    '/work/data/dist/profile.json': { kind: 'file', content: serializeProfile(PROFILE), mode: 0o600 },
    '/work/offers/encaja.txt': ENCAJA,
    '/work/offers/a-medias.txt': A_MEDIAS,
  });
}

const REQUEST = { profile: 'data/dist/profile.json', data: 'data/sources', build: false };

describe('rankOffers', () => {
  it('ordena por imprescindibles cubiertos y da la misma cuenta que analizar una a una', async () => {
    const ranked = await rankOffers(appContext(workspace()), REQUEST, [
      { kind: 'file', path: 'offers/a-medias.txt' },
      { kind: 'file', path: 'offers/encaja.txt' },
    ]);
    expect(ranked.ok).toBe(true);
    if (!ranked.ok) {
      return;
    }
    // La que cubre todos sus imprescindibles va primero aunque se pidiera la segunda.
    expect(ranked.result.ranked.map((offer) => offer.name)).toEqual(['encaja', 'a-medias']);
    expect(ranked.result.ranked[0]).toMatchObject({ requiredDemonstrated: 2, requiredTotal: 2, gaps: [] });
    expect(ranked.result.ranked[1]?.gaps).toContain('terraform');
    expect(ranked.result.failed).toEqual([]);
  });

  it('una oferta que no se puede leer se anota y las demás siguen', async () => {
    const ranked = await rankOffers(appContext(workspace()), REQUEST, [
      { kind: 'file', path: 'offers/no-existe.txt' },
      { kind: 'file', path: 'offers/encaja.txt' },
    ]);
    expect(ranked.ok && ranked.result.ranked.map((offer) => offer.name)).toEqual(['encaja']);
    expect(ranked.ok && ranked.result.failed[0]?.offer).toBe(0);
  });

  it('sin artefacto no hay comparación posible: el fallo es del entorno y para todas', async () => {
    const fs = workspace();
    await fs.remove('/work/data/dist/profile.json');
    expect(await rankOffers(appContext(fs), REQUEST, [{ kind: 'file', path: 'offers/encaja.txt' }])).toMatchObject({ ok: false });
  });

  it('una oferta sin requisitos reconocibles sale sin adecuación, no con un 100 % engañoso', async () => {
    const fs = workspace();
    await fs.writeFile('/work/offers/vacia.txt', 'Buscamos a alguien con ganas.', 0o600);
    const ranked = await rankOffers(appContext(fs), REQUEST, [{ kind: 'file', path: 'offers/vacia.txt' }]);
    expect(ranked.ok && ranked.result.ranked[0]).toMatchObject({ recognized: 0, ratio: undefined });
  });

  it('con --build se compila UNA vez antes de mirar ninguna oferta, y si no compila no hay comparación', async () => {
    const fs = workspace();
    const construido = await rankOffers(appContext(fs), { ...REQUEST, build: true }, [{ kind: 'file', path: 'offers/encaja.txt' }]);
    expect(construido.ok).toBe(true);
    // Unas fuentes rotas se dicen una vez, no una por oferta.
    await fs.writeFile('/work/data/sources/profile.md', '---\nfullName:\n---\n', 0o600);
    const roto = await rankOffers(appContext(fs), { ...REQUEST, build: true }, [
      { kind: 'file', path: 'offers/encaja.txt' },
      { kind: 'file', path: 'offers/a-medias.txt' },
    ]);
    expect(roto).toMatchObject({ ok: false });
  });

  it('los avisos del análisis llegan a la comparación', async () => {
    const fs = workspace();
    fs.touch('/work/data/sources/profile.md', 5_000_000_000_000);
    const ranked = await rankOffers(appContext(fs), REQUEST, [{ kind: 'file', path: 'offers/encaja.txt' }]);
    expect(ranked.ok && ranked.result.warnings[0]).toMatchObject({ offer: 0, warning: { kind: 'stale-artifact' } });
  });

  it('a igualdad de todo, manda el nombre: el orden no depende de en qué orden se pidieran', async () => {
    const fs = workspace();
    // Dos ofertas idénticas salvo el nombre, y sin ningún imprescindible reconocible.
    await fs.writeFile('/work/offers/zeta.txt', 'Buscamos a alguien con ganas.', 0o600);
    await fs.writeFile('/work/offers/alfa.txt', 'Buscamos a alguien con ganas.', 0o600);
    const ranked = await rankOffers(appContext(fs), REQUEST, [
      { kind: 'file', path: 'offers/zeta.txt' },
      { kind: 'file', path: 'offers/alfa.txt' },
    ]);
    expect(ranked.ok && ranked.result.ranked.map((offer) => offer.name)).toEqual(['alfa', 'zeta']);
  });

  it('el texto pegado también se compara, y se identifica por su nombre', async () => {
    const ranked = await rankOffers(appContext(workspace()), REQUEST, [{ kind: 'text', text: ENCAJA, name: 'pegada' }]);
    expect(ranked.ok && ranked.result.ranked[0]?.name).toBe('pegada');
  });
});
