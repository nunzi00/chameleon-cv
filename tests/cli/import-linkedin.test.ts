/**
 * `cv import-linkedin <archivo.zip>` y su caso de uso: del zip de la exportación al borrador escrito en
 * `import/<nombre>/`, con el mismo destino, permisos e informe que el importador de PDF (writeDraft compartido).
 */
import { describe, expect, it, vi } from 'vitest';

import { runCli } from '../../src/cli';
import { runImportLinkedIn } from '../../src/cli/commands/import-linkedin';
import { importLinkedInDraft } from '../../src/app/import-linkedin';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';
import { zipOf } from '../helpers/zip';

const EXPORT = zipOf([
  ['Profile.csv', 'First Name,Last Name,Headline\r\nAda,Ejemplo,Ingeniera de software\r\n'],
  ['Positions.csv', 'Company Name,Title,Description,Started On,Finished On\r\nNexo Pagos,Staff Backend Engineer,Pasarela de pagos.,Mar 2022,\r\n'],
  ['Skills.csv', 'Name\r\nPHP\r\n'],
]);

function cli(fs: MemoryFileSystem) {
  const stderr = vi.fn();
  const stdout = vi.fn();
  return { context: { ...appContext(fs), stderr, stdout, stdin: undefined, isTty: false } as never, stderr, stdout };
}

describe('cv import-linkedin', () => {
  it('escribe el borrador y lo resume por stderr, con la carpeta en stdout', async () => {
    const fs = new MemoryFileSystem({});
    await fs.writeBinaryFile('/work/export.zip', EXPORT, 0o600);
    const { context, stderr, stdout } = cli(fs);
    expect(await runImportLinkedIn(context, 'export.zip', { replace: false })).toBe(0);
    expect(stdout).toHaveBeenCalledWith('import/ada-ejemplo\n');
    expect(stderr.mock.calls.join('')).toContain('1 experiencias');
    expect(await fs.readTextFile('/work/import/ada-ejemplo/profile.md')).toContain('Ada Ejemplo');
    expect(await fs.readTextFile('/work/import/ada-ejemplo/README.md')).toContain('# Informe del borrador importado');
  });

  it('un fichero que no se puede leer sale con código 2 y lo explica', async () => {
    const { context, stderr } = cli(new MemoryFileSystem({}));
    expect(await runImportLinkedIn(context, 'no-existe.zip', { replace: false })).toBe(2);
    expect(stderr.mock.calls.join('')).toContain('No se pudo leer');
  });

  it('un zip que no es una exportación de LinkedIn es un error de datos (código 1)', async () => {
    const fs = new MemoryFileSystem({});
    await fs.writeBinaryFile('/work/otro.zip', zipOf([['leeme.txt', 'hola']]), 0o600);
    const { context, stderr } = cli(fs);
    expect(await runImportLinkedIn(context, 'otro.zip', { replace: false })).toBe(1);
    expect(stderr.mock.calls.join('')).toContain('no parece una exportación de LinkedIn');
  });

  it('sin --replace no pisa un borrador existente; con él, sí', async () => {
    const fs = new MemoryFileSystem({ '/work/import/mio/README.md': 'anterior' });
    await fs.writeBinaryFile('/work/export.zip', EXPORT, 0o600);
    // Con reloj inyectado la fecha del informe es la del contexto, no la del sistema.
    const context = appContext(fs, { now: () => new Date('2026-08-30T21:00:00.000Z') });
    expect(await importLinkedInDraft(context, EXPORT, 'export.zip', { name: 'mio' })).toMatchObject({ ok: false, error: { code: 'conflict' } });
    expect(await importLinkedInDraft(context, EXPORT, 'export.zip', { name: 'mio', replace: true })).toMatchObject({ ok: true });
    expect(await fs.readTextFile('/work/import/mio/README.md')).toContain('- Importado: 2026-08-30T21:00:00.000Z');
  });

  it('avisa por stderr de lo que el esquema haya degradado', async () => {
    const fs = new MemoryFileSystem({});
    // Un correo que no es un correo: el esquema lo retira y el informe lo cuenta.
    await fs.writeBinaryFile(
      '/work/malo.zip',
      zipOf([
        ['Profile.csv', 'First Name,Last Name\r\nAda,Ejemplo\r\n'],
        ['Email Addresses.csv', 'Email Address,Primary\r\nno-es-un-correo,Yes\r\n'],
      ]),
      0o600,
    );
    const { context, stderr } = cli(fs);
    expect(await runImportLinkedIn(context, 'malo.zip', { replace: false })).toBe(0);
    expect(stderr.mock.calls.join('')).toContain('avisos');
  });

  it('la orden se alcanza desde la CLI real, con su argumento y sus opciones', async () => {
    const fs = new MemoryFileSystem({});
    await fs.writeBinaryFile('/work/export.zip', EXPORT, 0o600);
    const out: string[] = [];
    const context = { ...appContext(fs), stdout: (text: string) => out.push(text), stderr: () => undefined, isTty: false } as never;
    expect(await runCli(['import-linkedin', 'export.zip', '--name', 'mio'], context)).toBe(0);
    expect(out.join('')).toBe('import/mio\n');
  });
});
