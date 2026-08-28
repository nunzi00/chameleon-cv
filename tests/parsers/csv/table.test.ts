import { describe, expect, it } from 'vitest';

import { buildRow, describeCsvError, detectDelimiter, parseTable, validateHeader, type TableSpec } from '../../../src/parsers/csv/table';

const SPEC: TableSpec = {
  columns: ['name', 'years', 'tags', 'id'],
  required: ['name'],
  multiValue: ['tags'],
  integer: ['years'],
};

function expectRows(content: string) {
  const result = parseTable(content, 't.csv', SPEC);
  if (!result.ok) {
    throw new Error(JSON.stringify(result.errors));
  }
  return result.rows;
}

function expectErrors(content: string): string[] {
  const result = parseTable(content, 't.csv', SPEC);
  if (result.ok) {
    throw new Error('Se esperaban errores');
  }
  return result.errors.map((error) => `${error.line}: ${error.message}`);
}

describe('detectDelimiter', () => {
  it('usa «;» solo cuando la cabecera lo contiene y no tiene comas', () => {
    expect(detectDelimiter('name,years\nPHP;10\n')).toBe(',');
    expect(detectDelimiter('name;years\nPHP;10\n')).toBe(';');
    expect(detectDelimiter('name;years,tags\n')).toBe(',');
    expect(detectDelimiter('name;years')).toBe(';');
  });
});

describe('parseTable', () => {
  it('convierte filas en objetos con su línea, dividiendo valores múltiples y coercionando enteros', () => {
    expect(expectRows('name,years,tags\nPHP,10, php | backend |\n\nSymfony,,symfony\n')).toEqual([
      { values: { name: 'PHP', years: 10, tags: ['php', 'backend'] }, line: 2 },
      { values: { name: 'Symfony', tags: ['symfony'] }, line: 4 },
    ]);
  });

  it('respeta comillas RFC 4180, incluidos delimitadores y saltos de línea, y sitúa la fila en su línea inicial', () => {
    expect(expectRows('name,tags\n"Uno, dos\ntres",a\nOtro,b\n')).toEqual([
      { values: { name: 'Uno, dos\ntres', tags: ['a'] }, line: 2 },
      { values: { name: 'Otro', tags: ['b'] }, line: 4 },
    ]);
  });

  it('acepta el delimitador «;», el BOM y una cabecera sin filas', () => {
    expect(expectRows('﻿name;years\nPHP;10\n')).toEqual([{ values: { name: 'PHP', years: 10 }, line: 2 }]);
    expect(expectRows('name,years\n')).toEqual([]);
  });

  it('deja como texto un entero que no lo es (lo rechazará el esquema)', () => {
    expect(expectRows('name,years\nPHP,diez\n')).toEqual([{ values: { name: 'PHP', years: 'diez' }, line: 2 }]);
  });

  it('exige cabecera, columnas conocidas, sin repetir y con las obligatorias', () => {
    expect(expectErrors('')).toEqual(['1: Falta la cabecera (columnas admitidas: name, years, tags, id)']);
    expect(expectErrors('foo,name,name\nx,y,z\n')).toEqual([
      '1: Columna «foo» no reconocida (admitidas: name, years, tags, id)',
      '1: Columna «name» repetida',
    ]);
    expect(expectErrors('years\n1\n')).toEqual(['1: Falta la columna obligatoria «name»']);
  });

  it('señala cada fila con un número de campos distinto al de la cabecera', () => {
    expect(expectErrors('name,years\nPHP\nSymfony,8,extra\nOk,1\n')).toEqual([
      '2: La fila tiene 1 campos y la cabecera 2',
      '3: La fila tiene 3 campos y la cabecera 2',
    ]);
  });

  it('traduce los errores estructurales de csv-parse con su línea', () => {
    expect(expectErrors('name\n"abierta\n')).toEqual(['2: CSV inválido: Quote Not Closed: the parsing is finished with an opening quote at line 2']);
  });
});

describe('utilidades', () => {
  it('buildRow omite las celdas vacías o ausentes', () => {
    expect(buildRow(['name', 'years', 'tags'], ['PHP', ''], SPEC)).toEqual({ name: 'PHP' });
  });

  it('validateHeader acepta una cabecera correcta', () => {
    expect(validateHeader(['name', 'id'], SPEC, 't.csv')).toEqual([]);
  });

  it('describeCsvError extrae la línea solo cuando existe y es numérica', () => {
    expect(describeCsvError(Object.assign(new Error('fallo\ndetalle'), { lines: 3 }))).toEqual({ line: 3, message: 'fallo' });
    expect(describeCsvError(Object.assign(new Error('fallo'), { lines: 'x' }))).toEqual({ line: undefined, message: 'fallo' });
    expect(describeCsvError({ message: 'objeto' })).toEqual({ line: undefined, message: '[object Object]' });
    expect(describeCsvError('texto')).toEqual({ line: undefined, message: 'texto' });
  });
});
