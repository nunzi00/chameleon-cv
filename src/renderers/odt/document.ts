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
import { PAPER_SIZES, type ThemeConfig } from '../../themes/schema';
import { DEFAULT_LAYOUT, type CvLayout } from '../structured/layout';
import type { Block, Run } from '../structured/inline';
import type { StructuredAchievement, StructuredContainer, StructuredView } from '../structured/view';

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

/** Una viñeta de logro: su texto, el impacto en cursiva y, si viene consolidado, de dónde sale. */
function achievementItem(achievement: StructuredAchievement): string {
  const source = achievement.source === undefined ? '' : `<text:span text:style-name="Bold">${textXml(achievement.source)}:</text:span> `;
  const impact = achievement.impact === undefined ? '' : ` <text:span text:style-name="Italic">(${textXml(achievement.impact)})</text:span>`;
  return `<text:list-item>${paragraph('List_20_Paragraph', `${source}${runsXml(achievement.runs)}${impact}`)}</text:list-item>`;
}

function achievementList(achievements: readonly StructuredAchievement[]): string {
  return achievements.length === 0 ? '' : `<text:list text:style-name="Vinetas">${achievements.map(achievementItem).join('')}</text:list>`;
}

function container(item: StructuredContainer, labels: StructuredView['labels']): string {
  return [blocksXml(item.summary), achievementList(item.achievements), item.technologies === '' ? '' : meta([`${labels.technologies}: ${item.technologies}`])].join('');
}

/** Cada sección sabe pintarse sola; el orden lo pone el tema, no este fichero. */
const SECTION_XML: Readonly<Record<CvLayout['sections'][number], (view: StructuredView) => string>> = {
  experience: (view) =>
    view.experience.length === 0
      ? ''
      : [heading(1, view.labels.experience), ...view.experience.map((item) => `${heading(2, `${item.role} · ${item.company}`)}${meta([item.period, item.location])}${container(item, view.labels)}`)].join(''),
  projects: (view) =>
    view.projects.length === 0
      ? ''
      : [
          heading(1, view.labels.projects),
          ...view.projects.map((item) => `${heading(2, item.role === undefined ? item.name : `${item.name} · ${item.role}`)}${meta([item.meta])}${container(item, view.labels)}`),
        ].join(''),
  skills: (view) =>
    view.skillGroups.length === 0
      ? ''
      : [heading(1, view.labels.skills), ...view.skillGroups.map((group) => paragraph('Standard', `<text:span text:style-name="Bold">${textXml(group.label)}:</text:span> ${textXml(group.names)}`))].join(''),
  achievements: (view) => (view.achievements.length === 0 ? '' : `${heading(1, view.labels.achievements)}${achievementList(view.achievements)}`),
  education: (view) =>
    view.education.length === 0
      ? ''
      : [
          heading(1, view.labels.education),
          ...view.education.map((item) => `${paragraph('Standard', `<text:span text:style-name="Bold">${textXml(item.degree)}</text:span> · ${textXml(item.institution)}`)}${meta([item.field, item.period])}`),
        ].join(''),
  certifications: (view) =>
    view.certifications.length === 0
      ? ''
      : [
          heading(1, view.labels.certifications),
          ...view.certifications.map((item) => {
            const link = item.url === undefined ? '' : ` · <text:a xlink:type="simple" xlink:href="${escapeXml(item.url)}">${textXml(view.labels.link)}</text:a>`;
            return paragraph(
              'Standard',
              `<text:span text:style-name="Bold">${textXml(item.name)}</text:span>${item.issuer === undefined ? '' : ` · ${textXml(item.issuer)}`}${item.date === '' ? '' : ` · ${textXml(item.date)}`}${link}`,
            );
          }),
        ].join(''),
  languages: (view) =>
    view.languages.length === 0
      ? ''
      : `${heading(1, view.labels.languages)}${paragraph('Standard', view.languages.map((language) => `<text:span text:style-name="Bold">${textXml(language.name)}:</text:span> ${textXml(language.level)}`).join(' · '))}`,
};

function sections(view: StructuredView, layout: CvLayout): string {
  return layout.sections.map((section) => SECTION_XML[section](view)).join('');
}

const CONTENT_NS = [
  'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0"',
  'xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0"',
  'xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0"',
  'xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0"',
  'xmlns:xlink="http://www.w3.org/1999/xlink"',
].join(' ');

/** Los estilos automáticos: los adornos de texto y la lista de viñetas que usan los párrafos. */
function automaticStyles(mono: string): string {
  return [
    '<style:style style:name="Bold" style:family="text"><style:text-properties fo:font-weight="bold"/></style:style>',
    '<style:style style:name="Italic" style:family="text"><style:text-properties fo:font-style="italic"/></style:style>',
    '<style:style style:name="BoldItalic" style:family="text"><style:text-properties fo:font-weight="bold" fo:font-style="italic"/></style:style>',
    `<style:style style:name="Mono" style:family="text"><style:text-properties fo:font-family="${family(mono)}"/></style:style>`,
    `<text:list-style style:name="Vinetas"><text:list-level-style-bullet text:level="1" text:bullet-char="•"><style:list-level-properties text:space-before="0.25cm" text:min-label-width="0.4cm"/></text:list-level-style-bullet></text:list-style>`,
  ].join('');
}

export function contentXml(view: StructuredView, layout: CvLayout = DEFAULT_LAYOUT, theme?: ThemeConfig): string {
  const mono = odtStyleOf(theme).fonts.mono;
  const header = [
    `<text:h text:style-name="Title" text:outline-level="0">${textXml(view.fullName)}</text:h>`,
    view.headline === undefined ? '' : paragraph('Subtitle', textXml(view.headline)),
    view.contact.length === 0 ? '' : paragraph('Meta', runsXml(view.contact)),
    blocksXml(view.summary),
  ].join('');
  return `<?xml version="1.0" encoding="UTF-8"?><office:document-content ${CONTENT_NS} office:version="1.3"><office:automatic-styles>${automaticStyles(mono)}</office:automatic-styles><office:body><office:text>${header}${sections(view, layout)}</office:text></office:body></office:document-content>`;
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

/** El aspecto por defecto del ODT, el de T-9.23: el que se usa cuando no hay tema que heredar. */
export interface OdtStyle {
  readonly colors: ThemeConfig['colors'];
  readonly fonts: ThemeConfig['fonts'];
  readonly sizes: ThemeConfig['sizes'];
  readonly spacing: ThemeConfig['spacing'];
  readonly page: ThemeConfig['page'];
}

export const DEFAULT_ODT_STYLE: OdtStyle = {
  colors: { text: '#1f2933', primary: '#1f2933', secondary: '#59636f', accent: '#2a6f97', rule: '#c9d1d9' },
  fonts: { body: 'Liberation Sans', heading: 'Liberation Sans', mono: 'Liberation Mono' },
  sizes: { name: 22, headline: 12, contact: 9.5, section: 14, title: 11.5, meta: 9.5, body: 10.5, footer: 8.5, code: 9.5 },
  spacing: { leading: 0.5, paragraph: 0.7, list: 0.25 },
  page: { paper: 'a4', margins: { top: 20, right: 20, bottom: 20, left: 20 } },
};

/** El tema, si lo hay, en la forma que necesitan los estilos ODF; sin tema, el aspecto de siempre. */
export function odtStyleOf(theme: ThemeConfig | undefined): OdtStyle {
  return theme === undefined ? DEFAULT_ODT_STYLE : { colors: theme.colors, fonts: theme.fonts, sizes: theme.sizes, spacing: theme.spacing, page: theme.page };
}

/** Tamaños de papel en centímetros, con los nombres que usa Typst (`page.paper`). */
const PAPER: Readonly<Record<(typeof PAPER_SIZES)[number], { readonly width: number; readonly height: number }>> = {
  a4: { width: 21, height: 29.7 },
  a5: { width: 14.8, height: 21 },
  a3: { width: 29.7, height: 42 },
  'us-letter': { width: 21.59, height: 27.94 },
  'us-legal': { width: 21.59, height: 35.56 },
};

/** Dos decimales bastan para un centímetro y evitan que un `0.30000000000000004` acabe en el XML. */
function cm(value: number): string {
  return `${(Math.round(value * 100) / 100).toString()}cm`;
}

/** Los «em» de espaciado del tema, en centímetros sobre el cuerpo (1 pt = 0,03528 cm). */
function emToCm(ems: number, bodyPoints: number): string {
  return cm(ems * bodyPoints * 0.03528);
}

function pt(value: number): string {
  return `${value.toString()}pt`;
}

/** Una familia tipográfica citada como espera ODF, con el apóstrofo escapado dentro de un atributo XML. */
function family(name: string): string {
  return `&apos;${escapeXml(name)}&apos;`;
}

export function stylesXml(view: StructuredView, theme?: ThemeConfig): string {
  const style = odtStyleOf(theme);
  const { colors, fonts, sizes, spacing } = style;
  // El interlineado de Typst es el hueco ENTRE líneas; ODF quiere la altura total, así que se suma el cuerpo.
  const lineHeight = `${Math.round((1 + spacing.leading) * 100).toString()}%`;
  const styles = [
    namedStyle(
      'Standard',
      undefined,
      `fo:margin-bottom="${emToCm(spacing.paragraph, sizes.body)}" fo:text-align="justify" fo:line-height="${lineHeight}"`,
      `fo:font-size="${pt(sizes.body)}" fo:language="${escapeXml(view.lang)}" fo:color="${colors.text}" fo:font-family="${family(fonts.body)}"`,
    ),
    namedStyle('Title', 'Standard', 'fo:margin-bottom="0.1cm" fo:keep-with-next="always"', `fo:font-size="${pt(sizes.name)}" fo:font-weight="bold" fo:color="${colors.primary}" fo:font-family="${family(fonts.heading)}"`),
    namedStyle('Subtitle', 'Standard', 'fo:margin-bottom="0.15cm"', `fo:font-size="${pt(sizes.headline)}" fo:color="${colors.secondary}"`),
    namedStyle('Meta', 'Standard', 'fo:margin-bottom="0.15cm" fo:text-align="start"', `fo:font-size="${pt(sizes.meta)}" fo:color="${colors.secondary}"`),
    namedStyle(
      'Heading_20_1',
      'Standard',
      `fo:margin-top="0.5cm" fo:margin-bottom="0.15cm" fo:keep-with-next="always" fo:border-bottom="0.5pt solid ${colors.rule}" fo:padding-bottom="0.08cm"`,
      // `sizes.section` es la ETIQUETA de sección, que casi todas las plantillas Typst maquetan pequeña y en
      // versalitas: copiada tal cual dejaría los títulos más pequeños que el cuerpo, que en un documento se lee
      // como un error. Se respeta la escala del tema, pero nunca por debajo del texto que encabeza.
      `fo:font-size="${pt(Math.max(sizes.section, sizes.body))}" fo:font-weight="bold" fo:color="${colors.primary}" fo:font-family="${family(fonts.heading)}"`,
    ),
    namedStyle(
      'Heading_20_2',
      'Standard',
      'fo:margin-top="0.3cm" fo:margin-bottom="0.05cm" fo:keep-with-next="always"',
      `fo:font-size="${pt(sizes.title)}" fo:font-weight="bold" fo:color="${colors.primary}" fo:font-family="${family(fonts.heading)}"`,
    ),
    namedStyle('List_20_Paragraph', 'Standard', `fo:margin-bottom="${emToCm(spacing.list, sizes.body)}" fo:text-align="start"`, ''),
    namedStyle('Preformatted_20_Text', 'Standard', 'fo:margin-bottom="0.15cm" fo:text-align="start"', `fo:font-family="${family(fonts.mono)}" fo:font-size="${pt(sizes.code)}"`),
    // El estilo con el que LibreOffice pinta los enlaces: sin esto, el color de enlace del tema no se vería.
    `<style:style style:name="Internet_20_link" style:display-name="Internet link" style:family="text"><style:text-properties fo:color="${colors.accent}" style:text-underline-style="solid" style:text-underline-width="auto"/></style:style>`,
  ].join('');
  const paper = PAPER[style.page.paper];
  const { margins } = style.page;
  const page = `<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="${cm(paper.width)}" fo:page-height="${cm(paper.height)}" style:print-orientation="portrait" fo:margin-top="${cm(margins.top / 10)}" fo:margin-bottom="${cm(margins.bottom / 10)}" fo:margin-left="${cm(margins.left / 10)}" fo:margin-right="${cm(margins.right / 10)}"/></style:page-layout></office:automatic-styles><office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles>`;
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
