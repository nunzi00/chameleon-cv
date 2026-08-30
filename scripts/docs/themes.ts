/**
 * Galería de temas (T-8.3, docs/theme-gallery.md §4.4): compila el CV completo del banco de pruebas con cada tema
 * distribuido y guarda la primera página como PNG en website/src/public/themes/<tema>.png; después reescribe el
 * bloque de fichas de website/src/guide/theme-gallery.md a partir de los theme.toml (una prueba comprueba que la
 * página publicada coincide con lo que generan estos ficheros). Exige Typst (CHAMELEON_TYPST o la caché de
 * `cv typst install`); las imágenes se versionan y el portal no compila nada en línea (C15).
 *
 *   npm run docs:themes
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { defaultSourceParsers } from '../../src/parsers';
import { NodeFileSystem, loadDataset } from '../../src/parsers/dataset';
import { renderTypstPreview } from '../../src/renderers/typst';
import { builtinThemeRoot, listThemes, loadTheme, type LoadedTheme } from '../../src/themes';

const ROOT = resolve(__dirname, '..', '..');
export const GALLERY_PAGE = join(ROOT, 'website', 'src', 'guide', 'theme-gallery.md');
export const GALLERY_IMAGES = join(ROOT, 'website', 'src', 'public', 'themes');
const BENCH_DATA = join(ROOT, 'tests', 'acceptance', 'bench', 'workspace', 'data', 'sources');
/** Resolución de las imágenes: A4 a 96 ppp son 794 × 1123 px, legible en el portal y ligero en el repositorio. */
const PPI = 96;
export const GALLERY_START = '<!-- galería:inicio (bloque generado por npm run docs:themes desde los theme.toml; no editar a mano) -->';
export const GALLERY_END = '<!-- galería:fin -->';

/** Orden de la galería (T-8.12): las organizaciones por nombre y después los estilos, con el tema por defecto primero. */
export async function galleryThemes(): Promise<LoadedTheme[]> {
  const names = await listThemes([builtinThemeRoot()]);
  const themes: LoadedTheme[] = [];
  for (const name of ['default', ...names.filter((name) => name !== 'default')]) {
    const loaded = await loadTheme(name, [builtinThemeRoot()]);
    if (!loaded.ok) {
      throw new Error(loaded.message);
    }
    themes.push(loaded.theme);
  }
  return [...themes.filter((theme) => theme.config.theme.kind === 'organization'), ...themes.filter((theme) => theme.config.theme.kind !== 'organization')];
}

/** Los dos grupos de la galería: qué aporta cada uno, para la cabecera de su bloque. */
export const GALLERY_GROUPS: readonly { readonly kind: 'organization' | 'style'; readonly title: string; readonly intro: string }[] = [
  {
    kind: 'organization',
    title: 'Organizaciones',
    intro: 'Cambian el orden y la agrupación de las secciones: qué se lee primero. Elige una por el tipo de proceso al que te presentas.',
  },
  {
    kind: 'style',
    title: 'Estilos',
    intro: 'Mantienen la organización cronológica inversa (experiencia → proyectos → habilidades → logros → formación → certificaciones → idiomas) y cambian la maquetación.',
  },
];

function card(theme: LoadedTheme): string {
  const meta = theme.config.theme;
  const fonts = theme.config.fonts;
  const credit =
    meta.author === undefined
      ? []
      : [`- **Autoría**: ${meta.author}${meta.license === undefined ? '' : ` · licencia ${meta.license}`}${meta.homepage === undefined ? '' : ` · [página del tema](${meta.homepage})`}`];
  return [
    `### \`${theme.name}\`${theme.name === 'default' ? ' (por defecto)' : ''}`,
    '',
    `![Primera página del CV del banco de pruebas con el tema ${theme.name}](/themes/${theme.name}.png)`,
    '',
    meta.description ?? 'Sin descripción.',
    '',
    `- **Tipografías**: cuerpo ${fonts.body} · títulos ${fonts.heading} · código ${fonts.mono}`,
    `- **Papel**: ${theme.config.page.paper}`,
    ...credit,
    '',
    '```bash',
    `cv generate-cv --format pdf --engine typst --theme ${theme.name}`.padEnd(66) + '# genera con este tema',
    `cv theme create mio --from ${theme.name}`.padEnd(66) + '# parte de él en themes/mio/ de tu proyecto',
    '```',
    '',
  ].join('\n');
}

/** El bloque de fichas, entre las marcas, tal como debe aparecer en la página: un apartado por grupo con sus fichas. */
export function galleryCards(themes: readonly LoadedTheme[]): string {
  const groups = GALLERY_GROUPS.map((group) => {
    const members = themes.filter((theme) => theme.config.theme.kind === group.kind);
    return [`## ${group.title} (${members.length})`, '', group.intro, '', ...members.map(card)].join('\n');
  });
  return [GALLERY_START, '', ...groups, GALLERY_END].join('\n');
}

/** Sustituye el bloque entre las marcas; sin marcas, la página no es la de la galería. */
export function replaceGallery(page: string, cards: string): string {
  const start = page.indexOf(GALLERY_START);
  const end = page.indexOf(GALLERY_END);
  if (start === -1 || end === -1 || end < start) {
    throw new Error(`${GALLERY_PAGE}: faltan las marcas de la galería (${GALLERY_START} … ${GALLERY_END})`);
  }
  return page.slice(0, start) + cards + page.slice(end + GALLERY_END.length);
}

async function main(): Promise<void> {
  const dataset = await loadDataset(BENCH_DATA, { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error(dataset.errors.map((error) => `${error.file}: ${error.message}`).join('\n'));
  }
  mkdirSync(GALLERY_IMAGES, { recursive: true });
  const themes = await galleryThemes();
  for (const theme of themes) {
    // Mismo proceso contenido que `generate-cv --engine typst`, con la primera página como PNG.
    const result = await renderTypstPreview(dataset.profile, { theme, ppi: PPI });
    if (!result.ok) {
      throw new Error(`${theme.name}: ${result.error.message}`);
    }
    const target = join(GALLERY_IMAGES, `${theme.name}.png`);
    writeFileSync(target, result.png);
    console.log(`✓ ${theme.name}: ${relative(ROOT, target)} (${Math.round(result.png.length / 1024)} KB)`);
  }
  writeFileSync(GALLERY_PAGE, replaceGallery(readFileSync(GALLERY_PAGE, 'utf8'), galleryCards(themes)));
  console.log(`✓ fichas de ${themes.length} temas en ${relative(ROOT, GALLERY_PAGE)}`);
}

if (require.main === module) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
