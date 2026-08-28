import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { ProcessRequest } from '../../src/renderers/typst';
import { EXTRACT_LIMITS, extractArchive, extractionEnvironment, findInPath } from '../../src/typst';

let directory = '';
let archive = '';

/** Un `.tar` sin comprimir (solo requiere `tar`, presente en Linux, macOS y Windows 10+). */
beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'chameleon-extract-'));
  const source = join(directory, 'src', 'typst-x86_64-unknown-linux-musl');
  await mkdir(source, { recursive: true });
  await writeFile(join(source, 'typst'), '#!/bin/sh\necho "typst 0.15.1 (test)"\n', { mode: 0o755 });
  await writeFile(join(source, 'LICENSE'), 'Apache-2.0\n');
  archive = join(directory, 'typst.tar');
  execFileSync('tar', ['-cf', archive, '-C', join(directory, 'src'), 'typst-x86_64-unknown-linux-musl']);
});
afterAll(async () => {
  await rm(directory, { recursive: true, force: true });
});

describe('extractArchive', () => {
  it('extrae con el tar del sistema en el directorio indicado, con entorno mínimo', async () => {
    const target = join(directory, 'out');
    await mkdir(target);
    const result = await extractArchive(archive, target);
    expect(result).toMatchObject({ ok: true });
    expect(result.ok && result.tar.endsWith('tar')).toBe(true);
    expect(await readFile(join(target, 'typst-x86_64-unknown-linux-musl', 'LICENSE'), 'utf8')).toBe('Apache-2.0\n');
    expect((await stat(join(target, 'typst-x86_64-unknown-linux-musl', 'typst'))).isFile()).toBe(true);
    expect(extractionEnvironment({ PATH: '/usr/bin', HOME: '/home/ada' }, 'linux')).toEqual({ PATH: '/usr/bin' });
    expect(extractionEnvironment({ SystemRoot: 'C:\\Windows' }, 'win32')).toEqual({ PATH: '', SystemRoot: 'C:\\Windows' });
    expect(EXTRACT_LIMITS.timeoutMs).toBe(60_000);
  });

  it('explica un archivo corrupto, la ausencia de tar, el tiempo agotado y un fallo de arranque', async () => {
    const target = join(directory, 'out2');
    await mkdir(target);
    const corrupt = join(directory, 'corrupt.tar');
    await writeFile(corrupt, 'esto no es un tar');
    const result = await extractArchive(corrupt, target);
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toMatch(/^«tar» terminó con código \d+/);

    expect(await extractArchive(archive, target, { env: { PATH: '' } })).toEqual({ ok: false, message: 'No se encontró «tar» en el PATH: instálalo (en Linux necesita también «xz») y repite «cv typst install»' });

    const calls: ProcessRequest[] = [];
    const timeout = await extractArchive(archive, target, {
      tar: '/bin/tar',
      env: { PATH: '/bin' },
      platform: 'linux',
      runner: (request) => {
        calls.push(request);
        return Promise.resolve({ kind: 'timeout' });
      },
    });
    expect(timeout).toEqual({ ok: false, message: '«tar» superó los 60000 ms permitidos' });
    expect(calls[0]).toMatchObject({ file: '/bin/tar', args: ['-xf', archive, '-C', target], env: { PATH: '/bin' }, cwd: target });

    expect(await extractArchive(archive, target, { tar: '/bin/tar', runner: () => Promise.resolve({ kind: 'failed', message: 'spawn EACCES' }) })).toEqual({ ok: false, message: 'No se pudo ejecutar «tar»: spawn EACCES' });
  });

  it('findInPath recorre el PATH con el separador y los nombres de cada plataforma', async () => {
    expect(await findInPath('tar', { PATH: '/nope:/usr/bin' }, 'linux')).toBe('/usr/bin/tar');
    expect(await findInPath('tar', { PATH: '' }, 'linux')).toBeUndefined();
    expect(await findInPath('tar', {}, 'linux')).toBeUndefined();
    const seen: string[] = [];
    expect(
      await findInPath('tar', { PATH: 'C:\\Windows\\System32;D:\\bin' }, 'win32', (path) => {
        seen.push(path);
        return Promise.resolve(path.endsWith(join('D:\\bin', 'tar.exe')));
      }),
    ).toBe(join('D:\\bin', 'tar.exe'));
    expect(seen).toEqual([join('C:\\Windows\\System32', 'tar.exe'), join('C:\\Windows\\System32', 'tar'), join('D:\\bin', 'tar.exe')]);
  });
});
