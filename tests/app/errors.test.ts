import { describe, expect, it } from 'vitest';

import { conflictError, dataError, errorLines, errorWithExit, notFoundError, unsafePathError } from '../../src/app';

describe('errores tipificados de la capa de casos de uso', () => {
  it('traduce un código de salida conocido a un error de datos (1) o del entorno (2)', () => {
    expect(errorWithExit('m', 1)).toEqual({ code: 'invalid-data', message: 'm', lines: undefined, exitCode: 1 });
    expect(errorWithExit('m', 2)).toEqual({ code: 'environment', message: 'm', exitCode: 2 });
  });

  it('un conflicto es de datos salvo que se diga lo contrario; no encontrado y ruta insegura son del entorno', () => {
    expect(conflictError('c')).toEqual({ code: 'conflict', message: 'c', exitCode: 1 });
    expect(conflictError('c', 2).exitCode).toBe(2);
    expect(notFoundError('n')).toEqual({ code: 'not-found', message: 'n', exitCode: 2 });
    expect(unsafePathError('u')).toEqual({ code: 'unsafe-path', message: 'u', exitCode: 2 });
  });

  it('la CLI imprime las líneas si existen y, si no, el mensaje', () => {
    expect(errorLines(dataError('solo mensaje'))).toEqual(['solo mensaje']);
    expect(errorLines(dataError('resumen', ['a: 1', 'b: 2', 'resumen']))).toEqual(['a: 1', 'b: 2', 'resumen']);
  });
});
