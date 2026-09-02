/**
 * Generar el CV en ODT (T-9.23): el paquete OpenDocument —`mimetype` primero y sin comprimir, manifiesto,
 * estilos con nombre— y el contenido, que es el mismo `StructuredView` que comen Typst y pdfkit. La prueba de
 * que el fichero es válido de verdad la da LibreOffice, cuando está instalado.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../../src/core/schema';
import { selectForSpecialty } from '../../../src/core/selection';
import { ODT_MIMETYPE, renderOdtCv } from '../../../src/renderers/odt';
import { contentXml, escapeXml, manifestXml, metaXml, runXml, stylesXml } from '../../../src/renderers/odt/document';
import { writeZip } from '../../../src/renderers/odt/zip';
import { buildStructuredView } from '../../../src/renderers/structured';
import { readZipEntries } from '../../../src/themes/archive';
import { fullProfileInput } from '../../fixtures/master-profile';
import { selectionProfile } from '../../fixtures/selection';

function backendOdt(): Buffer {
  const selection = selectForSpecialty(selectionProfile(), 'backend');
  if (!selection.ok) {
    throw new Error('selección inválida');
  }
  return renderOdtCv(selection.selection.profile);
}

function entries(odt: Buffer): Map<string, string> {
  return new Map(readZipEntries(odt).flatMap((entry) => (entry.type === 'file' ? [[entry.path, Buffer.from(entry.read(1_000_000)).toString('utf8')] as const] : [])));
}

describe('writeZip: el envase', () => {
  it('guarda cada entrada en su método y las lee de vuelta el mismo lector del producto', () => {
    const zip = writeZip([
      { name: 'tal-cual', content: 'sin comprimir', method: 'store' },
      { name: 'carpeta/comprimida.xml', content: '<a>'.repeat(200) },
    ]);
    const read = new Map(readZipEntries(zip).flatMap((entry) => (entry.type === 'file' ? [[entry.path, Buffer.from(entry.read(1_000_000)).toString('utf8')] as const] : [])));
    expect(read.get('tal-cual')).toBe('sin comprimir');
    expect(read.get('carpeta/comprimida.xml')).toBe('<a>'.repeat(200));
  });

  it('admite bytes además de texto, y es determinista: dos veces lo mismo da los mismos bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const uno = writeZip([{ name: 'b.bin', content: bytes }]);
    const dos = writeZip([{ name: 'b.bin', content: bytes }]);
    expect(uno.equals(dos)).toBe(true);
    const primera = readZipEntries(uno)[0];
    expect(primera?.type === 'file' && Buffer.from(primera.read(1_000_000))).toEqual(Buffer.from(bytes));
  });
});

describe('renderOdtCv: el paquete', () => {
  it('es un ODF reconocible: «mimetype» va primero, sin comprimir y con el tipo exacto', () => {
    const odt = backendOdt();
    // Los primeros bytes de un ODF son el zip y, acto seguido, el nombre y el contenido de `mimetype` en claro.
    // Es lo que mira `file(1)` y media herramienta del mundo para saber qué tiene delante.
    expect(odt.subarray(0, 4).toString('latin1')).toBe('PK');
    expect(odt.subarray(30, 38).toString('latin1')).toBe('mimetype');
    expect(odt.subarray(38, 38 + ODT_MIMETYPE.length).toString('latin1')).toBe(ODT_MIMETYPE);
    expect(readZipEntries(odt).map((entry) => entry.path)[0]).toBe('mimetype');
  });

  it('lleva las cuatro partes que el manifiesto declara, y ninguna más', () => {
    const found = entries(backendOdt());
    expect([...found.keys()]).toEqual(['mimetype', 'META-INF/manifest.xml', 'meta.xml', 'styles.xml', 'content.xml']);
    const manifest = manifestXml();
    for (const part of ['content.xml', 'styles.xml', 'meta.xml']) {
      expect(manifest).toContain(`manifest:full-path="${part}"`);
    }
  });

  it('es reproducible byte a byte: el mismo perfil, el mismo fichero', () => {
    expect(backendOdt().equals(backendOdt())).toBe(true);
  });
});

describe('el documento: el CV entero, con estilos que se pueden tocar', () => {
  const view = buildStructuredView(parseMasterProfile(fullProfileInput()), 'es-ES');

  it('abre con el nombre, el titular y el contacto, y trae todas las secciones', () => {
    const xml = contentXml(view);
    expect(xml).toContain(`<text:h text:style-name="Title" text:outline-level="0">${view.fullName}</text:h>`);
    for (const label of [view.labels.experience, view.labels.projects, view.labels.skills, view.labels.education, view.labels.certifications, view.labels.languages]) {
      expect(xml).toContain(`<text:h text:style-name="Heading_20_1" text:outline-level="1">${label}</text:h>`);
    }
  });

  it('usa estilos CON NOMBRE, que es lo que permite recomponer el aspecto de golpe', () => {
    // Es la diferencia entre un documento editable y un PDF: tocas «Heading_20_1» y cambian todas las secciones.
    const styles = stylesXml(view);
    for (const name of ['Standard', 'Title', 'Subtitle', 'Meta', 'Heading_20_1', 'Heading_20_2', 'List_20_Paragraph']) {
      expect(styles).toContain(`style:name="${name}"`);
    }
    expect(styles).toContain('fo:page-width="21cm"');
  });

  it('los logros van en lista con su impacto, y las tecnologías en su línea', () => {
    const xml = contentXml(view);
    expect(xml).toContain('<text:list text:style-name="Vinetas">');
    expect(xml).toContain(`${view.labels.technologies}: `);
    const conImpacto = view.experience.flatMap((item) => item.achievements).find((achievement) => achievement.impact !== undefined);
    expect(conImpacto).toBeDefined();
    expect(xml).toContain(`(${conImpacto?.impact as string})`);
  });

  it('el Markdown en línea se convierte en estilos de texto, y los enlaces en enlaces de verdad', () => {
    expect(runXml({ text: 'fuerte', bold: true, italic: false, code: false, link: undefined })).toBe('<text:span text:style-name="Bold">fuerte</text:span>');
    expect(runXml({ text: 'las dos', bold: true, italic: true, code: false, link: undefined })).toContain('style-name="BoldItalic"');
    expect(runXml({ text: 'cv build', bold: false, italic: false, code: true, link: undefined })).toContain('style-name="Mono"');
    expect(runXml({ text: 'GitHub', bold: false, italic: false, code: false, link: 'https://example.org/a?b=1&c=2' })).toBe(
      '<text:a xlink:type="simple" xlink:href="https://example.org/a?b=1&amp;c=2">GitHub</text:a>',
    );
  });

  it('escapa el XML y conserva los espacios seguidos, que ODF colapsaría', () => {
    expect(escapeXml('AT&T <«tag»> "x" \'y\'')).toBe('AT&amp;T &lt;«tag»&gt; &quot;x&quot; &apos;y&apos;');
    const conEspacios = { ...view, fullName: 'Ada   Ejemplo' };
    expect(contentXml(conEspacios)).toContain('Ada <text:s text:c="2"/>Ejemplo');
  });

  it('cursiva sola, viñetas y bloques de código del resumen salen cada uno con su estilo', () => {
    const conMarkdown = parseMasterProfile({
      meta: { schemaVersion: 1, locale: 'es-ES' },
      personal: { fullName: 'Ada Ejemplo', summary: 'Un *matiz* y `cv build`.\n\n- Una viñeta del resumen.\n\n```\ncv build --data x\n```' },
      achievements: [{ id: 'logro-1', text: 'Un logro sin impacto.' }, { id: 'logro-2', text: 'Otro con impacto.', impact: '-30 % de coste' }],
      certifications: [{ id: 'cert-1', name: 'CKA' }],
    });
    const xml = contentXml(buildStructuredView(conMarkdown, 'es-ES'));
    expect(xml).toContain('<text:span text:style-name="Italic">matiz</text:span>');
    expect(xml).toContain('<text:span text:style-name="Mono">cv build</text:span>');
    expect(xml).toContain('<text:p text:style-name="List_20_Paragraph">Una viñeta del resumen.</text:p>');
    expect(xml).toContain('text:style-name="Preformatted_20_Text"');
    // Sin impacto no se inventa un paréntesis vacío, y una certificación sin emisor, fecha ni enlace es solo su nombre.
    expect(xml).toContain('<text:p text:style-name="List_20_Paragraph">Un logro sin impacto.</text:p>');
    expect(xml).toContain('<text:span text:style-name="Bold">CKA</text:span></text:p>');
    expect(xml).toContain('<text:span text:style-name="Italic">(-30 % de coste)</text:span>');
  });

  it('una entrada sin periodo ni ubicación no deja una línea de metadatos vacía', () => {
    const sinMeta = parseMasterProfile({
      meta: { schemaVersion: 1, locale: 'es-ES' },
      personal: { fullName: 'Ada Ejemplo' },
      projects: [{ id: 'proj-uno', name: 'Chameleon' }],
    });
    const xml = contentXml(buildStructuredView(sinMeta, 'es-ES'));
    expect(xml).toContain('Chameleon');
    expect(xml).not.toContain('<text:p text:style-name="Meta"></text:p>');
  });

  it('el idioma sale de la opción, del perfil o del defecto, por ese orden', () => {
    const ingles = parseMasterProfile({ meta: { schemaVersion: 1, locale: 'en-GB' }, personal: { fullName: 'Ada Ejemplo' } });
    expect(stylesXml(buildStructuredView(ingles, 'en-GB'))).toContain('fo:language="en"');
    // La opción manda sobre el perfil…
    expect(entries(renderOdtCv(ingles, { locale: 'es-ES' })).get('styles.xml')).toContain('fo:language="es"');
    // …el perfil sobre nada…
    expect(entries(renderOdtCv(ingles)).get('styles.xml')).toContain('fo:language="en"');
    // …y un perfil sin locale cae al de por defecto, sin quedarse sin idioma.
    const sinLocale = parseMasterProfile({ meta: { schemaVersion: 1 }, personal: { fullName: 'Ada Ejemplo' } });
    expect(entries(renderOdtCv(sinLocale)).get('styles.xml')).toContain('fo:language="es"');
  });

  it('meta.xml no lleva fecha: una fecha haría distinto el mismo documento cada vez', () => {
    const meta = metaXml(view, 'Chameleon CV 9.9.9');
    expect(meta).toContain('<meta:generator>Chameleon CV 9.9.9</meta:generator>');
    expect(meta).toContain(`<dc:title>${view.fullName}</dc:title>`);
    expect(meta).not.toContain('meta:creation-date');
  });

  it('un perfil sin proyectos, logros ni idiomas no deja secciones vacías', () => {
    const minimo = buildStructuredView(parseMasterProfile({ meta: { schemaVersion: 1, locale: 'es-ES' }, personal: { fullName: 'Ada Ejemplo' } }), 'es-ES');
    const xml = contentXml(minimo);
    expect(xml).toContain('Ada Ejemplo');
    for (const label of [minimo.labels.experience, minimo.labels.projects, minimo.labels.skills, minimo.labels.languages]) {
      expect(xml).not.toContain(`>${label}</text:h>`);
    }
  });
});

/** LibreOffice es el juez de que esto es un ODF y no solo un zip con XML dentro. */
function libreOffice(): string | undefined {
  for (const binary of ['soffice', 'libreoffice']) {
    try {
      execFileSync('which', [binary], { stdio: 'pipe' });
      return binary;
    } catch {
      // el siguiente
    }
  }
  return undefined;
}

describe('LibreOffice abre el documento', () => {
  const binary = libreOffice();

  it.skipIf(binary === undefined)('convierte el ODT a texto y sale el CV entero', () => {
    const directory = mkdtempSync(join(tmpdir(), 'cv-odt-'));
    try {
      const odt = join(directory, 'cv.odt');
      writeFileSync(odt, backendOdt());
      execFileSync(binary as string, ['--headless', `-env:UserInstallation=file://${join(directory, 'perfil')}`, '--convert-to', 'txt:Text', '--outdir', directory, odt], { stdio: 'pipe', timeout: 180_000 });
      const text = readFileSync(join(directory, 'cv.txt'), 'utf8');
      expect(text).toContain('Ada Ejemplo');
      expect(text).toContain('Experiencia');
      expect(text).toContain('ACME Corp');
      // Las viñetas de los logros llegan como tales, no como un párrafo corrido.
      expect(text).toContain('•');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  }, 200_000);
});
