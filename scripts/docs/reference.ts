/**
 * Referencia de comandos generada desde la propia CLI (T-7.1, docs/docs-portal.md §4.2): la ayuda de
 * commander es la única fuente de verdad. Escribe en website/src/reference/ (no versionado) una página
 * por comando —la ayuda tal cual, más los ejemplos manuales de website/examples/<comando>.md—, la
 * portada con la tabla de comandos y la barra lateral para VitePress.
 *
 *   npm run docs:generate
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import type { Command } from 'commander';

import { createNodeContext, createProgram } from '../../src/cli';

const ROOT = resolve(__dirname, '..', '..');
const OUT = join(ROOT, 'website', 'src', 'reference');
const EXAMPLES = join(ROOT, 'website', 'examples');
const SIDEBAR = join(ROOT, 'website', '.vitepress', 'reference-sidebar.json');
/** Ancho fijo: la ayuda no debe depender de la terminal donde se genere. */
const HELP_WIDTH = 100;

interface Entry {
  readonly path: readonly string[];
  readonly slug: string;
  readonly description: string;
  readonly help: string;
  readonly children: readonly Entry[];
}

interface SidebarItem {
  readonly text: string;
  readonly link: string;
  readonly items?: SidebarItem[];
  readonly collapsed?: boolean;
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function walk(command: Command, path: readonly string[]): Entry {
  command.configureHelp({ helpWidth: HELP_WIDTH });
  const children = command.commands.filter((sub) => sub.name() !== 'help').map((sub) => walk(sub, [...path, sub.name()]));
  return { path, slug: path.join('-'), description: command.description(), help: command.helpInformation().trimEnd(), children };
}

function flatten(entry: Entry): Entry[] {
  return [entry, ...entry.children.flatMap(flatten)];
}

function page(entry: Entry): string {
  const name = ['cv', ...entry.path].join(' ');
  const examples = join(EXAMPLES, `${entry.slug}.md`);
  const lines = [
    '---',
    `title: ${name}`,
    '---',
    `# \`${name}\``,
    '',
    escapeHtml(entry.description),
    '',
    '```text',
    entry.help,
    '```',
    '',
  ];
  if (entry.children.length > 0) {
    lines.push('## Subcomandos', '');
    for (const child of entry.children) {
      lines.push(`- [\`cv ${child.path.join(' ')}\`](./${child.slug}): ${escapeHtml(child.description)}`);
    }
    lines.push('');
  }
  if (existsSync(examples)) {
    lines.push(readFileSync(examples, 'utf8').trim(), '');
  }
  lines.push('::: info Generado desde la CLI', `Esta página se genera en cada build a partir de \`${name} --help\`; la ayuda de la CLI es la única fuente de verdad y no se edita a mano.`, ':::', '');
  return lines.join('\n');
}

function sidebar(entry: Entry): SidebarItem {
  const item: SidebarItem = { text: `cv ${entry.path.join(' ')}`, link: `/reference/${entry.slug}` };
  return entry.children.length === 0 ? item : { ...item, collapsed: false, items: entry.children.map(sidebar) };
}

function main(): void {
  const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  const program = createProgram(createNodeContext({ interactive: false }), () => undefined, version);
  const root = walk(program, []);
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const commands = flatten(root).slice(1);
  for (const entry of commands) {
    writeFileSync(join(OUT, `${entry.slug}.md`), page(entry));
  }
  const index = [
    '---',
    'title: Referencia de comandos',
    '---',
    '# Referencia de comandos',
    '',
    `Todas las órdenes de \`cv\` ${version}, con sus opciones y ejemplos. Cada página reproduce la ayuda de la propia CLI (\`cv <comando> --help\`), generada en cada build: no puede desviarse del programa.`,
    '',
    'Códigos de salida: `0` correcto · `1` datos inválidos (fuentes, artefacto o especialidad desconocida) · `2` uso incorrecto o fallo del entorno (permisos, disco, plantilla ilegible, binario o servicio ausente).',
    '',
    '| Comando | Qué hace |',
    '|---|---|',
    ...commands.map((entry) => `| [\`cv ${entry.path.join(' ')}\`](./${entry.slug}) | ${escapeHtml(entry.description).replace(/\|/g, '\\|')} |`),
    '',
    '```text',
    root.help,
    '```',
    '',
  ];
  writeFileSync(join(OUT, 'index.md'), index.join('\n'));
  mkdirSync(join(ROOT, 'website', '.vitepress'), { recursive: true });
  const items: SidebarItem[] = [{ text: 'cv (portada)', link: '/reference/' }, ...root.children.map(sidebar)];
  writeFileSync(SIDEBAR, `${JSON.stringify([{ text: 'Referencia de comandos', items }], null, 2)}\n`);
  const missing = commands.filter((entry) => entry.children.length === 0 && !existsSync(join(EXAMPLES, `${entry.slug}.md`))).map((entry) => entry.slug);
  process.stdout.write(`Referencia: ${commands.length} comandos en ${OUT}${missing.length === 0 ? '' : `\n  sin ejemplos (website/examples/<comando>.md): ${missing.join(', ')}`}\n`);
  if (missing.length > 0) {
    process.exit(1);
  }
}

main();
