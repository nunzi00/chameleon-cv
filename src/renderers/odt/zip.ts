/**
 * Escritor de zip mínimo y **determinista** (T-9.23, `docs/odt-integration.md` §2): lo que hace falta para
 * empaquetar un ODF y nada más. Sin dependencias: `zlib` para el CRC y el deflate, y las cabeceras a mano, como
 * el lector de `src/themes/archive.ts`.
 *
 * Dos exigencias que no son caprichos:
 *
 * - **Determinista**: fecha fija en todas las entradas, así que el mismo perfil produce el mismo fichero byte a
 *   byte. Es lo mismo que ya se exige del PDF, y es lo que permite comparar una salida con su golden.
 * - **`mimetype` primero y SIN comprimir**: el paquete ODF se reconoce leyendo los primeros bytes del zip
 *   (OpenDocument v1.3 §3.3), así que esa entrada tiene que ir la primera y almacenada. Comprimida, LibreOffice
 *   abre el fichero igual pero `file(1)` y medio mundo lo ven como un zip cualquiera.
 */
import { crc32, deflateRawSync } from 'node:zlib';

/** Cómo se guarda una entrada: `store` (tal cual) o `deflate`. */
export type ZipMethod = 'store' | 'deflate';

export interface ZipEntry {
  readonly name: string;
  readonly content: string | Uint8Array;
  /** Por defecto `deflate`; el `mimetype` de un ODF exige `store`. */
  readonly method?: ZipMethod | undefined;
}

/** 1980-01-01 00:00, el mínimo que admite el formato: sin reloj no hay dos salidas distintas. */
const DOS_TIME = 0;
const DOS_DATE = 0x0021;

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_CENTRAL = 0x06054b50;

interface Packed {
  readonly name: Buffer;
  readonly raw: Buffer;
  readonly body: Buffer;
  readonly method: number;
  readonly crc: number;
  readonly offset: number;
}

function bytesOf(content: string | Uint8Array): Buffer {
  return typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content);
}

/** El zip con las entradas en el orden dado; ese orden importa en un ODF (`mimetype` va primero). */
export function writeZip(entries: readonly ZipEntry[]): Buffer {
  const locals: Buffer[] = [];
  const packed: Packed[] = [];
  let offset = 0;
  for (const entry of entries) {
    const raw = bytesOf(entry.content);
    const stored = entry.method === 'store';
    const body = stored ? raw : deflateRawSync(raw);
    const name = Buffer.from(entry.name, 'utf8');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(LOCAL_HEADER, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(stored ? 0 : 8, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    const crc = crc32(raw);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.byteLength, 18);
    header.writeUInt32LE(raw.byteLength, 22);
    header.writeUInt16LE(name.byteLength, 26);
    locals.push(header, name, body);
    packed.push({ name, raw, body, method: stored ? 0 : 8, crc, offset });
    offset += header.byteLength + name.byteLength + body.byteLength;
  }

  const central: Buffer[] = [];
  for (const entry of packed) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(CENTRAL_HEADER, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(entry.method, 10);
    header.writeUInt16LE(DOS_TIME, 12);
    header.writeUInt16LE(DOS_DATE, 14);
    header.writeUInt32LE(entry.crc, 16);
    header.writeUInt32LE(entry.body.byteLength, 20);
    header.writeUInt32LE(entry.raw.byteLength, 24);
    header.writeUInt16LE(entry.name.byteLength, 28);
    header.writeUInt32LE(entry.offset, 42);
    central.push(header, entry.name);
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_CENTRAL, 0);
  end.writeUInt16LE(packed.length, 8);
  end.writeUInt16LE(packed.length, 10);
  end.writeUInt32LE(directory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}
