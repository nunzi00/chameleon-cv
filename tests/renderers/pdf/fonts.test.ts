import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { selectForSpecialty } from '../../../src/core/selection';
import { DEFAULT_FONTS, FONT_ASSET_KEYS, loadFonts, renderPdfCv } from '../../../src/renderers/pdf';
import { DiskAssets, MemoryAssets } from '../../../src/shared/assets';
import { selectionProfile } from '../../fixtures/selection';

function backend() {
  const selection = selectForSpecialty(selectionProfile(), 'backend');
  if (!selection.ok) throw new Error('selección');
  return selection.selection.profile;
}

describe('fuentes de pdfkit por la capa de assets (T-6.2)', () => {
  it('loadFonts devuelve los bytes de las tres caras y el PDF es idéntico al generado con rutas', async () => {
    const fonts = await loadFonts(new DiskAssets());
    // Comparación por bytes (toEqual sobre 400 KB es lentísimo).
    expect(Buffer.from(fonts.regular).equals(readFileSync(DEFAULT_FONTS.regular as string))).toBe(true);
    expect(Buffer.from(fonts.bold).equals(readFileSync(DEFAULT_FONTS.bold as string))).toBe(true);
    expect(Buffer.from(fonts.italic).equals(readFileSync(DEFAULT_FONTS.italic as string))).toBe(true);
    const byPath = await renderPdfCv(backend(), {});
    const byBytes = await renderPdfCv(backend(), { fonts });
    expect(byBytes.equals(byPath)).toBe(true);
    await expect(loadFonts(new MemoryAssets({ [FONT_ASSET_KEYS.regular]: 'x' }))).rejects.toMatchObject({ code: 'missing' });
  });
});
