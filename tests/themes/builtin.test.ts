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
import { defaultSourceParsers } from '../../src/parsers';
import { NodeFileSystem, loadDataset } from '../../src/parsers/dataset';
import type { MasterProfile } from '../../src/core/schema';

/** Las seis organizaciones (T-8.12, docs/theme-catalog.md D1), por orden alfabético como las lista la CLI. */
const ORGANIZATIONS: readonly string[] = ['achievements-first', 'ats-plain', 'chronological', 'education-first', 'functional', 'hybrid', 'impact-first', 'one-page', 'project-portfolio', 'sidebar-left', 'skills-first', 'two-column-dense', 'unified-timeline'];
const BENCH_SOURCES = 'tests/acceptance/bench/workspace/data/sources';

/** El perfil del banco de pruebas: cinco puestos con hasta seis logros, tres proyectos y dieciséis skills con nivel y años. */
async function benchProfile(): Promise<MasterProfile> {
  const dataset = await loadDataset(BENCH_SOURCES, { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error(dataset.errors.map((error) => `${error.file}: ${error.message}`).join('\n'));
  }
  return dataset.profile;
}

/** Los temas de la galería (T-8.3) y las organizaciones (T-8.12) declaran autoría; los de T-5.1 no la necesitan. */
const GALLERY_THEMES: readonly string[] = ['modern', 'academic', 'minimal', 'awesome', 'executive', 'tech', 'timeline', ...ORGANIZATIONS, 'bold', 'compact-grid', 'elegant', 'europass-like', 'monochrome', 'warm', 'newspaper', 'pastel', 'swiss', 'gazette', 'midnight', 'mono-grid', 'serif-editorial', 'slate', 'terracotta'];
const HOMEPAGE = 'https://nunzi00.github.io/chameleon-cv/guide/theme-gallery';
const STYLES: readonly string[] = ['academic', 'awesome', 'bold', 'classic', 'compact-grid', 'default', 'elegant', 'europass-like', 'executive', 'gazette', 'midnight', 'minimal', 'modern', 'mono-grid', 'monochrome', 'newspaper', 'pastel', 'serif-editorial', 'slate', 'swiss', 'tech', 'terracotta', 'timeline', 'warm'];

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

async function pdfOf(theme: LoadedTheme, locale: string, profile: MasterProfile = parseMasterProfile(fullProfileInput())): Promise<Buffer> {
  const result = await renderTypstCv(profile, { theme, locale });
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
  it('los veintisiete temas cargan, validan, se describen, declaran su clase y los de la galería llevan autor, licencia y página', async () => {
    const themes = await builtinThemes();
    expect(themes.map((theme) => theme.name)).toEqual([...ORGANIZATIONS, ...STYLES].sort());
    for (const theme of themes) {
      expect(theme.builtin).toBe(true);
      expect(theme.config.theme.name).toBe(theme.name);
      expect(theme.config.theme.description).toMatch(/\S/);
      expect(theme.config.theme.kind, theme.name).toBe(ORGANIZATIONS.includes(theme.name) ? 'organization' : 'style');
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

  it('cada organización ordena las secciones a su manera con el perfil del banco de pruebas, en ambos idiomas', async () => {
    const profile = await benchProfile();
    const themes = await builtinThemes();
    const theme = (name: string): LoadedTheme => themes.find((candidate) => candidate.name === name)!;
    for (const [locale, labels] of [
      ['es-ES', { experience: 'Experiencia', skills: 'Habilidades', projects: 'Proyectos', achievements: 'Logros destacados', level: 'Nivel', years: 'Años', expert: 'Experto' }],
      ['en-US', { experience: 'Experience', skills: 'Skills', projects: 'Projects', achievements: 'Highlights', level: 'Level', years: 'Years', expert: 'Expert' }],
    ] as const) {
      const at = (text: string, label: string): number => {
        const index = text.indexOf(label);
        expect(index, `${locale}: ${label}`).toBeGreaterThan(-1);
        return index;
      };
      // chronological: el periodo precede al puesto y la formación va antes que los proyectos.
      const chronological = (await textOf(await pdfOf(theme('chronological'), locale, profile))).text;
      expect(at(chronological, 'Staff Backend Engineer')).toBeGreaterThan(at(chronological, locale === 'es-ES' ? 'mar 2022' : 'Mar 2022'));
      expect(at(chronological, labels.projects)).toBeGreaterThan(at(chronological, locale === 'es-ES' ? 'Formación' : 'Education'));
      // functional: competencias y logros (con la empresa de origen) antes que la trayectoria.
      const functional = (await textOf(await pdfOf(theme('functional'), locale, profile))).text;
      expect(at(functional, labels.skills)).toBeLessThan(at(functional, labels.achievements));
      expect(at(functional, labels.achievements)).toBeLessThan(at(functional, labels.experience));
      expect(functional).toContain('— Nexo Pagos');
      // hybrid: competencias antes que la experiencia, que conserva sus logros.
      const hybrid = (await textOf(await pdfOf(theme('hybrid'), locale, profile))).text;
      expect(at(hybrid, labels.skills)).toBeLessThan(at(hybrid, labels.experience));
      expect(hybrid).toContain('Kafka y PostgreSQL');
      // skills-first: la matriz con nivel y años precede a la experiencia; el nivel se traduce.
      const skillsFirst = (await textOf(await pdfOf(theme('skills-first'), locale, profile))).text;
      expect(at(skillsFirst, labels.level)).toBeLessThan(at(skillsFirst, labels.experience));
      expect(at(skillsFirst, labels.years)).toBeLessThan(at(skillsFirst, labels.experience));
      expect(skillsFirst).toContain(labels.expert);
      // project-portfolio: los proyectos abren el documento y la experiencia queda en una línea por puesto (sin logros).
      const portfolio = (await textOf(await pdfOf(theme('project-portfolio'), locale, profile))).text;
      expect(at(portfolio, labels.projects)).toBeLessThan(at(portfolio, labels.experience));
      expect(portfolio).toContain('Kafka Guardian');
      expect(portfolio).not.toContain('Kafka y PostgreSQL');
      // one-page: una sola página con las marcas de recorte.
      const onePage = await textOf(await pdfOf(theme('one-page'), locale, profile));
      expect(onePage.pages).toBe(1);
      expect(onePage.text).toMatch(/\(\+\d+\)/);
      expect(onePage.text).not.toContain('(Valencia (remoto))');
      // education-first: formación y certificaciones antes que la experiencia.
      const educationFirst = (await textOf(await pdfOf(theme('education-first'), locale, profile))).text;
      expect(at(educationFirst, locale === 'es-ES' ? 'Formación' : 'Education')).toBeLessThan(at(educationFirst, labels.experience));
      expect(at(educationFirst, locale === 'es-ES' ? 'Certificaciones' : 'Certifications')).toBeLessThan(at(educationFirst, labels.experience));
      // achievements-first: los logros (con la empresa del primero de cada puesto) abren el documento.
      const achievementsFirst = (await textOf(await pdfOf(theme('achievements-first'), locale, profile))).text;
      expect(at(achievementsFirst, labels.achievements)).toBeLessThan(at(achievementsFirst, labels.experience));
      expect(achievementsFirst).toContain('— Nexo Pagos');
      // unified-timeline: un solo eje por fechas ISO: el máster (2014–2015) queda entre Data Engineer (2015) y la etapa freelance (2013).
      const unified = (await textOf(await pdfOf(theme('unified-timeline'), locale, profile))).text;
      expect(at(unified, 'Máster')).toBeGreaterThan(at(unified, 'Data Engineer'));
      expect(at(unified, 'Máster')).toBeLessThan(at(unified, 'Desarrolladora web'));
      expect(at(unified, 'Kafka Guardian')).toBeLessThan(at(unified, 'Staff Backend Engineer'));
    }
  }, 180_000);
});
