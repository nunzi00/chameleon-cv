# Empaquetado y release: un binario por plataforma y un flujo automatizado

| | |
|---|---|
| **Tarea** | T-6.1 · [RELEASE] Diseño de empaquetado y release (Hito 6) |
| **Estado** | PROPUESTA v1 aprobada por el Director de Ingeniería el 2026-08-29; T-6.2 implementada (§11). |
| **Autor** | Claude (Director Técnico) |
| **Base** | `docs/typst-integration.md` §3 (contenedor y consentimiento de red), `docs/llm-integration.md` §5 (cadena de suministro), `src/typst/` (instalación verificada de un binario externo), *spike* de empaquetado ejecutado en esta máquina el 2026-08-29 (§4). |

## 0. Resumen ejecutivo

- **Empaquetado**: **Node.js Single Executable Applications (SEA)**, la vía oficial de Node, con el código previamente unido en un solo fichero por **esbuild** y los *assets* embebidos en el propio ejecutable (`node:sea`). Un ejecutable por plataforma, construido en un *runner* de esa plataforma a partir del binario oficial de Node (sin binarios parcheados por terceros). Descartados `pkg` (archivado por Vercel; su bifurcación depende de binarios de Node parcheados), `nexe` (mantenimiento irregular, compila Node), `boxednode` (compila Node: horas), y los *runtimes* alternativos `bun`/`deno` (cambian el motor bajo una herramienta cuya suite y garantías están escritas para Node).
- **Assets**: temas, fuentes, plantilla Markdown, dataset de ejemplo y *prompts* viajan dentro del binario y se leen por una **capa de assets** (disco en desarrollo, `node:sea` en el binario) que encaja en nuestra abstracción `FileSystem`. Lo que necesita existir como fichero real (fuentes para `--font-path`, dataset para `cv init`) se materializa bajo demanda en la caché de usuario, con hash y permisos, como ya hacemos con Typst.
- **Typst no va dentro** (56 MB por plataforma, ya se instala bajo demanda con SHA-256 y consentimiento explícito); opcionalmente, un archivo «completo» con el binario de Typst al lado del ejecutable para entornos sin red.
- **Release**: un *tag* `vX.Y.Z` dispara un flujo de GitHub Actions con tres trabajos —verificar (typecheck, lint, cobertura 100 %, pruebas con Typst real), construir (matriz de cinco plataformas, prueba de humo del binario) y publicar (Release de GitHub con los archivos, `SHA256SUMS.txt` y atestación de procedencia)—. `npm` como segundo canal; Homebrew, después.
- **Medidas del spike** (§4): el `cv` empaquetado arranca en **212 ms** frente a 356 ms de `node dist/index.js`, ocupa 68 MB (con el Node del sistema; ~110–130 MB con el oficial) y **16 MB comprimido en xz**. Todo lo que no toca *assets* funcionó tal cual; lo que falla está inventariado en §2.2 y es exactamente el trabajo de T-6.2.

## 1. Qué hay que empaquetar

- **Runtime**: Node ≥ 22.12 (`require(esm)`); el proyecto es CommonJS compilado en `dist/` (2,5 MB, ~90 ficheros).
- **Dependencias de ejecución** (todas JavaScript puro, **ningún addon nativo**): commander, csv-parse, handlebars, pdfjs-dist, pdfkit, remark-frontmatter, remark-parse, smol-toml, unified, yaml, zod. Dos detalles: varias son ESM (unified/remark) —un *bundler* las resuelve sin `require(esm)`—, y `pdfjs-dist` intenta cargar opcionalmente `@napi-rs/canvas` (addon nativo para *rasterizar*, que no usamos): hay que declararlo externo en el *bundle*.
- **Assets** (1,3 MB en total): `themes/` (default y classic: 28 KB), `templates/fonts/` (Source Sans 3, OFL: 1,2 MB), `templates/cv.md.hbs`, `templates/dataset/` (para `cv init`), `prompts/*.md` (12 KB), `src/typst/releases.json` (ya se importa como módulo: entra en el *bundle*).
- **Un worker**: la extracción de texto de PDF corre en un `worker_threads` con límites de recursos, cargado por ruta (`dist/pdf/worker.mjs`, ESM).
- **Typst** (56 MB por plataforma) es un binario externo con instalación explícita y verificada (`cv typst install`, T-3.3); nunca ha estado en el árbol de la herramienta.

## 2. Acoplamientos con el disco (inventario)

### 2.1 Dónde el código asume que hay ficheros al lado de `dist/`

| Fichero | Qué resuelve por `__dirname` | Consumidor |
|---|---|---|
| `src/cli/version.ts:5` | `package.json` (versión para `cv --version`) | `program.version(readVersion())`, **en el arranque de cualquier orden** |
| `src/renderers/markdown/template.ts:5` | `templates/cv.md.hbs` | `generate-cv` (Markdown) |
| `src/renderers/pdf/fonts.ts:4` | `templates/fonts/` | pdfkit (lee TTF) y Typst (`--font-path`, necesita un **directorio real**) |
| `src/themes/loader.ts:19` | `themes/` (raíz distribuida) | `--theme`, `cv theme list/path/create` |
| `src/renderers/typst/renderer.ts:35` | `themes/default/template.typ` | constante por defecto (la raíz anterior la sustituye) |
| `src/cli/commands/init.ts:17` | `templates/dataset/` | `cv init` (copia un **árbol** de ficheros) |
| `src/llm/tasks/improve.ts:16` | `prompts/` | `improve`, `summarize`, `suggest tags` |
| `src/pdf/extract-text.ts:50` | `dist/pdf/worker.mjs` | `new Worker(ruta)` para PDF |

### 2.2 Lo que el spike confirmó (binario SEA sin ninguna adaptación)

| Orden | Resultado | Causa |
|---|---|---|
| Cualquiera | falla al arrancar | `readVersion()` lee `package.json` por `__dirname` (que en un SEA es el directorio del ejecutable) |
| Con `package.json` alcanzable: `--version`, `validate`, `build`, `analyze-offer` (texto), `llm status`, `typst status` | **funcionan** | no tocan assets |
| `generate-cv` (Markdown), `generate-cv --format pdf` (pdfkit), `--engine typst`, `theme list` (0 temas), `init`, `improve --show-prompt`, `analyze-offer` (PDF) | fallan | plantilla, fuentes, temas, dataset, prompts y worker por `__dirname` |

Es decir: **un único patrón** (`resolve(__dirname, …)`) en ocho sitios. No hay nada más que adaptar; el resto del programa es indiferente a cómo se distribuye.

## 3. Opciones analizadas

| Opción | Estado (2026) | Win/mac/Linux | Compilación cruzada | Tamaño | Assets | Cadena de suministro | Veredicto |
|---|---|---|---|---|---|---|---|
| **Node SEA** (`node:sea`, `--build-sea`) | Oficial; en Node 26 sigue marcado *Stability 1.1 – Active development*, pero con API estable de facto desde 20.x y un solo paso (`--build-sea`) desde 26 | Sí (el mismo mecanismo en las tres) | No: se inyecta en el binario de Node de la plataforma; se construye en *runners* nativos | ≈ Node oficial: ~110–130 MB sin comprimir, 25–35 MB en xz/zip (68 MB / 16 MB con el Node del sistema en el spike) | `assets` en la configuración; `sea.getAsset()`/`getAssetKeys()`; **no** hay un `fs` virtual: el código debe pedir los assets explícitamente | **Solo binarios oficiales de Node** (los que `actions/setup-node` descarga y verifica); sin terceros | **Recomendada** |
| `pkg` (Vercel) | **Archivado** (enero de 2024); Vercel remite a SEA | — | — | — | — | — | Descartada |
| `@yao-pkg/pkg` (bifurcación comunitaria) | Activa; sigue a Node con retraso (base binaries por versión) | Sí | **Sí** (descarga binarios base precompilados) | 50–100 MB (admite compresión Brotli) | `fs` virtual `/snapshot`: el código con `__dirname` funciona casi sin cambios | Binarios de Node **parcheados y precompilados por terceros** que hay que confiar y fijar por hash; ESM y `worker_threads` con matices | Descartada: comodidad a cambio de confiar en binarios ajenos; contradice `docs/llm-integration.md` §5 |
| `nexe` | Mantenimiento irregular (v4 en beta desde hace años); compila Node o usa binarios precompilados propios | Sí | Parcial | ≈ Node | `--resource` | Igual que arriba, o compilar Node en CI | Descartada |
| `boxednode` (MongoDB) | Activo (lo usa `mongosh`) | Sí | No | ≈ Node | Vía `fs` normal (el código va en el binario compilado) | Compila Node desde el fuente: **30–60 min por plataforma** | Descartada: coste desproporcionado |
| `bun build --compile` | Activo | Sí | **Sí** (`--target`) | ~90 MB | `import … with { type: "file" }` | Cambia el *runtime*: `worker_threads`, `readline/promises`, `child_process` y pdf.js con semánticas distintas; nuestra suite (581 pruebas, 100 %) está escrita contra Node | Descartada para 1.0 |
| `deno compile` | Activo | Sí | **Sí** | ~90–100 MB | `--include` | Idem: compatibilidad Node parcial | Descartada para 1.0 |
| Sin binario: **npm** (`npm i -g chameleon-cv`) | Canal natural de una CLI Node | Donde haya Node ≥ 22.12 | n/a | 2,5 MB + `node_modules` | Ficheros normales | `npm publish --provenance` (OIDC) | **Segundo canal** (no sustituye al binario: exige Node) |
| Sin binario: **Homebrew** (fórmula con dependencia `node`) | — | mac/Linux | n/a | — | — | — | Considerar en T-6.4 con *tap* propio, apuntando a los archivos de la Release |

Criterios aplicados, en orden: (1) **cadena de suministro** —el proyecto se ha negado desde T-3.3 a incorporar binarios de terceros no verificables, y un empaquetador que parchea Node sería la excepción más grande de todas—; (2) que el resultado sea **un binario por plataforma sin instalación**; (3) compatibilidad Win/mac/Linux; (4) cómo entran los assets; (5) tamaño y arranque, que son parecidos en todas las opciones porque todas cargan con el motor.

## 4. Spike: SEA con Node 26.7.0 en esta máquina

Pasos y medidas (ficheros en el *scratchpad*, nada en el repositorio):

1. **Bundle**: `esbuild dist/index.js --bundle --platform=node --format=cjs --target=node26 --external:@napi-rs/canvas` → **4,6 MB** en un fichero (las dependencias ESM quedan resueltas; ninguna advertencia).
2. **SEA en un paso**: `node --build-sea=sea-config.json` (Node 26) genera el ejecutable directamente; `useCodeCache: true` para no recompilar el JavaScript en cada arranque. El camino clásico (`--experimental-sea-config` + `postject`) también funciona, pero al inyectar sobre el Node **de la distribución** (Arch, enlazado dinámicamente con 20 bibliotecas del sistema) el binario resultante fallaba con violación de segmento; el de `--build-sea` no. Lección: construir siempre sobre el **binario oficial** de nodejs.org, que es estático y autocontenido (glibc ≥ 2.28 en Linux; sin musl/Alpine).
3. **Assets**: `sea.getAssetKeys()`, `getAsset('themes/default/theme.toml')` y una fuente TTF de 431 KB se leen correctamente desde dentro; `__filename`, `require.main.filename` y `process.execPath` son la ruta del ejecutable, `__dirname` su directorio.
4. **Tamaño**: ejecutable 68,0 MB con el Node del sistema (el oficial de Linux x64 pesa 31 MiB en xz, unos 115 MB descomprimido); `strip` apenas ahorra; comprimido: **xz -9 16,2 MB**, zstd -19 17,6 MB, gzip -9 23,2 MB.
5. **Arranque** (mediana de 5): `cv --version` **212 ms** (SEA) frente a **356 ms** (`node dist/index.js`); `cv build` 212 ms frente a 424 ms. El *bundle* y la caché de código compensan con creces el tamaño.
6. **Funcionalidad**: la tabla de §2.2. La adaptación es acotada y ya tiene una abstracción donde apoyarse.

## 5. Diseño técnico propuesto (T-6.2)

### 5.1 Capa de assets

Un módulo `src/shared/assets.ts` con un contrato mínimo y dos implementaciones:

```ts
interface AssetStore {
  read(path: string): Promise<Uint8Array>;   // 'themes/default/theme.toml'
  keys(prefix?: string): readonly string[];   // listado (para temas y dataset)
}
// DiskAssets: raíz del repositorio (desarrollo y `dist/`), rutas relativas como hoy.
// SeaAssets:  node:sea (getAsset / getAssetKeys) cuando sea.isSea() es true.
```

Y un adaptador `assetFileSystem(store, prefix)` que expone un `AssetStore` como nuestro `FileSystem` de solo lectura (`readDirectory`, `stat`, `readTextFile`, `readBinaryFile`). Con eso, el **cargador de temas ya está resuelto**: `builtinThemeRoot()` recibe ese `FileSystem` en lugar de `NodeFileSystem` (T-5.1 dejó la raíz distribuida parametrizada precisamente para esto). Cada uno de los ocho acoplamientos de §2.1 pasa a pedir el asset a la capa:

| Acoplamiento | Solución |
|---|---|
| Versión | Inyectada en el *bundle* (`define __CV_VERSION__`, con el `git describe` del tag) y también embebida como asset `package.json`; `cv --version` imprime versión, plataforma y Node. |
| `cv.md.hbs`, `prompts/*.md`, `themes/**` | Lectura directa desde el `AssetStore`. |
| Fuentes (pdfkit) | pdfkit acepta la fuente como `Buffer`: sin disco. |
| Fuentes (Typst) y `templates/dataset` | **Materialización** en la caché de usuario (`~/.cache/chameleon-cv/assets/<versión>/…`, 0700; ficheros 0600 para el dataset por contener datos de ejemplo personales) la primera vez que hacen falta, con el hash de cada fichero fijado en el *bundle* y comprobado antes de usarlo; misma mecánica que la caché de Typst. `--font-path` recibe ese directorio; `cv init` copia desde él. |
| Worker de PDF | Segundo punto de entrada de esbuild (`worker.mts` → IIFE) embebido como asset de texto; `new Worker(código, { eval: true, resourceLimits })` conserva exactamente los mismos límites (T-2.5). En desarrollo sigue cargándose por ruta. |
| `releases.json` | Ya es un `import`: entra en el *bundle*. |

Todo lo anterior mantiene el **contenedor de Typst** intacto (`--root` sigue siendo el directorio del tema, que ahora es o bien el del proyecto del usuario o bien el materializado del tema distribuido en la caché) y la **inmutabilidad de las fuentes** (nada escribe fuera de la caché de usuario y de lo que el usuario pide).

### 5.2 Construcción local (`npm run package`)

`scripts/package.ts`: (1) `npm run build` (tsc), (2) esbuild de `dist/index.js` y del worker, (3) generación de `sea-config.json` con el inventario de assets y sus hashes, (4) `node --build-sea` (o `--experimental-sea-config` + `postject` si se construye con Node 24 LTS), (5) en macOS, `codesign --sign -` *ad hoc* tras la inyección (obligatorio para que el binario arranque), (6) prueba de humo (`cv --version`, `cv init`, `cv build`, `cv generate-cv` Markdown y PDF con pdfkit) en un directorio temporal, (7) archivo `chameleon-cv-<versión>-<os>-<arch>.tar.gz` (Linux/macOS, `--mtime` fijo y ordenación estable para que el hash sea reproducible) o `.zip` (Windows), con `cv` (o `cv.exe`), `LICENSE`, `README.md` y la licencia OFL de las fuentes. Versión de Node de construcción fijada en `.node-version` (26.x; entra en LTS en octubre de 2026; si 1.0 sale antes y se prefiere una LTS, Node 24 con `postject`).

### 5.3 Typst y la variante «completa»

Recomendación: el binario **no** incluye Typst. Razones: 56 MB por plataforma (duplicaría el archivo), `cv typst install` ya descarga el release oficial verificado con SHA-256 bajo consentimiento explícito (T-3.3), y así las versiones de Typst y de `cv` evolucionan por separado. Opción adicional para entornos sin red: un segundo archivo `…-full` con `typst` junto a `cv`, y una entrada más en el localizador (`dirname(process.execPath)/typst`, antes de la caché y del PATH). Coste: dos archivos más por plataforma en cada release.

### 5.4 Plataformas

| Objetivo | Runner | Notas |
|---|---|---|
| linux-x64 | `ubuntu-24.04` | glibc ≥ 2.28 |
| linux-arm64 | `ubuntu-24.04-arm` | idem |
| darwin-arm64 | `macos-15` | firma *ad hoc* obligatoria; sin notarización, Gatekeeper avisa (§7) |
| darwin-x64 | `macos-13` (x64) | idem |
| win-x64 | `windows-2025` | sin firma Authenticode, SmartScreen avisa (§7) |
| win-arm64 | opcional | `windows-11-arm` cuando esté disponible; si no, se omite en 1.0 |

## 6. Estrategia de release

### 6.1 Disparador y versión

- `git tag -s v1.0.0 && git push --tags` sobre `main`. El flujo se activa con `push: tags: ['v*']`.
- Regla de coherencia: la versión de `package.json` **debe** ser igual al tag sin la `v`; el trabajo `verify` lo comprueba y aborta si no. Tags `v1.0.0-rc.1` → *prerelease*.
- Notas de la release generadas a partir de los commits (ya usamos *conventional commits*: `feat`, `fix`, `docs`…); `gh release create --generate-notes` como base, o `git-cliff` si se quiere un `CHANGELOG.md` mantenido.

### 6.2 Flujo (`.github/workflows/release.yml`)

```
tag v* ──► verify ──► build (matriz de 5) ──► release
```

1. **verify** (`ubuntu-24.04`): `npm ci`, `npm run typecheck`, `npm run coverage` (umbral 100 %), y las pruebas con Typst real (`cv typst install` en el runner, con caché de Actions por versión) para que el golden del PDF se compruebe en cada release; comprobación tag = versión.
2. **build** (matriz de §5.4, `needs: verify`): `actions/setup-node` con la versión de `.node-version` (descarga y verifica el binario oficial: `--build-sea` copia ese mismo `process.execPath`), `npm ci`, `npm run package`, **prueba de humo del binario producido** (init → build → generate-cv md y pdf; en Linux también `--engine typst` con la caché), `actions/upload-artifact` del archivo.
3. **release** (`needs: build`, permisos `contents: write`, `id-token: write`, `attestations: write`): descarga de artefactos, `sha256sum * > SHA256SUMS.txt`, `actions/attest-build-provenance` (atestación SLSA firmada por Sigstore, verificable con `gh attestation verify`), `gh release create "$TAG" --verify-tag --generate-notes --draft=false` con los archivos y `SHA256SUMS.txt` adjuntos.

Prácticas fijas: acciones ancladas por **SHA** (no por tag), `npm ci` con `package-lock.json`, `permissions: {}` por defecto y mínimos por trabajo, ningún secreto para los binarios (basta `GITHUB_TOKEN`), `concurrency` por tag, tiempo máximo por trabajo, y `workflow_dispatch` para ensayar el flujo sin publicar (`dry-run`).

### 6.3 Canales adicionales (opcional, T-6.4)

- **npm**: `npm publish --provenance --access public` desde el trabajo `release` con *trusted publishing* (OIDC, sin token de larga duración). El paquete publica `dist/`, `themes/`, `templates/`, `prompts/`; `npx chameleon-cv` funciona donde haya Node ≥ 22.12. Recomendado desde 1.0: es barato y es el canal que esperan los desarrolladores.
- **Homebrew**: *tap* propio (`<usuario>/homebrew-chameleon-cv`) con una fórmula que apunta a los archivos de la Release por arquitectura y sus `sha256`; el trabajo `release` puede abrir un PR en el *tap* con las URL y hashes nuevos. Recomendado para 1.1, cuando el formato de los archivos esté asentado.
- **winget / scoop**: más adelante; ambos exigen firma o, al menos, hashes estables y un proceso de revisión.

## 7. Firma, notarización y avisos del sistema (decisión)

Sin certificados, el binario funciona en las tres plataformas pero macOS y Windows **avisan**: Gatekeeper bloquea la primera ejecución de un binario descargado sin notarizar (el usuario debe quitar la cuarentena: `xattr -d com.apple.quarantine cv`, documentado en el README) y SmartScreen muestra «editor desconocido». Resolverlo cuesta dinero y burocracia: Apple Developer ID (99 $/año, notarización en CI con `notarytool`) y un certificado Authenticode (o Azure Trusted Signing). Propuesta: **1.0 sin firma comercial**, con firma *ad hoc* en macOS, `SHA256SUMS.txt`, atestación SLSA y las instrucciones claras; abrir T-6.5 si el Director decide invertir en certificados.

## 8. Plan del Hito 6

| Tarea | Contenido | Entregable |
|---|---|---|
| **T-6.1** | Esta nota (aprobación). | — |
| **T-6.2** | Capa de assets (§5.1), *bundle* con esbuild, `npm run package` con SEA, prueba de humo del binario, README de instalación; pruebas con un doble de `AssetStore` y una prueba real que construye el SEA en esta máquina (condicionada como las de Typst). | Binario local funcionando de principio a fin |
| **T-6.3** | `release.yml` (§6.2) + `ci.yml` en cada PR (verify), ensayo con un tag `v0.9.0-rc.1`. | Release con 5 archivos + `SHA256SUMS.txt` + atestación |
| **T-6.4** (opcional) | npm con *trusted publishing*; *tap* de Homebrew. | `npm i -g chameleon-cv`, `brew install …` |
| **T-6.5** (decisión) | Firma/notarización macOS y Windows. | Binarios firmados |
| **T-6.6** | 1.0.0: revisión final del README (instalación por binario, npm), `cv --version` con plataforma y Node, tag firmado. | Release v1.0.0 |

## 9. Riesgos

- **SEA sigue marcado experimental** en la documentación de Node (1.1) aunque su API lleva años estable y `--build-sea` es nuevo: se fija la versión de Node de construcción y la prueba de humo del binario detecta cualquier cambio de comportamiento antes de publicar.
- **Materialización en caché**: un directorio de caché no escribible (o un sistema de solo lectura) rompería `--engine typst` e `init`; se mantiene la salida de siempre —mensaje claro— y las variables `XDG_CACHE_HOME`/`LOCALAPPDATA` ya respetadas en T-3.3.
- **pdf.js en un solo fichero**: el *bundle* del worker debe conservar los polyfills que pdf.js espera; queda cubierto por la prueba de humo con un PDF real.
- **Tamaño del archivo** (~30 MB): inherente a llevar Node dentro; es el precio de «sin instalación». El canal npm sigue siendo la opción ligera.

## 10. Decisiones que se piden al Director

1. **Empaquetador**: Node SEA con esbuild (recomendado) frente a la bifurcación de `pkg`.
2. **Typst fuera del binario** (recomendado), con o sin la variante `…-full` para entornos sin red.
3. **Matriz de plataformas**: linux-x64, linux-arm64, darwin-x64, darwin-arm64, win-x64 en 1.0; win-arm64 después.
4. **Firma**: 1.0 sin certificados comerciales (firma *ad hoc* + hashes + atestación) o inversión en Developer ID y Authenticode (T-6.5).
5. **Canales**: binarios en GitHub Releases + npm desde 1.0 (recomendado); Homebrew en 1.1.
6. **Versión de Node de construcción**: 26 (con `--build-sea`; LTS en octubre de 2026) o 24 LTS con `postject`.

## 11. Estado de la implementación

- **T-6.2 (2026-08-29)**: entregada. **Capa de assets** (`src/shared/assets.ts`): `AssetStore` con `DiskAssets` (repositorio), `MemoryAssets` (pruebas) y `SeaAssets` (`node:sea`; materialización atómica en `<caché>/chameleon-cv/assets/<versión>/`, 0700/0644, SHA-256 de cada fichero comprobado contra el manifiesto embebido en cada uso; errores tipificados `invalid-key`/`missing`/`corrupt`/`unwritable`). Los ocho acoplamientos de §2.1 leen por la capa (`CliContext.assets`): versión, plantilla Markdown, prompts, dataset de `init`, temas distribuidos, fuentes de Typst (directorio materializado), fuentes de pdfkit (bytes) y worker de PDF (por código, `eval`, con los mismos límites). **Dos hallazgos** que el spike no había destapado: (1) pdf.js exige `DOMMatrix` al cargarse y, sin el addon nativo `@napi-rs/canvas`, no arranca: `src/pdf/dom-matrix.mts` es un `DOMMatrix` afín 2D mínimo instalado antes que pdf.js en el repositorio y en el binario por igual, y el manejador `pdf.worker.mjs` se importa de forma estática para que pdf.js no lo busque por ruta; (2) pdfkit carga sus fuentes estándar (Courier para el código en línea) con un `require` indirecto: `scripts/package.ts` lo hace estático con un plugin de esbuild y los datos viajan en el bundle. **`npm run package`** (linux-x64, Node 26 `--build-sea`): compilación limpia, bundles de 4,4 MB (CLI) y 3,2 MB (worker), 25 assets (4,4 MB con el manifiesto), ejecutable de 69 MB con el Node del sistema, prueba de humo (init, build, Markdown, pdfkit, oferta en PDF, temas, prompt, Typst) y archivo `chameleon-cv-0.1.0-linux-x64.tar.gz` de 23 MB reproducible con su `.sha256`; 21 s. **Aceptación**: los dos arneses admiten `--binary`; el determinista dio **77/77 pasos idénticos** con el ejecutable (22 s frente a 33 s con `node dist/index.js`) y el de IA **16/16** con el modelo local. Pendiente para T-6.6: la licencia del proyecto (`package.json` dice `UNLICENSED`; el archivo lleva el README y la licencia OFL de las fuentes).
- **T-6.3 (2026-08-29)**: entregada, lista para el primer `push` (el repositorio aún no tiene remoto). `.github/workflows/ci.yml` (push a `main` y pull requests): typecheck, lint, build, Typst instalado con `cv typst install` en la caché de usuario (cacheada por versión con `actions/cache`), cobertura al 100 % con las pruebas del binario real y el arnés determinista con `--require-typst`. `.github/workflows/release.yml` (tags `v*` y `workflow_dispatch` como ensayo sin publicar): `verify` (lo mismo, más «el tag debe ser la versión de `package.json`»), `package-linux-x64` (`npm run package` con su prueba de humo, arnés determinista **contra el ejecutable** con Typst obligatorio y archivado de `.tar.gz` + `.sha256` como artefacto, 30 días) y `release` (solo con tag: `SHA256SUMS.txt`, atestación SLSA con `actions/attest-build-provenance` y `gh release create --verify-tag --generate-notes`, `--prerelease` si el tag lleva sufijo). Permisos vacíos por defecto y mínimos por trabajo; sin secretos (`GITHUB_TOKEN`); acciones fijadas por SHA con su versión anotada; `.node-version` = 26.7.0; `.github/dependabot.yml` para acciones y npm. **Ensayo local** de la secuencia exacta (107 s): `npm ci`, verify, Typst en la caché real, cobertura (610 tests, 100 %), arnés 77/77 con `dist/`, `npm run package`, arnés 77/77 contra el binario, `SHA256SUMS.txt`, comprobación `sha256sum -c` y la lógica de tag/prerelease. **Activación**: crear el repositorio en GitHub, `git remote add origin … && git push -u origin main` (arranca CI), y para publicar `git tag -s v0.1.0 && git push origin v0.1.0` (o «Run workflow» en Release para un ensayo sin publicar). Fuera de alcance, para T-6.4+: el resto de plataformas, npm y Homebrew.
- **Corrección de T-6.3 (2026-08-29, detectada en T-6.6)**: los dos workflows invocaban `npm run lint`, un script que no existe en `package.json` (el proyecto no tiene linter: la puerta estática es `tsc` en modo estricto, `npm run typecheck`); en GitHub el paso habría fallado y el ensayo local no lo ejercitó. Eliminado de `ci.yml`, `release.yml` y de §6.2; ESLint queda registrado en el backlog (B-6).
