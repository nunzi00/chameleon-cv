/**
 * Constructores de archivos para las pruebas y el banco (T-8.3): zip (store o deflate, con atributos unix y
 * defectos a demanda), tar ustar y gzip; `gzipStored` escribe bloques deflate almacenados a mano para que
 * los bytes no dependan de la implementación de zlib de la máquina (zlib-ng en Arch, zlib en Node oficial).
 */
import { crc32, deflateRawSync, gzipSync } from 'node:zlib';

export interface ZipInput {
  readonly path: string;
  readonly data?: Uint8Array | string | undefined;
  /** Modo unix (los atributos externos); por defecto 0o100644 para ficheros y 0o40755 si la ruta acaba en «/». */
  readonly mode?: number | undefined;
  readonly method?: number | undefined;
  readonly flags?: number | undefined;
  /** Defectos deliberados. */
  readonly badCrc?: boolean | undefined;
  /** Tamaño descomprimido declarado, si debe mentir. */
  readonly declaredSize?: number | undefined;
  readonly zip64?: boolean | undefined;
}

export interface ZipOptions {
  readonly time?: number | undefined;
  readonly date?: number | undefined;
  readonly comment?: string | undefined;
  /** Sustituye el número de entradas del fin del directorio central (para simular zip64 o corrupción). */
  readonly count?: number | undefined;
  readonly directoryOffset?: number | undefined;
}

function bytesOf(data: Uint8Array | string | undefined): Uint8Array {
  return data === undefined ? new Uint8Array(0) : typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
}

function u16(value: number): Buffer {
  const out = Buffer.alloc(2);
  out.writeUInt16LE(value);
  return out;
}

function u32(value: number): Buffer {
  const out = Buffer.alloc(4);
  out.writeUInt32LE(value >>> 0);
  return out;
}

export function buildZip(entries: readonly ZipInput[], options: ZipOptions = {}): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path, 'utf8');
    const content = bytesOf(entry.data);
    const method = entry.method ?? 0;
    const stored = method === 8 ? deflateRawSync(content) : content;
    const crc = (crc32(content) ^ (entry.badCrc === true ? 0xffffffff : 0)) >>> 0;
    const size = entry.declaredSize ?? content.length;
    const mode = entry.mode ?? (entry.path.endsWith('/') ? 0o40755 : 0o100644);
    const flags = entry.flags ?? 0;
    const time = options.time ?? 0;
    const date = options.date ?? 0;
    const compressedSize = entry.zip64 === true ? 0xffffffff : stored.length;
    const local = Buffer.concat([u32(0x04034b50), u16(20), u16(flags), u16(method), u16(time), u16(date), u32(crc), u32(compressedSize), u32(size), u16(name.length), u16(0), name, stored]);
    const central = Buffer.concat([
      u32(0x02014b50),
      u16((3 << 8) | 20),
      u16(20),
      u16(flags),
      u16(method),
      u16(time),
      u16(date),
      u32(crc),
      u32(compressedSize),
      u32(size),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32((mode << 16) >>> 0),
      u32(offset),
      name,
    ]);
    locals.push(local);
    centrals.push(central);
    offset += local.length;
  }
  const directory = Buffer.concat(centrals);
  const comment = Buffer.from(options.comment ?? '', 'utf8');
  const count = options.count ?? entries.length;
  const end = Buffer.concat([u32(0x06054b50), u16(0), u16(0), u16(count), u16(count), u32(directory.length), u32(options.directoryOffset ?? offset), u16(comment.length), comment]);
  return Buffer.concat([...locals, directory, end]);
}

export interface TarInput {
  readonly path: string;
  readonly data?: Uint8Array | string | undefined;
  /** Indicador de tipo ustar: «0» fichero, «5» directorio, «2» enlace simbólico, «L» nombre largo GNU… */
  readonly type?: string | undefined;
  readonly mode?: number | undefined;
  readonly prefix?: string | undefined;
  readonly linkName?: string | undefined;
  readonly badChecksum?: boolean | undefined;
  readonly badSize?: boolean | undefined;
  /** Declara más bytes de los que siguen (archivo truncado). */
  readonly truncate?: boolean | undefined;
}

function octal(value: number, length: number): Buffer {
  return Buffer.from(`${value.toString(8).padStart(length - 1, '0')}\0`, 'latin1');
}

function field(text: string, length: number): Buffer {
  const out = Buffer.alloc(length);
  out.write(text, 'latin1');
  return out;
}

export function buildTar(entries: readonly TarInput[], mtime = 0): Buffer {
  const blocks: Buffer[] = [];
  for (const entry of entries) {
    const content = bytesOf(entry.data);
    const type = entry.type ?? (entry.path.endsWith('/') ? '5' : '0');
    const header = Buffer.alloc(512);
    field(entry.path, 100).copy(header, 0);
    octal(entry.mode ?? (type === '5' ? 0o755 : 0o644), 8).copy(header, 100);
    octal(0, 8).copy(header, 108);
    octal(0, 8).copy(header, 116);
    if (entry.badSize === true) {
      field('12x', 12).copy(header, 124);
    } else {
      octal(entry.truncate === true ? content.length + 4096 : content.length, 12).copy(header, 124);
    }
    octal(mtime, 12).copy(header, 136);
    Buffer.from('        ', 'latin1').copy(header, 148);
    field(type, 1).copy(header, 156);
    field(entry.linkName ?? '', 100).copy(header, 157);
    field('ustar\0', 6).copy(header, 257);
    field('00', 2).copy(header, 263);
    field(entry.prefix ?? '', 155).copy(header, 345);
    let sum = 0;
    for (const byte of header) {
      sum += byte;
    }
    if (entry.badChecksum === true) {
      sum += 1;
    }
    Buffer.from(`${sum.toString(8).padStart(6, '0')}\0 `, 'latin1').copy(header, 148);
    blocks.push(header);
    if (entry.truncate !== true) {
      const padded = Buffer.alloc(Math.ceil(content.length / 512) * 512);
      Buffer.from(content).copy(padded);
      blocks.push(padded);
    } else {
      blocks.push(Buffer.from(content));
    }
  }
  blocks.push(Buffer.alloc(1024));
  return Buffer.concat(blocks);
}

/** gzip con bloques deflate almacenados escritos a mano: bytes idénticos en cualquier máquina. */
export function gzipStored(data: Uint8Array, mtime = 0): Buffer {
  const header = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0, 0, 0, 0, 0x00, 0x03]);
  header.writeUInt32LE(mtime, 4);
  const blocks: Buffer[] = [];
  const chunk = 0xffff;
  const count = Math.max(1, Math.ceil(data.length / chunk));
  for (let index = 0; index < count; index += 1) {
    const slice = data.subarray(index * chunk, Math.min(data.length, (index + 1) * chunk));
    const head = Buffer.alloc(5);
    head[0] = index === count - 1 ? 1 : 0;
    head.writeUInt16LE(slice.length, 1);
    head.writeUInt16LE(slice.length ^ 0xffff, 3);
    blocks.push(head, Buffer.from(slice));
  }
  const trailer = Buffer.alloc(8);
  trailer.writeUInt32LE(crc32(data), 0);
  trailer.writeUInt32LE(data.length >>> 0, 4);
  return Buffer.concat([header, ...blocks, trailer]);
}

export function buildTarGz(entries: readonly TarInput[], options: { readonly deterministic?: boolean | undefined; readonly mtime?: number | undefined } = {}): Buffer {
  const tar = buildTar(entries, options.mtime ?? 0);
  return options.deterministic === false ? gzipSync(tar) : gzipStored(tar, options.mtime ?? 0);
}
