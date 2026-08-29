# Capa unificada de assets: plan de implementación

| | |
|---|---|
| **Tarea** | T-6.2 · [RELEASE] Capa unificada de assets, *bundle* y `npm run package` (Hito 6) |
| **Estado** | PLAN (2026-08-29), pendiente de aprobación del Director de Ingeniería. |
| **Autor** | Claude (Director Técnico) |
| **Base** | `docs/packaging-and-release.md` (T-6.1 aprobada: Node SEA + esbuild, Typst fuera del binario, lanzamiento incremental sobre una plataforma de referencia), *spike* SEA con Node 26, `docs/acceptance-testing.md` (arneses que servirán de criterio de aceptación). |

## 1. Objetivo

Que el código acceda a sus assets —temas distribuidos, fuentes, plantilla Markdown, dataset de ejemplo, *prompts*, `package.json` y el *worker* de PDF— por **una sola puerta** que en desarrollo lee el repositorio y en el ejecutable lee el propio binario (`node:sea`), sin que ningún comando sepa cuál de las dos está detrás. Criterio de aceptación: el **arnés determinista completo** (77 pasos) produce artefactos **idénticos** con `dist/index.js` y con el ejecutable empaquetado en la plataforma de referencia (linux-x64, esta máquina).

## 2. Diseño

### 2.1 Contrato (`src/shared/assets.ts`)

```ts
export interface AssetStore {
  readonly kind: 'disk' | 'sea';
  /** Contenido de un asset por su clave (`themes/default/theme.toml`). */
  text(key: string): Promise<string>;
  bytes(key: string): Promise<Uint8Array>;
  /** Claves bajo un prefijo, ordenadas (`templates/dataset/` → todos sus ficheros). */
  keys(prefix: string): Promise<readonly string[]>;
  /** Directorio real, legible por procesos externos y por el FileSystem inyectable, con todo lo que hay bajo `prefix`. */
  directory(prefix: string): Promise<string>;
}
```

Las claves son rutas relativas a la raíz del repositorio, así los assets no cambian de nombre al empaquetarse. Dos implementaciones:

- **`DiskAssets(root)`** (desarrollo, `dist/` y las pruebas): lee del árbol del repositorio; `directory(prefix)` devuelve `root/prefix` sin copiar nada. Es exactamente el comportamiento de hoy.
- **`SeaAssets()`** (el ejecutable, `sea.isSea()`): lee de `node:sea` (`getAsset`/`getAssetKeys`) y **materializa bajo demanda** en la caché de usuario lo que necesite existir como ficheros reales (§2.2). Un `MemoryAssets(map)` para las pruebas sale gratis del mismo contrato.

`defaultAssets()` elige la implementación según `sea.isSea()`; `createNodeContext()` la inyecta en el `CliContext` como `assets`, y ningún módulo la instancia por su cuenta.

### 2.2 Materialización con integridad (solo en el ejecutable)

Typst necesita directorios reales (`--root` con `template.typ`, `--font-path`), y el usuario necesita rutas reales (`cv theme path`, `cv theme create --from default`). Por eso `SeaAssets.directory(prefix)` copia los assets del prefijo a `<caché>/chameleon-cv/assets/<versión>/<prefix>/` —la misma `cacheDirectory` que ya usa Typst (`XDG_CACHE_HOME`, `~/Library/Caches`, `%LOCALAPPDATA%`)— la primera vez, y en cada uso **comprueba el SHA-256 de cada fichero** contra un manifiesto embebido en el *bundle* (`assets-manifest.json`, generado al empaquetar). Escritura atómica (temporal + `rename`), directorios 0700 y ficheros 0644 (no son datos personales); un fichero alterado o ausente se reescribe; una caché no escribible es un error claro (código 2), como con Typst. El coste es despreciable: 1,3 MB, ~20 ficheros, un hash de unos milisegundos.

### 2.3 Los ocho acoplamientos, uno a uno

| Acoplamiento (hoy) | Después | Cambio de código |
|---|---|---|
| `packageVersion()` lee `package.json` por `__dirname` (**en el arranque de toda orden**) | `assets.text('package.json')` → `readVersion` (ya puro) | `createProgram` recibe la versión del contexto; `readVersion` no cambia |
| `loadBaseTemplate()` lee `templates/cv.md.hbs` | `assets.text('templates/cv.md.hbs')` en la CLI; `renderMarkdownCv` ya acepta `template` como texto | `generate-cv` pasa siempre la plantilla (base o `-t`) |
| pdfkit registra las fuentes por ruta (`DEFAULT_FONTS`) | `registerFont(name, Buffer)`: pdfkit acepta *buffers*; la CLI pasa `fonts: { regular, bold, italic }` como bytes | `renderPdfCv` gana la opción `fonts` (bytes); `DEFAULT_FONTS` queda como valor por defecto en disco |
| Typst `--font-path templates/fonts` | `await assets.directory('templates/fonts')` | `renderWithTypst` pasa `fontsDirectory` (opción que ya existe) |
| Temas distribuidos: `BUILTIN_THEMES_DIRECTORY` por `__dirname` | `builtinThemeRoot({ directory: await assets.directory('themes') })` | `themeRoots(cwd, fs, builtin)` ya admite la raíz; la CLI la construye desde `assets` |
| `cv init` copia `templates/dataset` por `__dirname` (lee vía `FileSystem`) | valor por defecto de `--template` = `await assets.directory('templates/dataset')` | solo cambia de dónde sale el valor por defecto |
| `loadPrompt(version, directory)` lee `prompts/` | `loadPrompt(version, await assets.directory('prompts'))` o `assets.text` | los tres comandos de IA pasan el directorio del contexto |
| Worker de PDF: `new Worker(ruta a worker.mjs)` | `workerSource()`: en disco, la ruta; en SEA, el código del *bundle* del worker (`assets.text('worker.js')`) con `new Worker(código, { eval: true, workerData, resourceLimits })` — mismos límites (T-2.5) | `createWorkerRunner` acepta `{ path } \| { code }` |

Ningún cambio en parsers, selector, *scoring*, verificador, cargador de temas ni renderizadores más allá de recibir bytes o rutas por parámetro. Las constantes actuales (`FONTS_DIRECTORY`, `BUILTIN_THEMES_DIRECTORY`, `PROMPTS_DIRECTORY`, `TEMPLATE_DATASET_DIR`…) se mantienen como **valores por defecto en disco**: la biblioteca y las pruebas unitarias siguen funcionando sin contexto.

### 2.4 Empaquetado (`npm run package`, `scripts/package.ts`)

1. `npm run build` (tsc) y comprobación de que `dist/` está al día.
2. esbuild: `dist/index.js` → `build/sea/cv.cjs` (CommonJS, `--platform=node --target=node26`, `@napi-rs/canvas` externo, `define` de la versión) y `src/pdf/worker.mts` → `build/sea/worker.js` (IIFE autocontenido con pdf.js).
3. Inventario de assets → `assets-manifest.json` (clave, bytes, SHA-256) y `sea-config.json` (`main`, `output`, `useCodeCache: true`, `assets` con todas las claves, incluidos el manifiesto, `package.json` y `worker.js`).
4. `node --build-sea=sea-config.json` sobre el Node oficial de la máquina (`process.execPath`); en macOS, `codesign --sign -`; `chmod +x`.
5. **Prueba de humo del binario** en un temporal: `cv --version`, `cv init`, `cv build`, `cv generate-cv` (Markdown y pdfkit), `cv analyze-offer` con PDF, `cv theme list`, `cv improve --show-prompt`; con Typst disponible, también `--engine typst`.
6. Archivo `chameleon-cv-<versión>-<os>-<arch>.tar.gz` (Linux/macOS) o `.zip` (Windows) con `cv`, `LICENSE`, `README.md` y la licencia OFL de las fuentes, con *mtime* fijo para que el hash del archivo sea reproducible.

Versión de Node de construcción fijada en `.node-version` (26.x). `esbuild` entra como dependencia de desarrollo (la única nueva).

### 2.5 Criterio de aceptación: los arneses contra el ejecutable

El arnés determinista gana la opción `--binary <ruta>`: los mismos escenarios, los mismos artefactos esperados, ejecutados con el binario empaquetado en lugar de `node dist/index.js`. Las únicas salidas que dependen de dónde viven los assets (`theme list`, `theme path default`) se normalizan con un marcador común (`<BUILTIN>`) tanto para el repositorio como para la caché materializada, de modo que **los 77 pasos deben coincidir byte a byte** con ambos ejecutables. El arnés de IA también admite `--binary` (mismas 16 comprobaciones). Nada de esto añade artefactos esperados: si el binario hace algo distinto, el arnés lo dice.

## 3. Secuencia de trabajo (cada paso deja la suite y el arnés determinista en verde)

| Paso | Contenido | Verificación |
|---|---|---|
| S1 | `src/shared/assets.ts`: contrato, `DiskAssets`, `MemoryAssets`, `SeaAssets` (lectura + materialización + manifiesto) y `defaultAssets()`. | Unitarias al 100 % con `MemoryAssets` y un doble de `node:sea`; materialización probada en un temporal (hash correcto, fichero alterado reescrito, caché no escribible = error). |
| S2 | `CliContext.assets`; versión, plantilla Markdown, prompts, dataset de `init`, temas y fuentes de Typst por la capa. | Suite unitaria; arnés determinista idéntico con `dist/index.js`. |
| S3 | pdfkit con fuentes en memoria; worker por `{ path } \| { code }`. | Golden de pdfkit intacto; extracción de PDF con worker por código probada. |
| S4 | `scripts/package.ts` y `npm run package` (linux-x64, plataforma de referencia); *bundle* del worker; manifiesto; `--build-sea`; prueba de humo. | Binario generado y humo en verde en esta máquina. |
| S5 | `--binary` en los dos arneses y marcador `<BUILTIN>`. | **Arnés determinista 77/77 idéntico con el binario**; arnés de IA 16/16 con el binario y el modelo local. |
| S6 | Documentación: `packaging-and-release.md` §5 pasa de propuesta a hecho; README «Instalación» con el binario; `acceptance-testing.md` con `--binary`. | — |

Estimación: S1–S3 son el grueso (código de producto con cobertura al 100 %); S4–S5 son tooling y verificación. Todo queda en un único flujo de trabajo y sin cambio de comportamiento para quien ejecuta desde el repositorio.

## 4. Riesgos y cómo se acotan

- **pdf.js en un solo fichero para el worker**: el *bundle* IIFE debe conservar lo que pdf.js espera del entorno; S3 lo prueba con la extracción real de las ofertas en PDF del banco antes de tocar el empaquetado.
- **`useCodeCache` y `eval` del worker**: el código del worker se evalúa fuera de la caché de código; es la ruta documentada por Node para `worker_threads` en SEA. Si diera problemas, el respaldo es materializar `worker.js` en la caché y cargarlo por ruta, con el mismo mecanismo de integridad.
- **`theme path` en el ejecutable** imprime la ruta materializada en la caché (es donde de verdad están los ficheros); en el repositorio sigue imprimiendo `themes/<nombre>`. Es lo que el usuario necesita en cada caso y el arnés lo normaliza.
- **Caché no escribible** (sistemas de solo lectura): las órdenes que no necesitan ficheros reales (Markdown, pdfkit, análisis, IA) funcionan igualmente porque leen los assets del binario; solo Typst, `theme path/create` e `init` requieren la caché, y lo dicen.

## 5. Decisiones que se piden

1. **Materialización en la caché de usuario con manifiesto de hashes** (recomendado) frente a extraer los assets junto al ejecutable.
2. **Worker de PDF por `eval`** del código embebido (recomendado; respaldo por ruta materializada si hiciera falta).
3. **Plataforma de referencia**: linux-x64 en esta máquina para S4–S5; el resto de plataformas y GitHub Actions, en T-6.3.
4. **`cv --version`** conserva su salida actual (solo la versión), para no tocar artefactos esperados; la plataforma y la versión de Node se mostrarán en `cv typst status`/`llm status` o en una futura `cv --version --verbose` si lo considera útil.
