import { describe, expect, it } from 'vitest';

import { TYPST_VERSION, type ProcessOutcome, type ProcessRunner } from '../../src/renderers/typst';
import { formatTypstStatus, typstStatus } from '../../src/typst';

function runnerFor(versions: Record<string, string | 'broken'>): ProcessRunner {
  return (request) => {
    const version = versions[request.file];
    const outcome: ProcessOutcome =
      version === undefined || version === 'broken'
        ? { kind: 'exited', status: 2, stdout: Buffer.alloc(0), stderr: 'x' }
        : { kind: 'exited', status: 0, stdout: Buffer.from(`typst ${version} (t)\n`), stderr: '' };
    return Promise.resolve(outcome);
  };
}

const CACHE = `/home/ada/.cache/chameleon-cv/typst/${TYPST_VERSION}/typst`;

describe('typstStatus', () => {
  it('evalúa cada candidato en orden y elige el primero ejecutable, como locateTypst', async () => {
    const executables = new Set(['/env/typst', '/usr/bin/typst']);
    const status = await typstStatus({
      env: { CHAMELEON_TYPST: '/env/typst', PATH: '/usr/local/bin:/usr/bin' },
      platform: 'linux',
      home: '/home/ada',
      isExecutable: (path) => Promise.resolve(executables.has(path)),
      runner: runnerFor({ '/env/typst': '0.14.0', '/usr/bin/typst': TYPST_VERSION }),
    });
    expect(status.required).toBe(TYPST_VERSION);
    expect(status.candidates).toEqual([
      { source: 'option', path: undefined, state: 'unset' },
      { source: 'env', path: '/env/typst', state: 'mismatch', version: '0.14.0' },
      { source: 'cache', path: CACHE, state: 'missing' },
      { source: 'path', path: '/usr/bin/typst', state: 'ok', version: TYPST_VERSION },
    ]);
    expect(status.selected).toEqual({ source: 'env', path: '/env/typst', state: 'mismatch', version: '0.14.0' });
    expect(status.usable).toBe(false);
    expect(formatTypstStatus(status)).toBe(
      [
        `Typst requerido: ${TYPST_VERSION}`,
        `Se usaría: /env/typst (CHAMELEON_TYPST) · typst 0.14.0, distinto del requerido: ejecuta «cv typst install» o usa --typst-any-version`,
        'Candidatos, por prioridad:',
        '  --typst-path: no indicado',
        '  CHAMELEON_TYPST: /env/typst (typst 0.14.0; se requiere 0.15.1)',
        `  caché de usuario: ${CACHE} (no existe o no es ejecutable)`,
        `  PATH: /usr/bin/typst (typst ${TYPST_VERSION})`,
        '',
      ].join('\n'),
    );
  });

  it('describe el caso correcto, el binario roto y la ausencia total', async () => {
    const ok = await typstStatus({ explicitPath: '/opt/typst', env: { CHAMELEON_TYPST: '' }, platform: 'linux', home: '/h', isExecutable: (path) => Promise.resolve(path === '/opt/typst'), runner: runnerFor({ '/opt/typst': TYPST_VERSION }) });
    expect(ok.usable).toBe(true);
    expect(formatTypstStatus(ok).split('\n').slice(0, 2)).toEqual([`Typst requerido: ${TYPST_VERSION}`, `Se usaría: /opt/typst (--typst-path) · typst ${TYPST_VERSION}`]);
    expect(formatTypstStatus(ok)).toContain('  CHAMELEON_TYPST: no definida\n');
    expect(formatTypstStatus(ok)).toContain('  PATH: no encontrado\n');

    const broken = await typstStatus({ env: {}, platform: 'linux', home: '/h', isExecutable: (path) => Promise.resolve(path === `/h/.cache/chameleon-cv/typst/${TYPST_VERSION}/typst`), runner: runnerFor({}) });
    expect(broken.selected).toMatchObject({ source: 'cache', state: 'broken' });
    expect(broken.usable).toBe(false);
    expect(formatTypstStatus(broken)).toContain(`Se usaría: /h/.cache/chameleon-cv/typst/${TYPST_VERSION}/typst (caché de usuario), pero no responde a --version: «/h/.cache/chameleon-cv/typst/${TYPST_VERSION}/typst --version» no respondió correctamente\n`);
    expect(formatTypstStatus(broken)).toContain('(no responde a --version:');

    const none = await typstStatus({ env: { PATH: 'C:\\bin' }, platform: 'win32', home: 'C:\\Users\\ada', isExecutable: () => Promise.resolve(false), runner: runnerFor({}) });
    expect(none.selected).toBeUndefined();
    expect(formatTypstStatus(none)).toContain('Ningún binario ejecutable: ejecuta «cv typst install», o indica --typst-path o CHAMELEON_TYPST\n');
  });

  it('con los valores por defecto (entorno real) devuelve una evaluación coherente', async () => {
    const status = await typstStatus({ isExecutable: () => Promise.resolve(false) });
    expect(status.candidates.map((candidate) => candidate.source)).toEqual(['option', 'env', 'cache', 'path']);
    expect(status.usable).toBe(false);
    // Comprobación real de ejecutables sobre rutas que no existen.
    const nothing = await typstStatus({ env: { PATH: '/nonexistent-dir', CHAMELEON_TYPST: '/nonexistent/typst' }, platform: 'linux', home: '/nonexistent-home', runner: runnerFor({}) });
    expect(nothing.candidates.map((candidate) => candidate.state)).toEqual(['unset', 'missing', 'missing', 'missing']);
  });
});
