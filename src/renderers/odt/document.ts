/**
 * `StructuredView` → los XML de un paquete ODF (T-9.23, `docs/odt-integration.md` §3). Mismo modelo que comen
 * la plantilla de Typst y el maquetador de pdfkit, así que el CV es el mismo: cambia el envase.
 *
 * El objetivo de este formato **no es la tipografía, es que puedas editarlo**. De ahí dos decisiones:
 *
 * - Se usan **estilos con nombre** (`Heading_20_1`, `Standard`, `List_20_Paragraph`…), no formato suelto. Así,
 *   cambiar el aspecto de todos los títulos en LibreOffice es tocar un estilo, no repasar el documento.
 * - La estructura es plana y previsible —título, secciones, entradas—, sin cajas ni columnas: lo que se pega y
 *   se reordena sin pelearse con el maquetado.
 */
import type { Block, Run } from '../structured/inline';
import type { StructuredContainer, StructuredView } from '../structured/view';

export const ODT_MIMETYPE = 'application/vnd.oasis.opendocument.text';

/** Los cinco de XML; sin esto, un ampersand en una empresa rompe el documento entero. */
export function escapeXml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => (char === '&' ? '&amp;' : char === '<' ? '&lt;' : char === '>' ? '&gt;' : char === '"' ? '&quot;' : '&apos;'));
}

/**
 * El texto de un run, con los espacios preservados. En ODF los espacios seguidos se colapsan como en HTML, así
 * que una tabulación de dos espacios en un resumen se perdería sin `<text:s/>`.
 */
function textXml(text: string): string {
  return escapeXml(text).replace(/ {2,}/g, (spaces) => ` <text:s text:c="${spaces.length - 1}"/>`);
}

/** El estilo de texto automático que le toca a un run; `undefined` si va sin adornos. */
function styleOf(run: Run): string | undefined {
  if (run.code) {
    return 'Mono';
  }
  if (run.bold && run.italic) {
    return 'BoldItalic';
  }
  if (run.bold) {
    return 'Bold';
  }
  return run.italic ? 'Italic' : undefined;
}

export function runXml(run: Run): string {
  const style = styleOf(run);
  const inner = style === undefined ? textXml(run.text) : `<text:span text:style-name="${style}">${textXml(run.text)}</text:span>`;
  return run.link === undefined ? inner : `<text:a xlink:type="simple" xlink:href="${escapeXml(run.link)}">${inner}</text:a>`;
}

export function runsXml(runs: readonly Run[]): string {
  return runs.map(runXml).join('');
}

function paragraph(style: string, inner: string): string {
  return `<text:p text:style-name="${style}">${inner}</text:p>`;
}

/** Un bloque de Markdown ya descompuesto: párrafo normal, viñeta o bloque de código. */
function blockXml(block: Block): string {
  const inner = runsXml(block.runs);
  if (block.bullet) {
    return `<text:list text:style-name="Vinetas"><text:list-item>${paragraph('List_20_Paragraph', inner)}</text:list-item></text:list>`;
  }
  return paragraph(block.code ? 'Preformatted_20_Text' : 'Standard', inner);
}

function blocksXml(blocks: readonly Block[]): string {
  return blocks.map(blockXml).join('');
}

function heading(level: 1 | 2, text: string): string {
  return `<text:h text:style-name="Heading_20_${level}" text:outline-level="${level}">${textXml(text)}</text:h>`;
}

/** Los datos de una entrada que no son prosa: periodo, ubicación… en una línea discreta. */
function meta(parts: ReadonlyArray<string | undefined>): string {
  const line = parts.filter((part): part is string => part !== undefined && part !== '').join(' · ');
  return line === '' ? '' : paragraph('Meta', textXml(line));
}

function container(item: StructuredContainer, labels: StructuredView['labels']): string {
  const achievements = item.achievements
    .map((achievement) => {
      const impact = achievement.impact === undefined ? '' : ` <text:span text:style-name="Italic">(${textXml(achievement.impact)})</text:span>`;
      return `<text:list-item>${paragraph('List_20_Paragraph', `${runsXml(achievement.runs)}${impact}`)}</text:list-item>`;
    })
    .join('');
  return [
    blocksXml(item.summary),
    achievements === '' ? '' : `<text:list text:style-name="Vinetas">${achievements}</text:list>`,
    item.technologies === '' ? '' : meta([`${labels.technologies}: ${item.technologies}`]),
  ].join('');
}

function sections(view: StructuredView): string {
  const { labels } = view;
  const out: string[] = [];

  if (view.experience.length > 0) {
    out.push(heading(1, labels.experience));
    for (const item of view.experience) {
      out.push(heading(2, `${item.role} · ${item.company}`), meta([item.period, item.location]), container(item, labels));
    }
  }
  if (view.projects.length > 0) {
    out.push(heading(1, labels.projects));
    for (const item of view.projects) {
      out.push(heading(2, item.role === undefined ? item.name : `${item.name} · ${item.role}`), meta([item.meta]), container(item, labels));
    }
  }
  if (view.skillGroups.length > 0) {
    out.push(heading(1, labels.skills));
    for (const group of view.skillGroups) {
      out.push(paragraph('Standard', `<text:span text:style-name="Bold">${textXml(group.label)}:</text:span> ${textXml(group.names)}`));
    }
  }
  if (view.achievements.length > 0) {
    out.push(heading(1, labels.achievements));
    const items = view.achievements
      .map((achievement) => {
        const impact = achievement.impact === undefined ? '' : ` <text:span text:style-name="Italic">(${textXml(achievement.impact)})</text:span>`;
        return `<text:list-item>${paragraph('List_20_Paragraph', `${runsXml(achievement.runs)}${impact}`)}</text:list-item>`;
      })
      .join('');
    out.push(`<text:list text:style-name="Vinetas">${items}</text:list>`);
  }
  if (view.education.length > 0) {
    out.push(heading(1, labels.education));
    for (const item of view.education) {
      out.push(paragraph('Standard', `<text:span text:style-name="Bold">${textXml(item.degree)}</text:span> · ${textXml(item.institution)}`), meta([item.field, item.period]));
    }
  }
  if (view.certifications.length > 0) {
    out.push(heading(1, labels.certifications));
    for (const item of view.certifications) {
      const link = item.url === undefined ? '' : ` · <text:a xlink:type="simple" xlink:href="${escapeXml(item.url)}">${textXml(labels.link)}</text:a>`;
      out.push(paragraph('Standard', `<text:span text:style-name="Bold">${textXml(item.name)}</text:span>${item.issuer === undefined ? '' : ` · ${textXml(item.issuer)}`}${item.date === '' ? '' : ` · ${textXml(item.date)}`}${link}`));
    }
  }
  if (view.languages.length > 0) {
    out.push(heading(1, labels.languages));
    out.push(paragraph('Standard', view.languages.map((language) => `<text:span text:style-name="Bold">${textXml(language.name)}:</text:span> ${textXml(language.level)}`).join(' · ')));
  }
  return out.join('');
}

const CONTENT_NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
].join(' ');

/** Los estilos automáticos: los adornos de texto y la lista de viñetas que usan los párrafos. */
const AUTOMATIC_STYLES = [
  '<style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>',
  '<style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>',
  '<style:style style:name="BoldItalic" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style>',
  '<style:style style:name="Mono" style:family="text"><style:text-properties style:font-name-complex="Liberation Mono" fo:font-family="&apos;Liberation Mono&apos;"/></style:style>',
  '<text:list-style style:name="Vinetas"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:space-before="0.25cm" text:min-label-width="0.4cm"/></text:list-level-style-bullet></text:list-style>',
].join('');

export function contentXml(view: StructuredView): string {
  const header = [
    `<text:h text:style-name="Title" text:outline-level="0">${textXml(view.fullName)}</text:h>`,
    view.headline === undefined ? '' : paragraph('Subtitle', textXml(view.headline)),
    view.contact.length === 0 ? '' : paragraph('Meta', runsXml(view.contact)),
    blocksXml(view.summary),
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${CONTENT_NS} office:version="1.3"><office:automatic-styles>${AUTOMATIC_STYLES}</office:automatic-styles><office:body><office:text>${header}${sections(view)}</office:text></office:body></office:document-content>`;
}

const STYLES_NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0"',
].join(' ');

/**
 * Los estilos con nombre. Son los que ve el usuario en LibreOffice: tocar «Encabezado 1» aquí cambia todos los
 * títulos de sección de golpe, que es de lo que sirve un formato editable frente a un PDF.
 */
function namedStyle(name: string, parent: string | undefined, paragraphProps: string, textProps: string): string {
  const parentAttr = parent === undefined ? '' : ` style:parent-style-name="${parent}"`;
  // Todos los estilos definen propiedades de párrafo; las de texto son opcionales (una lista solo cambia márgenes).
  const text = textProps === '' ? '' : `<style:text-properties ${textProps}/>`;
  return `<style:style style:name="${name}" style:family="paragraph"${parentAttr}><style:paragraph-properties ${paragraphProps}/>${text}</style:style>`;
}

export function stylesXml(view: StructuredView): string {
  const styles = [
    namedStyle('Standard', undefined, 'fo:margin-bottom="0.18cm" fo:text-align="justify"', `fo:font-size="10.5pt" fo:language="${escapeXml(view.lang)}" fo:font-family="&apos;Liberation Sans&apos;"`),
    namedStyle('Title', 'Standard', 'fo:margin-bottom="0.1cm" fo:keep-with-next="always"', 'fo:font-size="22pt" fo:font-weight="bold"'),
    namedStyle('Subtitle', 'Standard', 'fo:margin-bottom="0.15cm"', 'fo:font-size="12pt" fo:color="#59636f"'),
    namedStyle('Meta', 'Standard', 'fo:margin-bottom="0.15cm" fo:text-align="start"', 'fo:font-size="9.5pt" fo:color="#59636f"'),
    namedStyle('Heading_20_1', 'Standard', 'fo:margin-top="0.5cm" fo:margin-bottom="0.15cm" fo:keep-with-next="always" fo:border-bottom="0.5pt solid #c9d1d9" fo:padding-bottom="0.08cm"', 'fo:font-size="14pt" fo:font-weight="bold"'),
    namedStyle('Heading_20_2', 'Standard', 'fo:margin-top="0.3cm" fo:margin-bottom="0.05cm" fo:keep-with-next="always"', 'fo:font-size="11.5pt" fo:font-weight="bold"'),
    namedStyle('List_20_Paragraph', 'Standard', 'fo:margin-bottom="0.06cm" fo:text-align="start"', ''),
    namedStyle('Preformatted_20_Text', 'Standard', 'fo:margin-bottom="0.15cm" fo:text-align="start"', 'fo:font-family="&apos;Liberation Mono&apos;" fo:font-size="9.5pt"'),
  ].join('');
  // A4 con márgenes de 2 cm: el mismo tamaño de papel que el resto de salidas.
  const page =
    '<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" style:print-orientation="portrait" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>';
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-styles ${STYLES_NS} office:version="1.3"><office:styles>${styles}</office:styles>${page}</office:document-styles>`;
}

/** `meta.xml`: quién lo generó y el título. Sin fecha: el documento tiene que salir igual dos veces. */
export function metaXml(view: StructuredView, generator: string): string {
  const ns = [
    'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
    'xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0"',
    'xmlns:dc="http://purl.org/dc/elements/1.1/"',
  ].join(' ');
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-meta ${ns} office:version="1.3"><office:meta><meta:generator>${escapeXml(generator)}</meta:generator><dc:title>${escapeXml(view.fullName)}</dc:title><dc:language>${escapeXml(view.lang)}</dc:language></office:meta></office:document-meta>`;
}

export function manifestXml(): string {
  const ns = 'xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0"';
  const entry = (path: string, type: string): string => `<manifest:file-entry manifest:full-path="${path}" manifest:media-type="${type}"/>`;
  return `<?xml version="1.0" encoding="UTF-8"?><manifest:manifest ${ns} manifest:version="1.3">${entry('/', ODT_MIMETYPE)}${entry('content.xml', 'text/xml')}${entry('styles.xml', 'text/xml')}${entry('meta.xml', 'text/xml')}</manifest:manifest>`;
}
