import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { LlmConfig } from '../../src/llm/config';
import { attachLines, createNodeRuntimeSystem } from '../../src/llm/runtime-node';

const NODE = process.execPath;
let root = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'cv-runtime-node-'));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('attachLines', () => {
  it('reparte por salto de línea y retorno de carro y entrega el resto al terminar; ignora un flujo ausente', async () => {
    const lines: string[] = [];
    const stream = Readable.from(['a\r\nb\rc', 'd\n  \nfinal']);
    attachLines(stream, (line) => lines.push(line));
    await new Promise((resolve) => stream.on('end', resolve));
    expect(lines).toEqual(['a', 'b', 'cd', 'final']);
    expect(() => attachLines(null, () => undefined)).not.toThrow();
  });
});

describe('createNodeRuntimeSystem', () => {
  it('exec sin shell: salida capturada y por líneas, código de salida, binario ausente y tiempo agotado', async () => {
    const system = createNodeRuntimeSystem({ cwd: root, env: { PATH: process.env['PATH'] ?? '' } });
    const lines: string[] = [];
    const ok = await system.exec(NODE, ['-e', 'console.log("uno\\ndos"); console.error("tres")'], { timeoutMs: 10_000, onLine: (line) => lines.push(line), env: { EXTRA: '1' } });
    expect(ok).toMatchObject({ ok: true, code: 0, stdout: 'uno\ndos\n', stderr: 'tres\n', message: undefined });
    expect(lines.sort()).toEqual(['dos', 'tres', 'uno']);
    const failing = await system.exec(NODE, ['-e', 'process.exit(3)'], { timeoutMs: 10_000 });
    expect(failing).toMatchObject({ ok: false, code: 3 });
    const missing = await system.exec(join(root, 'no-existe'), ['--version'], { timeoutMs: 10_000 });
    expect(missing.ok).toBe(false);
    expect(missing.code).toBeNull();
    expect(missing.message).toContain('ENOENT');
    const controller = new AbortController();
    const slow = await system.exec(NODE, ['-e', 'setTimeout(() => {}, 5000)'], { timeoutMs: 200, signal: controller.signal });
    expect(slow.ok).toBe(false);
  });

  it('spawnDetached arranca un proceso desprendido con registro 0600; processAlive y terminate lo siguen', async () => {
    const system = createNodeRuntimeSystem({ cwd: root });
    const logPath = join(root, 'cache', 'ollama', 'serve.log');
    const spawned = await system.spawnDetached(NODE, ['-e', 'console.log("vivo"); setInterval(() => {}, 1000)'], { env: { PATH: process.env['PATH'] ?? '' }, logPath });
    expect(spawned.ok).toBe(true);
    const pid = spawned.ok ? spawned.pid : 0;
    expect(pid).toBeGreaterThan(0);
    expect(system.processAlive(pid)).toBe(true);
    expect(system.terminate(pid)).toBe(true);
    for (let i = 0; i < 50 && system.processAlive(pid); i += 1) {
      await system.sleep(100);
    }
    expect(system.processAlive(pid)).toBe(false);
    expect(system.terminate(pid)).toBe(false);
    expect((await stat(logPath)).mode & 0o777).toBe(0o600);
    const failed = await system.spawnDetached(join(root, 'no-existe'), [], { env: {}, logPath });
    expect(failed).toMatchObject({ ok: false });
    expect(failed.ok || failed.message).toContain('ENOENT');
  });

  it('files escribe con 0600 creando el directorio, lee (o undefined) y borra sin quejarse', async () => {
    const system = createNodeRuntimeSystem({ cwd: root });
    const path = join(root, 'cache', 'pid', 'ollama.pid');
    await system.files.write(path, '123\n');
    expect((await stat(path)).mode & 0o777).toBe(0o600);
    expect(await system.files.read(path)).toBe('123\n');
    expect(await readFile(path, 'utf8')).toBe('123\n');
    await system.files.remove(path);
    expect(await system.files.read(path)).toBeUndefined();
    await expect(system.files.remove(path)).resolves.toBeUndefined();
  });

  it('la salud por defecto usa el proveedor real (loopback) y las opciones por defecto salen del proceso', async () => {
    const system = createNodeRuntimeSystem({ cwd: root });
    const config: LlmConfig = { provider: 'ollama', baseUrl: 'http://127.0.0.1:9', model: 'm', sources: { provider: 'default', baseUrl: 'default', model: 'default' } };
    const health = await system.health(config);
    expect(health.ok).toBe(false);
    expect(system.platform).toBe(process.platform);
    expect(system.env).toBe(process.env);
    expect(system.home.length).toBeGreaterThan(0);
    const custom = createNodeRuntimeSystem({ cwd: root, platform: 'win32', home: '/h', health: async () => ({ ok: true, version: undefined, models: [], modelAvailable: false }) });
    expect(custom.platform).toBe('win32');
    expect((await custom.health(config)).ok).toBe(true);
  });
});
