import { join, resolve } from 'node:path';

/** Fuentes OFL embebidas en el repositorio (`templates/fonts/`, licencia junto a ellas). */
export const FONTS_DIRECTORY = resolve(__dirname, '..', '..', '..', 'templates', 'fonts');

export interface FontFiles {
  readonly regular: string;
  readonly bold: string;
  readonly italic: string;
}

export const DEFAULT_FONTS: FontFiles = {
  regular: join(FONTS_DIRECTORY, 'SourceSans3-Regular.ttf'),
  bold: join(FONTS_DIRECTORY, 'SourceSans3-Semibold.ttf'),
  italic: join(FONTS_DIRECTORY, 'SourceSans3-It.ttf'),
};
