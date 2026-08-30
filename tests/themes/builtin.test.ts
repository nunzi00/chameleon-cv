/**
 * Temas distribuidos (T-8.3, docs/theme-gallery.md §4.1 y §5): todo tema de themes/ carga, valida, declara sus
 * metadatos, es autocontenido y —con Typst real— compila el perfil completo en ambos idiomas; «academic» también
 * en US Letter. Las pruebas con binario real siguen el mismo interruptor que el resto: CHAMELEON_TYPST.
 */
import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

import { parseMasterProfile } from '../../src/core/schema';
import { extractPdfText } from '../../src/pdf';
import { renderTypstCv } from '../../src/renderers/typst';
import { applyThemeOverrides, builtinThemeRoot, listThemes, loadTheme, type LoadedTheme } from '../../src/themes';
import { fullProfileInput } from '../fixtures/master-profile';

/** Los temas de la galería (T-8.3) declaran autoría; los de T-5.1 no la necesitan. */
const GALLERY_THEMES: readonly string[] = ['modern', 'academic', 'minimal', 'awesome', 'executive'];
const HOMEPAGE = 'https://nunzi00.github.io/chameleon-cv/guide/theme-gallery';

async function builtinThemes(): Promise<LoadedTheme[]> {
  const themes: LoadedTheme[] = [];
  for (const name of await listThemes([builtinThemeRoot()])) {
    const loaded = await loadTheme(name, [builtinThemeRoot()]);
    if (!loaded.ok) {
      throw new Error(loaded.message);
    }
    themes.push(loaded.theme);
  }
  return themes;
}

async function pdfOf(theme: LoadedTheme, locale: string): Promise<Buffer> {
  const result = await renderTypstCv(parseMasterProfile(fullProfileInput()), { theme, locale });
  if (!result.ok) {
    throw new Error(`${theme.name} (${locale}): ${result.error.message}`);
  }
  return result.pdf;
}

async function textOf(pdf: Buffer): Promise<{ text: string; pages: number }> {
  const extracted = await extractPdfText(pdf);
  if (!extracted.ok) {
    throw new Error(extracted.message);
  }
  return { text: extracted.text, pages: extracted.pages };
}

describe('temas distribuidos (T-8.3): contrato común', () => {
  it('los siete temas cargan, validan, se describen y los de la galería declaran autor, licencia y página', async () => {
    const themes = await builtinThemes();
    expect(themes.map((theme) => theme.name)).toEqual(['academic', 'awesome', 'classic', 'default', 'executive', 'minimal', 'modern']);
    for (const theme of themes) {
      expect(theme.builtin).toBe(true);
      expect(theme.config.theme.name).toBe(theme.name);
      expect(theme.config.theme.description).toMatch(/\S/);
      if (GALLERY_THEMES.includes(theme.name)) {
        expect(theme.config.theme).toMatchObject({ author: 'Chameleon CV', license: 'MIT', homepage: HOMEPAGE });
      }
    }
  });

  it('cada plantilla es autocontenida: define cv(d, theme) y no importa, incluye, lee ficheros ni usa paquetes', async () => {
    for (const theme of await builtinThemes()) {
      const template = await readFile(theme.templatePath, 'utf8');
      // Los comentarios (`// …`) documentan el contrato y pueden citar `#import`; el código, no.
      const code = template.replace(/\/\/.*$/gm, '');
      expect(code, theme.name).toContain('#let cv(d, theme) =');
      expect(code, theme.name).not.toMatch(/#import|#include|\bread\(|@preview|\beval\(/);
    }
  });
});

describe.skipIf(process.env['CHAMELEON_TYPST'] === undefined)('temas distribuidos (T-8.3): compilan con Typst real', () => {
  it('todo tema compila el perfil completo en español y en inglés, con el nombre y las etiquetas del idioma', async () => {
    for (const theme of await builtinThemes()) {
      for (const [locale, label] of [
        ['es-ES', 'Experiencia'],
        ['en-US', 'Experience'],
      ] as const) {
        const { text, pages } = await textOf(await pdfOf(theme, locale));
        expect(pages, `${theme.name} (${locale})`).toBeGreaterThanOrEqual(1);
        expect(text, `${theme.name} (${locale})`).toContain('Ada Ejemplo');
        expect(text.toLowerCase(), `${theme.name} (${locale})`).toContain(label.toLowerCase());
      }
    }
  }, 120_000);

  it('modern titula la columna de contacto, academic numera las secciones y pagina «página X de Y», en cada idioma', async () => {
    const themes = await builtinThemes();
    const modern = themes.find((theme) => theme.name === 'modern')!;
    const academic = themes.find((theme) => theme.name === 'academic')!;
    expect((await textOf(await pdfOf(modern, 'es-ES'))).text).toContain('CONTACTO');
    expect((await textOf(await pdfOf(modern, 'en-US'))).text).toContain('CONTACT');
    const spanish = await textOf(await pdfOf(academic, 'es-ES'));
    expect(spanish.text).toContain('1 Experiencia');
    expect(spanish.text).toContain(`Ada Ejemplo · página 1 de ${spanish.pages}`);
    const english = await textOf(await pdfOf(academic, 'en-US'));
    expect(english.text).toContain(`Ada Ejemplo · page 1 of ${english.pages}`);
  }, 60_000);

  it('academic respeta el papel del tema: A4 por defecto y US Letter cuando cv.toml lo anula', async () => {
    const academic = (await builtinThemes()).find((theme) => theme.name === 'academic')!;
    expect((await pdfOf(academic, 'es-ES')).toString('latin1')).toContain('MediaBox[0 0 595.2756 841.8898]');
    const letter = applyThemeOverrides(academic, { page: { paper: 'us-letter' } });
    expect(letter.config.page.paper).toBe('us-letter');
    expect((await pdfOf(letter, 'es-ES')).toString('latin1')).toContain('MediaBox[0 0 612 792]');
  }, 60_000);
});
