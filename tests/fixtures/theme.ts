import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BUILTIN_THEMES_DIRECTORY, parseThemeConfig, type ThemeConfig } from '../../src/themes';

/** Texto del theme.toml distribuido. */
export function defaultThemeToml(): string {
  return readFileSync(join(BUILTIN_THEMES_DIRECTORY, 'default', 'theme.toml'), 'utf8');
}

export function defaultThemeConfig(): ThemeConfig {
  const parsed = parseThemeConfig(defaultThemeToml());
  if (!parsed.ok) {
    throw new Error(parsed.errors.join('; '));
  }
  return parsed.config;
}

/** Un theme.toml mínimo y válido para un tema propio (los tests sustituyen valores con `replace`). */
export function themeToml(name: string): string {
  return [
    '[theme]',
    `name = "${name}"`,
    'version = 1',
    '[colors]',
    'text = "#111111"',
    'primary = "#222222"',
    'secondary = "#333333"',
    'accent = "#444444"',
    'rule = "#555555"',
    '[fonts]',
    'body = "Source Sans 3"',
    'heading = "Source Sans 3"',
    'mono = "DejaVu Sans Mono"',
    '[sizes]',
    'name = 20',
    'headline = 11',
    'contact = 9',
    'section = 9',
    'title = 10.5',
    'meta = 9',
    'body = 10',
    'footer = 8',
    'code = 9',
    '[spacing]',
    'leading = 0.5',
    'paragraph = 0.7',
    'list = 0.4',
    '[page]',
    'paper = "us-letter"',
    '[page.margins]',
    'top = 20',
    'right = 20',
    'bottom = 20',
    'left = 20',
    '',
  ].join('\n');
}
