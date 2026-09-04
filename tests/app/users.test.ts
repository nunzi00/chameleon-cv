import { describe, expect, it } from 'vitest';

import {
  USERS_DIRNAME,
  contextForWorkspace,
  createUser,
  isUserId,
  listUsers,
  removeUser,
  resolveUser,
  seedUserSources,
  selectWorkspace,
  userRoot,
  usersRoot,
  type AppContext,
} from '../../src/app';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem, type MemoryEntry } from '../helpers/memory-file-system';

const PROFILE = JSON.stringify({
  meta: { schemaVersion: 1 },
  personal: { fullName: 'Ada Lovelace', links: [] },
  specialties: [],
  experience: [],
  projects: [],
  education: [],
  certifications: [],
  skills: [],
  achievements: [],
  languages: [],
});

/** El dataset de ejemplo, servido desde un directorio del disco en memoria en vez del distribuido. */
const TEMPLATE: Record<string, string | MemoryEntry> = {
  '/tpl/profile.md': '---\nfullName: Ada\n---\n',
  '/tpl/specialties/backend.md': '---\ntitle: Backend\n---\n',
  '/tpl/.oculto': 'ignorado',
  '/tpl/enlace.md': { kind: 'symlink', target: '/tpl/profile.md' },
  '/tpl/raro': { kind: 'other' },
};

function withTemplate(fs: MemoryFileSystem): AppContext {
  const context = appContext(fs);
  const assets = context.assets;
  return { ...context, assets: { kind: assets.kind, text: (key) => assets.text(key), bytes: (key) => assets.bytes(key), keys: (prefix) => assets.keys(prefix), directory: () => Promise.resolve('/tpl') } };
}

describe('isUserId', () => {
  it('admite minúsculas, dígitos y guiones interiores; rechaza lo que podría salir de usuarios/', () => {
    expect(['lucas', 'invitado1', 'a', 'a-b-c', '0', 'x'.repeat(40)].every(isUserId)).toBe(true);
    // Ni rutas, ni mayúsculas, ni acentos, ni guiones en los extremos, ni vacío, ni más de 40.
    expect(['..', '.', 'a/b', 'a\\b', 'Lucas', 'ñ', '-a', 'a-', '', 'x'.repeat(41), 'a b'].some(isUserId)).toBe(false);
  });
});

describe('userRoot', () => {
  it('resuelve dentro de usuarios/ y devuelve undefined si el identificador no es válido', () => {
    expect(userRoot('/work', 'lucas')).toBe(`/work/${USERS_DIRNAME}/lucas`);
    expect(usersRoot('/work')).toBe(`/work/${USERS_DIRNAME}`);
    expect(userRoot('/work', '../fuera')).toBeUndefined();
  });
});

describe('listUsers', () => {
  it('sin usuarios/ devuelve una lista vacía: un espacio de trabajo clásico sigue siendo válido', async () => {
    expect(await listUsers(appContext(new MemoryFileSystem({ '/work/data/sources/profile.md': '#' })))).toEqual([]);
  });

  it('ordena, ignora lo que no es un usuario y saca el nombre del artefacto cuando es válido', async () => {
    const context = appContext(
      new MemoryFileSystem({
        '/work/usuarios/lucas/data/dist/profile.json': PROFILE,
        '/work/usuarios/lucas/data/sources/profile.md': '#',
        '/work/usuarios/invitado1': { kind: 'directory' },
        '/work/usuarios/Mayúsculas': { kind: 'directory' },
        '/work/usuarios/leeme.txt': 'no es un usuario',
      }),
    );
    expect(await listUsers(context)).toEqual([
      { id: 'invitado1', root: '/work/usuarios/invitado1', sources: false, name: undefined },
      { id: 'lucas', root: '/work/usuarios/lucas', sources: true, name: 'Ada Lovelace' },
    ]);
  });

  it('un artefacto ilegible o inválido no impide listar al usuario: solo se queda sin nombre', async () => {
    const fs = new MemoryFileSystem({ '/work/usuarios/roto/data/dist/profile.json': '{no es json' });
    expect(await listUsers(appContext(fs))).toEqual([{ id: 'roto', root: '/work/usuarios/roto', sources: false, name: undefined }]);
    fs.failures.add('readFile');
    expect(await listUsers(appContext(fs))).toEqual([{ id: 'roto', root: '/work/usuarios/roto', sources: false, name: undefined }]);
  });
});

describe('resolveUser', () => {
  it('distingue un identificador imposible de uno que no existe', async () => {
    const context = appContext(new MemoryFileSystem({ '/work/usuarios/lucas': { kind: 'directory' }, '/work/usuarios/fichero': 'no es un directorio' }));
    expect(await resolveUser(context, 'lucas')).toEqual({ root: '/work/usuarios/lucas' });
    expect(await resolveUser(context, '../fuera')).toMatchObject({ error: { code: 'unsafe-path' } });
    expect(await resolveUser(context, 'nadie')).toMatchObject({ error: { code: 'not-found' } });
    expect(await resolveUser(context, 'fichero')).toMatchObject({ error: { code: 'not-found' } });
  });
});

describe('createUser', () => {
  it('crea usuarios/<id>/ y no pisa uno que ya exista', async () => {
    const fs = new MemoryFileSystem({});
    const context = appContext(fs);
    expect(await createUser(context, { id: 'invitado1' })).toEqual({ id: 'invitado1', root: '/work/usuarios/invitado1', adopted: [] });
    expect(await createUser(context, { id: 'invitado1' })).toMatchObject({ error: { code: 'conflict', exitCode: 2 } });
    expect(await createUser(context, { id: 'NO' })).toMatchObject({ error: { code: 'unsafe-path' } });
  });

  it('con adopt TRASLADA lo de la raíz —solo lo que es de una persona— sin tocar cv.toml ni themes/', async () => {
    const fs = new MemoryFileSystem({
      '/work/data/sources/profile.md': '# Ada',
      '/work/output/cv.md': 'cv',
      '/work/import/borrador/README.md': 'r',
      '/work/cv.toml': '[theme]\nname = "default"\n',
      '/work/themes/mio/theme.toml': 't',
    });
    const context = appContext(fs);
    expect(await createUser(context, { id: 'lucas', adopt: true })).toEqual({ id: 'lucas', root: '/work/usuarios/lucas', adopted: ['data', 'output', 'import'] });
    expect(fs.file('/work/usuarios/lucas/data/sources/profile.md')?.content).toBe('# Ada');
    expect(fs.file('/work/usuarios/lucas/output/cv.md')?.content).toBe('cv');
    expect(fs.file('/work/data/sources/profile.md')).toBeUndefined();
    // Lo compartido se queda donde estaba: es del espacio de trabajo, no de una persona.
    expect(fs.file('/work/cv.toml')?.content).toBe('[theme]\nname = "default"\n');
    expect(fs.file('/work/themes/mio/theme.toml')?.content).toBe('t');
  });
});

describe('seedUserSources', () => {
  it('copia el dataset de ejemplo distribuido, sin ocultos, y no escribe .gitignore', async () => {
    const fs = new MemoryFileSystem(TEMPLATE);
    await seedUserSources(withTemplate(fs), '/work/usuarios/invitado1');
    expect(fs.file('/work/usuarios/invitado1/data/sources/profile.md')?.mode).toBe(0o600);
    expect(fs.file('/work/usuarios/invitado1/data/sources/specialties/backend.md')?.content).toBe('---\ntitle: Backend\n---\n');
    expect(fs.file('/work/usuarios/invitado1/data/sources/.oculto')).toBeUndefined();
    // Ni enlaces ni entradas raras: se copia lo que es un fichero o un directorio, como en `cv init`.
    expect(fs.file('/work/usuarios/invitado1/data/sources/enlace.md')).toBeUndefined();
    expect(fs.file('/work/usuarios/invitado1/data/sources/raro')).toBeUndefined();
    expect(fs.file('/work/usuarios/invitado1/.gitignore')).toBeUndefined();
  });
});

describe('removeUser', () => {
  it('no borra: renombra el espacio entero a una copia con marca de tiempo', async () => {
    const fs = new MemoryFileSystem({ '/work/usuarios/invitado1/data/sources/profile.md': '# Ada' });
    const context = appContext(fs, { now: () => new Date('2026-09-04T10:11:12Z') });
    const backup = async (_c: unknown, root: string): Promise<string> => `${root}.bak`;
    expect(await removeUser(context, 'invitado1', backup)).toEqual({ id: 'invitado1', backup: '/work/usuarios/invitado1.bak' });
    expect(fs.file('/work/usuarios/invitado1.bak/data/sources/profile.md')?.content).toBe('# Ada');
    expect(await removeUser(context, 'invitado1', backup)).toMatchObject({ error: { code: 'not-found' } });
  });
});

describe('selectWorkspace', () => {
  it('con usuario elegido, su raíz; sin él, la del espacio de trabajo, DICIÉNDOLO si hay usuarios', async () => {
    const context = appContext(new MemoryFileSystem({ '/work/data/sources/profile.md': '#', '/work/usuarios/lucas': { kind: 'directory' } }));
    expect(await selectWorkspace(context, 'lucas')).toEqual({ root: '/work/usuarios/lucas', user: 'lucas' });
    const notice = 'Trabajando sobre la raíz; este espacio tiene 1 usuario (lucas): elige con --user';
    expect(await selectWorkspace(context, undefined)).toEqual({ root: '/work', user: undefined, notice });
    expect(await selectWorkspace(context, '')).toEqual({ root: '/work', user: undefined, notice });
    expect(await selectWorkspace(context, 'nadie')).toMatchObject({ error: { code: 'not-found' } });
  });

  it('sin usuarios no hay aviso: un espacio de una sola persona no tiene nada que elegir', async () => {
    const context = appContext(new MemoryFileSystem({ '/work/data/sources/profile.md': '#' }));
    expect(await selectWorkspace(context, undefined)).toEqual({ root: '/work', user: undefined, notice: undefined });
  });

  it('el aviso enumera a todos cuando son varios', async () => {
    const fs = new MemoryFileSystem({ '/work/data/sources/profile.md': '#', '/work/usuarios/lucas': { kind: 'directory' }, '/work/usuarios/invitado1': { kind: 'directory' } });
    expect(await selectWorkspace(appContext(fs), undefined)).toMatchObject({ notice: 'Trabajando sobre la raíz; este espacio tiene 2 usuarios (invitado1, lucas): elige con --user' });
  });

  it('un espacio vacío sin usuarios sigue siendo la raíz: no se inventa un modo nuevo', async () => {
    expect(await selectWorkspace(appContext(new MemoryFileSystem({})), undefined)).toEqual({ root: '/work', user: undefined });
  });

  it('si la raíz ya no tiene fuentes y hay usuarios, se para y dice con quién se puede trabajar', async () => {
    const context = appContext(new MemoryFileSystem({ '/work/usuarios/lucas': { kind: 'directory' }, '/work/usuarios/invitado1': { kind: 'directory' } }));
    const selection = await selectWorkspace(context, undefined);
    expect(selection).toMatchObject({ error: { code: 'usage', exitCode: 2 } });
    expect('error' in selection ? selection.error.lines : []).toEqual([
      'Este espacio de trabajo tiene usuarios y no has elegido ninguno.',
      '  cv --user invitado1 <orden>   (o export CHAMELEON_USER=invitado1)',
      'Usuarios: invitado1, lucas',
    ]);
  });
});

describe('contextForWorkspace', () => {
  it('cambia la raíz y deja la compartida; sin withWorkspace, cambiar de usuario es cambiar cwd y nada más', () => {
    const context = appContext(new MemoryFileSystem({}));
    expect(contextForWorkspace(context, '/work/usuarios/lucas', '/work')).toMatchObject({ cwd: '/work/usuarios/lucas', workspaceRoot: '/work' });
  });

  it('rehace lo que había capturado la raíz cuando el contexto sabe hacerlo', () => {
    const marker = (): Promise<never> => Promise.reject(new Error('nunca'));
    const base = appContext(new MemoryFileSystem({}), { withWorkspace: (cwd) => ({ llmProvider: cwd === '/work/usuarios/lucas' ? marker : undefined }) as Partial<AppContext> });
    expect(contextForWorkspace(base, '/work/usuarios/lucas', '/work').llmProvider).toBe(marker);
  });
});
