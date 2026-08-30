/**
 * La galería de temas es documentación verificable (C15, docs/theme-gallery.md §4.4): las fichas publicadas salen
 * de los theme.toml y cada tema distribuido tiene su imagen versionada. Sin Typst: solo lee ficheros.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { GALLERY_IMAGES, GALLERY_PAGE, galleryCards, galleryThemes, replaceGallery } from '../../scripts/docs/themes';

const PNG_SIGNATURE = Buffer.from('89504e470d0a1a0a', 'hex');

describe('galería de temas (T-8.3)', () => {
  it('la página contiene exactamente las fichas generadas desde los theme.toml y una imagen PNG por tema', async () => {
    const themes = await galleryThemes();
    expect(themes.map((theme) => theme.name)).toEqual(['default', 'academic', 'awesome', 'classic', 'executive', 'minimal', 'modern']);
    const page = readFileSync(GALLERY_PAGE, 'utf8');
    const cards = galleryCards(themes);
    expect(page).toContain(cards);
    expect(replaceGallery(page, cards)).toBe(page);
    for (const theme of themes) {
      const image = join(GALLERY_IMAGES, `${theme.name}.png`);
      expect(existsSync(image), image).toBe(true);
      expect(readFileSync(image).subarray(0, 8).equals(PNG_SIGNATURE), image).toBe(true);
      expect(cards).toContain(`](/themes/${theme.name}.png)`);
      expect(cards).toContain(`cv theme create mio --from ${theme.name}`);
    }
    expect(cards).toContain('- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)');
    expect(() => replaceGallery('sin marcas', cards)).toThrow(/faltan las marcas de la galería/);
  });
});
