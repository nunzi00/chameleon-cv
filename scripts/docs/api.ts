/**
 * Referencia generada de la API HTTP de `cv serve` (T-7.4b, canon C15): sale del registro de rutas de
 * `createRouter()` y de los esquemas zod de cada cuerpo, así que no puede desviarse del servidor. Escribe
 * website/src/reference/api.md y añade su entrada al sidebar de la referencia (tras reference.ts).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { z, type ZodType } from 'zod';

import { ERROR_STATUS } from '../../src/serve/http';
import { API_PREFIX, createRouter } from '../../src/serve/routes';

const ROOT = resolve(__dirname, '..', '..');
const OUT = join(ROOT, 'website', 'src', 'reference', 'api.md');
const SIDEBAR = join(ROOT, 'website', '.vitepress', 'reference-sidebar.json');

interface JsonSchema {
  readonly type?: string | readonly string[];
  readonly properties?: Readonly<Record<string, JsonSchema>>;
  readonly required?: readonly string[];
  readonly items?: JsonSchema;
  readonly enum?: readonly unknown[];
  readonly anyOf?: readonly JsonSchema[];
  readonly oneOf?: readonly JsonSchema[];
  readonly minimum?: number;
  readonly maximum?: number;
  readonly minLength?: number;
  readonly minItems?: number;
  readonly pattern?: string;
}

interface SidebarItem {
  readonly text: string;
  readonly link?: string;
  readonly items?: SidebarItem[];
}

const ERROR_MEANING: Readonly<Record<string, string>> = {
  usage: 'petición mal formada (opciones incompatibles o valores fuera de rango)',
  'bad-request': 'cuerpo que no es JSON o no cumple el esquema (`details` enumera los campos)',
  'unsafe-path': 'identificador de fichero o de revisión no admitido (solo relativos, sin `..`)',
  unauthorized: 'falta el token de sesión o no coincide',
  'forbidden-host': 'cabecera `Host` ajena (protección contra DNS rebinding)',
  'forbidden-origin': 'cabecera `Origin` ajena en una escritura',
  'remote-disabled': 'el trabajo pide un proveedor remoto y el servidor no arrancó con `--allow-remote`',
  'not-found': 'ruta, fichero, trabajo o revisión inexistente',
  'method-not-allowed': 'método no admitido en esa ruta (`Allow` enumera los válidos)',
  conflict: 'la huella de `If-Match` no coincide (alguien cambió el fichero) o ya existe',
  'consent-required': 'proveedor remoto: repite la petición con `consent.estimateId` tras revisar la estimación',
  'payload-too-large': 'cuerpo por encima del límite (1 MiB JSON, 10 MiB PDF)',
  'invalid-data': 'las fuentes, el artefacto, la selección o la revisión no son válidos (`lines` detalla)',
  'precondition-required': 'falta `If-Match` en una escritura editable',
  environment: 'fallo del entorno: proveedor que no responde, disco, permisos o error inesperado',
};

function escape(text: string): string {
  return text.replace(/\|/g, '\\|');
}

function typeOf(schema: JsonSchema): string {
  if (schema.enum !== undefined) {
    return schema.enum.map((value) => `\`${JSON.stringify(value)}\``).join(' · ');
  }
  const variants = schema.anyOf ?? schema.oneOf;
  if (variants !== undefined) {
    return variants.map(typeOf).join(' o ');
  }
  if (schema.type === 'array') {
    return `lista de ${schema.items === undefined ? 'valores' : typeOf(schema.items).replace(' (no vacío)', '')}${schema.minItems === undefined ? '' : ' (no vacía)'}`;
  }
  if (schema.type === 'object' && schema.properties !== undefined) {
    return `\`{ ${Object.keys(schema.properties)
      .map((key) => `${key}${schema.required?.includes(key) === true ? '' : '?'}`)
      .join(', ')} }\``;
  }
  const base = Array.isArray(schema.type) ? schema.type.join(' o ') : String(schema.type ?? 'valor');
  const limits = [
    schema.minimum === undefined || schema.minimum === Number.MIN_SAFE_INTEGER ? '' : `≥ ${schema.minimum}`,
    schema.maximum === undefined || schema.maximum === Number.MAX_SAFE_INTEGER ? '' : `≤ ${schema.maximum}`,
    schema.minLength === undefined ? '' : 'no vacío',
    schema.pattern === undefined ? '' : `patrón \`${schema.pattern}\``,
  ].filter((limit) => limit !== '');
  return limits.length === 0 ? base : `${base} (${limits.join(', ')})`;
}

function bodyLines(schema: ZodType): string[] {
  const json = z.toJSONSchema(schema) as JsonSchema;
  const properties = json.properties ?? {};
  const names = Object.keys(properties);
  if (names.length === 0) {
    return ['Cuerpo: un objeto JSON vacío (`{}`).', ''];
  }
  return [
    '| Campo | Tipo | Obligatorio |',
    '|---|---|---|',
    ...names.map((name) => `| \`${name}\` | ${escape(typeOf(properties[name] ?? {}))} | ${json.required?.includes(name) === true ? 'sí' : 'no'} |`),
    '',
  ];
}

function main(): void {
  const version = (JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { version: string }).version;
  const specs = createRouter().specs();
  const lines = [
    '---',
    'title: API HTTP (cv serve)',
    '---',
    '# API HTTP de `cv serve`',
    '',
    `El contrato \`${API_PREFIX}\` de Chameleon CV ${version}: ${specs.length} rutas sobre el espacio de trabajo, generadas desde el registro del servidor y los esquemas de cada cuerpo. Para ponerlo en marcha y recorrerlo con \`curl\`, la guía [La API local](/guide/api); para el porqué de cada decisión, la [nota de diseño](/design/api-headless).`,
    '',
    '## Reglas comunes',
    '',
    '- Solo escucha en `127.0.0.1` (o en la dirección de `--host`); toda petición exige `Authorization: Bearer <token>`, el token de sesión que `cv serve` imprime al arrancar. Las cabeceras `Host` y `Origin` se comprueban; no hay CORS.',
    '- JSON UTF-8 en peticiones y respuestas (`Content-Type: application/json`), salvo `POST /offers/extract` (`application/pdf`), `GET /output/{name}` (el fichero) y `GET /jobs/{id}/events` (`text/event-stream`).',
    '- Los ficheros se nombran con identificadores relativos al espacio de trabajo (`experience/acme.md`, `cv.md`, `revision-improve-2026-08-29.md`), nunca con rutas del sistema.',
    '- Lo editable lleva huella: `ETag` en la lectura e `If-Match` obligatorio en la escritura (`*` para crear).',
    '- Errores siempre con la forma `{ "error": { "code", "message", "lines"?, … } }`:',
    '',
    '| Código | Estado | Significado |',
    '|---|---|---|',
    ...Object.entries(ERROR_STATUS).map(([code, status]) => `| \`${code}\` | ${status} | ${ERROR_MEANING[code] ?? ''} |`),
    '',
    '## Rutas',
    '',
    '| Método y ruta | Qué hace |',
    '|---|---|',
    ...specs.map((spec) => `| [\`${spec.method} ${spec.path.slice(API_PREFIX.length)}\`](#${anchor(spec.method, spec.path)}) ${spec.writes ? '✎' : ''} | ${escape(spec.summary)} |`),
    '',
    '✎ = escribe en el espacio de trabajo (exige `Origin` propio o ausente).',
    '',
  ];
  for (const spec of specs) {
    lines.push(`### ${spec.method} ${spec.path.slice(API_PREFIX.length)} {#${anchor(spec.method, spec.path)}}`, '', spec.summary, '');
    if (spec.body !== undefined) {
      lines.push(...bodyLines(spec.body));
    } else if (spec.accepts !== undefined) {
      lines.push(`Cuerpo: \`${spec.accepts}\`.`, '');
    }
    if (spec.path.endsWith('/events')) {
      lines.push('Formato: un evento por bloque, `event: status` con el trabajo completo (`data` es el mismo JSON que `GET /jobs/{id}`) al conectar y en cada cambio de estado, y `event: line` con `{ "line": "…" }` por cada línea de progreso; el flujo se cierra cuando el trabajo termina (`done`, `failed` o `cancelled`).', '');
    }
  }
  lines.push('::: info Generado desde el servidor', 'Esta página se genera en cada build a partir del registro de rutas de `cv serve` y de los esquemas de validación de cada cuerpo; el servidor es la única fuente de verdad y no se edita a mano.', ':::', '');
  writeFileSync(OUT, lines.join('\n'));
  const sidebar = JSON.parse(readFileSync(SIDEBAR, 'utf8')) as SidebarItem[];
  const group = sidebar[0];
  if (group?.items !== undefined && !group.items.some((item) => item.link === '/reference/api')) {
    group.items.push({ text: 'API HTTP (cv serve)', link: '/reference/api' });
    writeFileSync(SIDEBAR, `${JSON.stringify(sidebar, null, 2)}\n`);
  }
  process.stdout.write(`API: ${specs.length} rutas en ${OUT}\n`);
}

function anchor(method: string, path: string): string {
  return `${method}-${path.slice(API_PREFIX.length)}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

main();
