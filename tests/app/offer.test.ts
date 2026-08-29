import { describe, expect, it } from 'vitest';

import { offerNameOf, pdfExitCode, readOffer } from '../../src/app';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

describe('readOffer con entradas que no son ficheros (los clientes que ya tienen el texto)', () => {
  const context = appContext(new MemoryFileSystem());

  it('normaliza el texto y usa el nombre dado o «oferta»', async () => {
    expect(await readOffer(context, { kind: 'text', text: '﻿Hola\r\nmundo', name: 'nube' })).toEqual({ ok: true, offer: { text: 'Hola\nmundo', name: 'nube' } });
    expect(await readOffer(context, { kind: 'text', text: 'Hola' })).toEqual({ ok: true, offer: { text: 'Hola', name: 'oferta' } });
    expect(await readOffer(context, { kind: 'stdin', read: () => Promise.resolve('Por stdin') })).toEqual({ ok: true, offer: { text: 'Por stdin', name: 'oferta' } });
  });

  it('una oferta vacía es un error de datos', async () => {
    expect(await readOffer(context, { kind: 'text', text: '  \n' })).toEqual({ ok: false, error: { code: 'invalid-data', message: 'La oferta está vacía', lines: undefined, exitCode: 1 } });
  });

  it('el nombre corto sale del fichero, sin extensión y sin acentos, o es «oferta» si no queda nada', () => {
    expect(offerNameOf('/ofertas/Acme Backend Sénior.PDF')).toBe('acme-backend-senior');
    expect(offerNameOf('/ofertas/….txt')).toBe('oferta');
  });

  it('un PDF inválido o excesivo es de datos; un fallo o un tiempo agotado, del entorno', () => {
    expect(pdfExitCode('invalid')).toBe(1);
    expect(pdfExitCode('too-many-pages')).toBe(1);
    expect(pdfExitCode('timeout')).toBe(2);
    expect(pdfExitCode('failed')).toBe(2);
  });
});
