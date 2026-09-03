/**
 * Generar el CV en **ODT** (T-9.23, `docs/odt-integration.md`): OpenDocument, el formato abierto de
 * LibreOffice, Word y Google Docs. Es la salida para **seguir editando a mano**.
 *
 * Desde T-9.26 **hereda el tema**: los colores, tipografías, tamaños, espaciado y página de `theme.toml` van a
 * los estilos con nombre —que es lo que hace editable a un ODT: tocas un estilo y cambia todo el documento— y
 * su `[layout]` decide el orden de las secciones, si los logros se consolidan y cuánto se cuenta de cada
 * puesto. Lo que NO hereda es la maquetación del `template.typ` (columnas, paneles, tablas): eso es código
 * Typst y no cabe en un documento pensado para editarse a mano.
 *
 * Sin dependencias y sin red: el paquete se arma con `zlib` (`zip.ts`) y los XML se componen a partir del mismo
 * `StructuredView` que usan Typst y pdfkit, así que el CV es exactamente el mismo. Determinista: el mismo perfil
 * produce el mismo documento (los bytes comprimidos dependen de la zlib de cada máquina, como en los PDF).
 */
import type { MasterProfile } from '../../core/schema';
import type { ThemeConfig } from '../../themes/schema';
import { DEFAULT_LOCALE } from '../markdown/renderer';
import { applyLayout, buildStructuredView, resolveLayout } from '../structured';
import { ODT_MIMETYPE, contentXml, manifestXml, metaXml, stylesXml } from './document';
import { writeZip } from './zip';

export { ODT_MIMETYPE } from './document';
export { writeZip, type ZipEntry, type ZipMethod } from './zip';

export interface OdtOptions {
  readonly locale?: string | undefined;
  /** Lo que se anota como generador en `meta.xml`. */
  readonly generator?: string | undefined;
  /**
   * El tema del que hereda el documento (T-9.26): colores, tipografías, tamaños, espaciado y página van a los
   * estilos con nombre, y su `[layout]` decide el orden de las secciones y dónde viven los logros. Sin tema,
   * el aspecto y la organización de T-9.23.
   */
  readonly theme?: ThemeConfig | undefined;
}

export function renderOdtCv(profile: MasterProfile, options: OdtOptions = {}): Buffer {
  const layout = resolveLayout(options.theme?.layout);
  const view = applyLayout(buildStructuredView(profile, options.locale ?? profile.meta.locale ?? DEFAULT_LOCALE), layout);
  // El orden NO es libre: `mimetype` va primero y sin comprimir para que el paquete se reconozca por sus
  // primeros bytes (OpenDocument v1.3 §3.3).
  return writeZip([
    { name: 'mimetype', content: ODT_MIMETYPE, method: 'store' },
    { name: 'META-INF/manifest.xml', content: manifestXml() },
    { name: 'meta.xml', content: metaXml(view, options.generator ?? 'Chameleon CV') },
    { name: 'styles.xml', content: stylesXml(view, options.theme) },
    { name: 'content.xml', content: contentXml(view, layout, options.theme) },
  ]);
}
