/**
 * Lector de archivos de temas (T-8.3, docs/theme-gallery.md §4.2 paso 3, §5 y §7): zip y tar.gz construidos en
 * la propia prueba, con la política de entradas cerrada y sus límites, y los archivos corruptos o truncados.
 */
import { describe, expect, it } from 'vitest';

import { ARCHIVE_LIMITS, ArchiveError, applyEntryPolicy, detectArchiveKind, readTarGzEntries, readThemeArchive, readZipEntries, type RawEntry } from '../../src/themes';
import { buildTar, buildTarGz, buildZip, gzipStored } from '../helpers/archives';

const TOML = '[theme]\nname = "comunidad"\n';
const TYP = '#let cv(d, theme) = d.fullName\n';
const ALLOWED = 'solo theme.toml, template.typ, README.md, LICENSE y fonts/<nombre>.ttf|otf (nombres en minúsculas, dígitos y guiones)';

function text(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('utf8');
}

function raw(path: string, size = 1, type: RawEntry['type'] = 'file'): RawEntry {
  return type === 'file' ? { path, type, size, read: () => new Uint8Array(size) } : { path, type };
}

describe('detectArchiveKind y readThemeArchive', () => {
  it('reconoce zip (también vacío) y gzip por la firma; lo demás no es un archivo', () => {
    expect(detectArchiveKind(buildZip([{ path: 'a', data: 'x' }]))).toBe('zip');
    expect(detectArchiveKind(buildZip([]))).toBe('zip');
    expect(detectArchiveKind(gzipStored(Buffer.from('x')))).toBe('tar.gz');
    expect(detectArchiveKind(Buffer.from('%PDF-1.7'))).toBeUndefined();
    expect(detectArchiveKind(new Uint8Array(0))).toBeUndefined();
    expect(readThemeArchive(Buffer.from('hola'))).toEqual({ ok: false, message: 'El fichero no es un archivo zip ni tar.gz (firma desconocida)' });
    expect(readThemeArchive(buildZip([]))).toEqual({ ok: false, message: 'El archivo está vacío' });
    // Un fallo que no sea de la política ni del formato (aquí, un objeto que no es un Uint8Array) también se explica sin lanzar.
    expect(readThemeArchive({ length: 4, 0: 0x50, 1: 0x4b, 2: 0x03, 3: 0x04 } as unknown as Uint8Array)).toMatchObject({ ok: false, message: expect.stringMatching(/^No se pudo leer el archivo: /) });
  });

  it('un zip con directorio raíz, almacenado, con fuentes, README y LICENSE, da los ficheros del tema ordenados', () => {
    const zip = buildZip(
      [
        { path: 'comunidad/' },
        { path: 'comunidad/template.typ', data: TYP },
        { path: 'comunidad/theme.toml', data: TOML },
        { path: 'comunidad/README.md', data: '# Tema' },
        { path: 'comunidad/LICENSE', data: 'MIT' },
        { path: 'comunidad/fonts/' },
        { path: 'comunidad/fonts/libre-serif.ttf', data: new Uint8Array([0, 1, 2]) },
      ],
      { time: 0x4800, date: 0x5d0f, comment: 'banco' },
    );
    const result = readThemeArchive(zip);
    if (!result.ok) {
      throw new Error(result.message);
    }
    expect(result.archive.root).toBe('comunidad');
    expect(result.archive.files.map((file) => file.path)).toEqual(['LICENSE', 'README.md', 'fonts/libre-serif.ttf', 'template.typ', 'theme.toml']);
    expect(text(result.archive.files[4]!.bytes)).toBe(TOML);
    expect([...result.archive.files[2]!.bytes]).toEqual([0, 1, 2]);
  });

  it('un zip sin raíz, con deflate, nombres UTF-8 y descriptor de datos, y un tar.gz con prefijo ustar, también valen', () => {
    const flat = buildZip([
      { path: 'theme.toml', data: TOML, method: 8, flags: 0x800 | 0x8 },
      { path: 'template.typ', data: TYP.repeat(50), method: 8 },
    ]);
    const zip = readThemeArchive(flat);
    expect(zip.ok && zip.archive.root).toBeUndefined();
    expect(zip.ok && text(zip.archive.files[0]!.bytes)).toBe(TYP.repeat(50));
    const targz = buildTarGz(
      [
        { path: 'comunidad/', type: '5' },
        { path: 'theme.toml', prefix: 'comunidad', data: TOML },
        { path: 'comunidad/template.typ', data: TYP },
        { path: 'comunidad/fonts/', type: '5' },
        { path: 'comunidad/fonts/mono-1.otf', data: 'otf' },
      ],
      { deterministic: false },
    );
    const tar = readThemeArchive(targz);
    expect(tar.ok && tar.archive.root).toBe('comunidad');
    expect(tar.ok && tar.archive.files.map((file) => file.path)).toEqual(['fonts/mono-1.otf', 'template.typ', 'theme.toml']);
    const stored = readThemeArchive(buildTarGz([{ path: 'theme.toml', data: TOML }], { mtime: 1_700_000_000 }));
    expect(stored.ok && stored.archive.files).toEqual([{ path: 'theme.toml', bytes: Buffer.from(TOML) }]);
  });
});

describe('política de entradas', () => {
  const reject = (entries: RawEntry[], message: string | RegExp): void => {
    expect(() => applyEntryPolicy(entries)).toThrow(message);
  };

  it('rechaza rutas que salen del tema, absolutas, con barras invertidas, letras de unidad o segmentos vacíos', () => {
    reject([raw('../fuera')], 'La entrada «../fuera» sale del tema («..»): no se admite');
    reject([raw('comunidad/../../x')], 'sale del tema');
    reject([raw('/etc/passwd')], 'La entrada «/etc/passwd» es una ruta absoluta: no se admite');
    reject([raw('a\\b')], 'es una ruta absoluta');
    reject([raw('C:theme.toml')], 'es una ruta absoluta');
    reject([raw('a//b')], 'La entrada «a//b» tiene una ruta no admitida');
    reject([raw('./theme.toml')], 'tiene una ruta no admitida');
  });

  it('rechaza enlaces, tipos raros, directorios que no sean fonts/, ficheros fuera de la lista, fuentes mal nombradas y repetidos', () => {
    reject([raw('theme.toml'), raw('template.typ', 1, 'symlink')], 'La entrada «template.typ» es un enlace: no se admiten enlaces simbólicos ni duros');
    reject([raw('theme.toml'), raw('dispositivo', 0, 'other')], 'La entrada «dispositivo» no es un fichero ni un directorio: no se admite');
    reject([raw('theme.toml'), raw('extra', 0, 'directory')], `El directorio «extra» no se admite: ${ALLOWED}`);
    reject([raw('theme.toml'), raw('notas.txt')], `La entrada «notas.txt» no se admite: ${ALLOWED}`);
    reject([raw('theme.toml'), raw('fonts/Mala.ttf')], 'La entrada «fonts/Mala.ttf» no se admite');
    reject([raw('theme.toml'), raw('fonts/mala.woff')], 'no se admite');
    reject([raw('theme.toml'), raw('fonts/x/mala.ttf')], 'no se admite');
    reject([raw('theme.toml'), raw('theme.toml')], 'La entrada «theme.toml» está repetida');
    reject([raw('Mal Nombre/theme.toml')], 'El directorio raíz «Mal Nombre» no es un nombre de tema válido: minúsculas, dígitos y guiones');
    reject([raw('otro/theme.toml'), raw('theme.toml')], 'La entrada «otro/theme.toml» no se admite');
  });

  it('aplica los límites de entradas, de tamaño por fichero (fuentes aparte) y de total sin leer nada', () => {
    reject(Array.from({ length: 41 }, (_, index) => raw(`fonts/f-${index}.ttf`)), 'El archivo tiene 41 entradas; el máximo es 40');
    reject([raw('theme.toml', ARCHIVE_LIMITS.maxFileBytes + 1)], `La entrada «theme.toml» pesa ${ARCHIVE_LIMITS.maxFileBytes + 1} bytes; el máximo es ${ARCHIVE_LIMITS.maxFileBytes}`);
    reject([raw('fonts/grande.ttf', ARCHIVE_LIMITS.maxFontBytes + 1)], `el máximo es ${ARCHIVE_LIMITS.maxFontBytes}`);
    const big: RawEntry = { path: 'fonts/grande.ttf', type: 'file', size: ARCHIVE_LIMITS.maxFontBytes, read: () => new Uint8Array(0) };
    reject([big, { ...big, path: 'fonts/otra.ttf' }, { ...big, path: 'fonts/tercera.ttf' }], `El contenido supera los ${ARCHIVE_LIMITS.maxTotalBytes} bytes admitidos en total`);
    expect(applyEntryPolicy([raw('theme.toml', ARCHIVE_LIMITS.maxFileBytes)]).files[0]?.bytes.length).toBe(ARCHIVE_LIMITS.maxFileBytes);
  });

  it('el directorio raíz es opcional y se ignora como entrada; fonts/ como directorio también', () => {
    const archive = applyEntryPolicy([raw('comunidad', 0, 'directory'), raw('comunidad/fonts', 0, 'directory'), raw('comunidad/theme.toml'), raw('comunidad/fonts/a-1.otf')]);
    expect(archive).toMatchObject({ root: 'comunidad', files: [{ path: 'fonts/a-1.otf' }, { path: 'theme.toml' }] });
    expect(applyEntryPolicy([raw('fonts', 0, 'directory'), raw('fonts/a.ttf'), raw('theme.toml')]).root).toBeUndefined();
  });
});

describe('zip: corrupción, cifrado, zip64 y métodos', () => {
  const entries = [{ path: 'theme.toml', data: TOML }];

  it('explica el fin de directorio ausente, zip64, cifrado, método desconocido y directorio central truncado', () => {
    expect(readThemeArchive(Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(40)]))).toEqual({ ok: false, message: 'No es un archivo zip válido: falta el fin del directorio central' });
    expect(readThemeArchive(buildZip(entries, { count: 0xffff }))).toEqual({ ok: false, message: 'No se admiten archivos zip64' });
    expect(readThemeArchive(buildZip(entries, { directoryOffset: 0xffffffff }))).toEqual({ ok: false, message: 'No se admiten archivos zip64' });
    expect(readThemeArchive(buildZip([{ path: 'theme.toml', data: TOML, zip64: true }]))).toEqual({ ok: false, message: 'No se admiten archivos zip64' });
    expect(readThemeArchive(buildZip([{ path: 'theme.toml', data: TOML, flags: 0x1 }]))).toEqual({ ok: false, message: 'La entrada «theme.toml» está cifrada: no se admite' });
    expect(readThemeArchive(buildZip([{ path: 'theme.toml', data: TOML, method: 12 }]))).toEqual({
      ok: false,
      message: 'La entrada «theme.toml» usa el método de compresión 12; solo se admiten store y deflate',
    });
    expect(readThemeArchive(buildZip([{ path: 'otro/', method: 12 }, ...entries]))).toEqual({ ok: false, message: `El directorio «otro/» no se admite: ${ALLOWED}` });
    expect(readThemeArchive(buildZip(entries, { count: 2 }))).toEqual({ ok: false, message: 'Archivo zip corrupto: directorio central truncado en la entrada 2 de 2' });
  });

  it('explica la cabecera local descolocada, los datos que faltan y las entradas corruptas (CRC, tamaño, deflate)', () => {
    const zip = buildZip(entries);
    const moved = Buffer.from(zip);
    moved.writeUInt32LE(1, zip.length - 22 - (46 + 'theme.toml'.length) + 42); // localOffset del directorio central
    expect(readThemeArchive(moved)).toEqual({ ok: false, message: 'Archivo zip corrupto: la cabecera local de «theme.toml» no está donde el directorio central dice' });
    const hungry = Buffer.from(zip);
    hungry.writeUInt32LE(0x7fffffff, zip.length - 22 - (46 + 'theme.toml'.length) + 20); // compressedSize del directorio central
    expect(readThemeArchive(hungry)).toEqual({ ok: false, message: 'Archivo zip truncado: faltan datos de «theme.toml»' });
    expect(readThemeArchive(buildZip([{ path: 'theme.toml', data: TOML, badCrc: true }]))).toEqual({ ok: false, message: 'La entrada «theme.toml» está corrupta: tamaño o CRC-32 distintos de los declarados' });
    expect(readThemeArchive(buildZip([{ path: 'theme.toml', data: TOML, declaredSize: TOML.length + 1 }]))).toMatchObject({ ok: false, message: /está corrupta: tamaño o CRC-32/ });
    expect(readThemeArchive(buildZip([{ path: 'theme.toml', data: TOML, method: 8, declaredSize: 3 }]))).toMatchObject({ ok: false, message: /La entrada «theme.toml» está corrupta: / });
    const garbage = buildZip([{ path: 'theme.toml', data: 'no es deflate', method: 8 }]);
    Buffer.from([0xff, 0xff, 0xff, 0xff]).copy(garbage, 30 + 'theme.toml'.length); // los bytes «comprimidos» pasan a ser basura
    expect(readThemeArchive(garbage)).toMatchObject({ ok: false, message: /La entrada «theme.toml» está corrupta: / });
    const [entry] = readZipEntries(buildZip([{ path: 'theme.toml', data: TOML }]));
    if (entry?.type !== 'file') {
      throw new Error('se esperaba un fichero');
    }
    expect(() => entry.read(2)).toThrow(new ArchiveError(`La entrada «theme.toml» pesa ${TOML.length} bytes; el máximo es 2`));
  });

  it('deduce el tipo por los atributos unix o por la barra final (zip de Windows)', () => {
    const kinds = readZipEntries(
      buildZip([
        { path: 'd/', mode: 0 },
        { path: 'f', mode: 0 },
        { path: 'l', mode: 0o120777, data: 'x' },
        { path: 'p', mode: 0o10644 },
        { path: 'r', mode: 0o100644, data: 'x' },
        { path: 'dd', mode: 0o40755 },
      ]),
    ).map((entry) => [entry.path, entry.type, entry.type === 'file' ? entry.size : undefined]);
    expect(kinds).toEqual([
      ['d/', 'directory', undefined],
      ['f', 'file', 0],
      ['l', 'symlink', undefined],
      ['p', 'other', undefined],
      ['r', 'file', 1],
      ['dd', 'directory', undefined],
    ]);
  });
});

describe('tar.gz: corrupción, tipos y tamaño', () => {
  it('explica gzip corrupto, tar demasiado grande, sumas de comprobación, tamaños no octales, tipos no admitidos y datos que faltan', () => {
    expect(readThemeArchive(Buffer.from([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3, 4, 5, 6, 7, 8]))).toMatchObject({ ok: false, message: /^Archivo gzip corrupto: / });
    const huge = gzipStored(new Uint8Array(ARCHIVE_LIMITS.maxTotalBytes + 64 * 1024));
    expect(readThemeArchive(huge)).toEqual({ ok: false, message: `El archivo descomprimido supera los ${ARCHIVE_LIMITS.maxTotalBytes} bytes admitidos` });
    expect(readThemeArchive(gzipStored(buildTar([{ path: 'theme.toml', data: TOML, badChecksum: true }])))).toEqual({ ok: false, message: 'Archivo tar corrupto: la suma de comprobación de «theme.toml» no cuadra' });
    expect(readThemeArchive(gzipStored(buildTar([{ path: 'theme.toml', data: TOML, badSize: true }])))).toEqual({ ok: false, message: 'Archivo tar corrupto: el tamaño de «theme.toml» no es octal («12x»)' });
    expect(readThemeArchive(gzipStored(buildTar([{ path: 'theme.toml', data: TOML, type: 'L' }])))).toEqual({ ok: false, message: 'La entrada «theme.toml» es de tipo «L»: solo se admiten ficheros y directorios' });
    expect(readThemeArchive(gzipStored(buildTar([{ path: 'theme.toml', data: TOML, truncate: true }])))).toEqual({ ok: false, message: 'Archivo tar truncado: faltan datos de «theme.toml»' });
    expect(readThemeArchive(gzipStored(buildTar([{ path: 'template.typ', data: TYP, type: '2', linkName: '/etc/passwd' }, { path: 'theme.toml', data: TOML }])))).toEqual({
      ok: false,
      message: 'La entrada «template.typ» es un enlace: no se admiten enlaces simbólicos ni duros',
    });
    expect(readThemeArchive(gzipStored(buildTar([{ path: 'template.typ', type: '1', linkName: 'theme.toml' }, { path: 'theme.toml', data: TOML }])))).toMatchObject({ ok: false, message: /es un enlace/ });
    const [entry] = readTarGzEntries(gzipStored(buildTar([{ path: 'theme.toml', data: TOML }])));
    expect(entry).toMatchObject({ path: 'theme.toml', type: 'file', size: TOML.length });
    if (entry?.type !== 'file') {
      throw new Error('se esperaba un fichero');
    }
    expect(() => entry.read(1)).toThrow(`La entrada «theme.toml» pesa ${TOML.length} bytes; el máximo es 1`);
    expect(readTarGzEntries(gzipStored(Buffer.alloc(1024)))).toEqual([]);
  });
});
