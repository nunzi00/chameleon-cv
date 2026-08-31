import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { describeKeys, removeApiKey, resolveApiKey, writeApiKey } from '../../src/llm/keys';

let root: string;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'cv-keys-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('writeApiKey / removeApiKey', () => {
  it('crea el directorio 0700 y el fichero 0600, sustituye y elimina claves; nunca las devuelve', async () => {
    const keysFile = join(root, 'config', 'chameleon-cv', 'keys.json');
    const options = { keysFile, platform: 'linux' as const, env: {} };
    expect(await writeApiKey('openai', ' sk-primera \n', options)).toEqual({ ok: true, file: keysFile });
    expect((await stat(join(root, 'config', 'chameleon-cv'))).mode & 0o777).toBe(0o700);
    expect((await stat(keysFile)).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(keysFile, 'utf8'))).toEqual({ openai: 'sk-primera' });
    expect(await writeApiKey('anthropic', 'sk-ant', options)).toEqual({ ok: true, file: keysFile });
    expect(await writeApiKey('openai', 'sk-segunda', options)).toEqual({ ok: true, file: keysFile });
    expect(JSON.parse(await readFile(keysFile, 'utf8'))).toEqual({ openai: 'sk-segunda', anthropic: 'sk-ant' });
    expect(await resolveApiKey('openai', options)).toEqual({ ok: true, key: 'sk-segunda', source: 'file' });
    expect(await describeKeys(options)).toEqual({ openai: 'file', anthropic: 'file', groq: 'none', gemini: 'none' });
    expect(await removeApiKey('openai', options)).toEqual({ ok: true, file: keysFile, removed: true });
    expect(await removeApiKey('openai', options)).toEqual({ ok: true, file: keysFile, removed: false });
    expect(JSON.parse(await readFile(keysFile, 'utf8'))).toEqual({ anthropic: 'sk-ant' });
    expect(await removeApiKey('anthropic', { keysFile: join(root, 'no-existe', 'keys.json'), platform: 'linux', env: {} })).toEqual({ ok: true, file: join(root, 'no-existe', 'keys.json'), removed: false });
  });

  it('rechaza claves vacías o con saltos de línea, ficheros inseguros o inválidos, y explica si no puede escribir', async () => {
    const keysFile = join(root, 'otro', 'keys.json');
    const options = { keysFile, platform: 'linux' as const, env: {} };
    expect(await writeApiKey('openai', '   ', options)).toEqual({ ok: false, message: 'La clave está vacía' });
    expect(await writeApiKey('openai', 'a\nb', options)).toEqual({ ok: false, message: 'La clave no puede contener saltos de línea' });
    await writeApiKey('openai', 'sk', options);
    await chmod(keysFile, 0o644);
    const insecure = await writeApiKey('openai', 'sk2', options);
    expect(!insecure.ok && insecure.message).toMatch(/legible por otros usuarios \(permisos 644\); corrígelo con chmod 600 antes de modificarlo$/);
    const removeInsecure = await removeApiKey('openai', options);
    expect(removeInsecure.ok).toBe(false);
    await chmod(keysFile, 0o600);
    await writeFile(keysFile, '{"openai": 1}', { mode: 0o600 });
    const invalid = await writeApiKey('openai', 'sk2', options);
    expect(!invalid.ok && invalid.message).toMatch(/^El fichero de claves .* no es válido: /);
    const unwritable = await writeApiKey('openai', 'sk', { keysFile: join(keysFile, 'imposible', 'keys.json'), platform: 'linux', env: {} });
    expect(!unwritable.ok && unwritable.message).toMatch(/^No se pudo escribir el fichero de claves /);
    await writeFile(keysFile, '{"openai": "sk"}', { mode: 0o600 });
    await chmod(join(root, 'otro'), 0o500);
    const removeUnwritable = await removeApiKey('openai', options);
    expect(!removeUnwritable.ok && removeUnwritable.message).toMatch(/^No se pudo escribir el fichero de claves /);
    await chmod(join(root, 'otro'), 0o700);
    // En Windows no se comprueban permisos: un fichero 0644 se acepta.
    await writeFile(keysFile, '{"openai": "sk"}', { mode: 0o644 });
    expect(await writeApiKey('anthropic', 'sk-ant', { keysFile, platform: 'win32', env: {} })).toEqual({ ok: true, file: keysFile });
  });
});
