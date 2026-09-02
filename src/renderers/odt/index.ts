/**
 * Generar el CV en **ODT** (T-9.23, `docs/odt-integration.md`): OpenDocument, el formato abierto de
 * LibreOffice, Word y Google Docs. Es la salida para **seguir editando a mano**, no para imprimir: el PDF y
 * Typst ya cubren la tipografía.
 *
 * Sin dependencias y sin red: el paquete se arma con `zlib` (`zip.ts`) y los XML se componen a partir del mismo
 * `StructuredView` que usan Typst y pdfkit, así que el CV es exactamente el mismo. Determinista: el mismo perfil
 * produce el mismo documento (los bytes comprimidos dependen de la zlib de cada máquina, como en los PDF).
 */
import type { MasterProfile } from '../../core/schema';
import { DEFAULT_LOCALE } from '../markdown/renderer';
import { buildStructuredView } from '../structured';
import { ODT_MIMETYPE, contentXml, manifestXml, metaXml, stylesXml } from './document';
import { writeZip } from './zip';

export { ODT_MIMETYPE } from './document';
export { writeZip, type ZipEntry, type ZipMethod } from './zip';

export interface OdtOptions {
  readonly locale?: string | undefined;
  /** Lo que se anota como generador en `meta.xml`. */
  readonly generator?: string | undefined;
}

export function renderOdtCv(profile: MasterProfile, options: OdtOptions = {}): Buffer {
  const view = buildStructuredView(profile, options.locale ?? profile.meta.locale ?? DEFAULT_LOCALE);
  // El orden NO es libre: `mimetype` va primero y sin comprimir para que el paquete se reconozca por sus
  // primeros bytes (OpenDocument v1.3 §3.3).
  return writeZip([
    { name: 'mimetype', content: ODT_MIMETYPE, method: 'store' },
    { name: 'META-INF/manifest.xml', content: manifestXml() },
    { name: 'meta.xml', content: metaXml(view, options.generator ?? 'Chameleon CV') },
    { name: 'styles.xml', content: stylesXml(view) },
    { name: 'content.xml', content: contentXml(view) },
  ]);
}
