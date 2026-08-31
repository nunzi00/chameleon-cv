/**
 * Guarda de clases de estilo (T-9.2): toda clase `cv-*` que use un componente debe existir, o en la hoja
 * global (`app.css`) o en el `<style>` del propio fichero. Nació de un defecto real: la pantalla de
 * importación usaba `cv-pre`, que no existía, y ni el compilador ni `svelte-check` ni las pruebas lo vieron
 * —solo se notaba mirando la pantalla, porque el bloque no ajustaba y estiraba la tarjeta—.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(process.cwd(), 'src');

function walk(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : path.endsWith('.svelte') ? [path] : [];
  });
}

/** Las clases de una hoja de estilos: `.cv-algo` (ignora las variables `--cv-algo`, que no son clases). */
function classesOf(css: string): Set<string> {
  return new Set([...css.matchAll(/(?<!-)\.(cv-[a-z0-9-]+)/g)].map((match) => match[1]!));
}

/** Las clases que aplica un componente: atributos `class="…"`, `class={…}` y directivas `class:algo`. */
function usedClasses(source: string): Set<string> {
  const markup = source.split('<style>')[0] ?? '';
  const used = new Set<string>();
  for (const [, value] of markup.matchAll(/class=(?:"([^"]*)"|\{([\s\S]*?)\})/g)) {
    for (const [, name] of (value ?? '').matchAll(/\b(cv-[a-z0-9-]+)/g)) {
      used.add(name!);
    }
  }
  for (const [, value] of markup.matchAll(/class=\{([\s\S]*?)\}\s/g)) {
    for (const [, name] of value!.matchAll(/\b(cv-[a-z0-9-]+)/g)) {
      used.add(name!);
    }
  }
  for (const [, name] of markup.matchAll(/\bclass:(cv-[a-z0-9-]+)/g)) {
    used.add(name!);
  }
  return used;
}

describe('clases de estilo', () => {
  const global = classesOf(readFileSync(join(ROOT, 'app.css'), 'utf8'));
  const files = walk(ROOT);

  it('encuentra los componentes y la hoja global', () => {
    expect(files.length).toBeGreaterThan(10);
    expect(global.size).toBeGreaterThan(100);
  });

  it('toda clase cv-* que se aplica está definida en app.css o en el <style> del componente', () => {
    const missing: string[] = [];
    for (const path of files) {
      const source = readFileSync(path, 'utf8');
      const own = classesOf(source.split('<style>')[1] ?? '');
      for (const name of usedClasses(source)) {
        if (!global.has(name) && !own.has(name)) {
          missing.push(`${path.slice(ROOT.length + 1)}: ${name}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
