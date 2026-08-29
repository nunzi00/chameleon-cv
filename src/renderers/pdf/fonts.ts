import { join, resolve } from 'node:path';

import type { AssetStore } from '../../shared/assets';

/** Fuentes OFL embebidas en el repositorio (`templates/fonts/`, licencia junto a ellas). */
export const FONTS_DIRECTORY = resolve(__dirname, '..', '..', '..', 'templates', 'fonts');

/** Cada cara: ruta de un fichero TTF o sus bytes (en el ejecutable autónomo salen de la capa de assets). */
export type FontSource = string | Uint8Array;

export interface FontFiles {
  readonly regular: FontSource;
  readonly bold: FontSource;
  readonly italic: FontSource;
}

export const FONT_ASSET_KEYS = { regular: 'templates/fonts/SourceSans3-Regular.ttf', bold: 'templates/fonts/SourceSans3-Semibold.ttf', italic: 'templates/fonts/SourceSans3-It.ttf' } as const;

/** Las tres caras leídas por la capa de assets (bytes), listas para pdfkit. */
export async function loadFonts(assets: Pick<AssetStore, 'bytes'>): Promise<FontFiles> {
  return { regular: await assets.bytes(FONT_ASSET_KEYS.regular), bold: await assets.bytes(FONT_ASSET_KEYS.bold), italic: await assets.bytes(FONT_ASSET_KEYS.italic) };
}

export const DEFAULT_FONTS: FontFiles = {
  regular: join(FONTS_DIRECTORY, 'SourceSans3-Regular.ttf'),
  bold: join(FONTS_DIRECTORY, 'SourceSans3-Semibold.ttf'),
  italic: join(FONTS_DIRECTORY, 'SourceSans3-It.ttf'),
};
