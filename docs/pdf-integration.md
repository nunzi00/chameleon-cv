# Integración PDF: entrada (oferta → texto) y salida (CV → PDF)

| | |
|---|---|
| **Tareas** | T-2.5 · [PARSER] Soporte básico para PDF (entrada) · T-2.6 · [RENDER] Salida PDF |
| **Estado** | **APROBADO** por el Director de Ingeniería el 2026-08-28 (los seis puntos de §6 canonizados). T-2.5 en `src/pdf/`; T-2.6 en `src/renderers/pdf/`. |
| **Autor** | Claude (Director Técnico) |
| **Decide** | Con qué librería se extrae el texto de una oferta en PDF, con qué motor se genera el CV en PDF y cómo se integran ambas con la arquitectura vigente sin comprometer seguridad, portabilidad ni privacidad. |
| **Criterios (Director de Ingeniería)** | T-2.5: **seguridad** ante todo (*headless*, robusta, historial mínimo de vulnerabilidades, procesamiento contenido). T-2.6: **calidad frente a dependencias**, mantenimiento, portabilidad (Windows/macOS/Linux) y privacidad (nada sale del equipo). |

## 1. Evidencia recogida (2026-08-28)

### 1.1 Registro npm

| Paquete | Versión | Última publicación | Desde | Licencia | Deps. | Notas |
|---|---|---|---|---|---|---|
| `pdfjs-dist` | 6.2.108 | 2026-07-28 | 2014 | Apache-2.0 | 0 | pdf.js de Mozilla (el visor de Firefox). Cadencia mensual. Build *legacy* cargable con `require(esm)` (verificado). |
| `pdf-parse` | 2.4.5 | 2025-10-29 | 2018 | Apache-2.0 | — | Envoltorio de pdf.js; el 1.x que citaba el roadmap llevaba años sin mantenimiento; el 2.x es una reescritura reciente. 20 MB. |
| `unpdf` | 1.8.1 | 2026-08-13 | 2023 | MIT | 0 | Envoltorio de un build *serverless* de pdf.js. Orientado a edge/serverless. |
| `pdf2json` | 4.0.3 | 2026-04-16 | 2012 | Apache-2.0 | — | *Fork* antiguo de internos de pdf.js. |
| `pdf-lib` | 1.17.1 | 2022-05-12 | 2017 | MIT | — | Sin publicaciones desde 2022; no extrae texto ni maqueta flujo de texto. |
| `pdfkit` | 0.20.1 | 2026-08-23 | 2011 | MIT | — | Generación de PDF en JS puro, flujo de texto, listas, fuentes embebidas (`fontkit`). |
| `pdfmake` | 0.3.11 | 2026-06-12 | 2014 | MIT | — | Capa declarativa sobre pdfkit. |
| `@react-pdf/renderer` | 4.9.0 | 2026-08-27 | 2018 | MIT | — | Maquetación flexbox (yoga) con React. |
| `puppeteer` / `puppeteer-core` | 25.9.0 | 2026-08-25 | 2013 | Apache-2.0 | — | Descarga Chromium (~300 MB) o usa uno instalado. |
| `playwright` | 1.62.1 | 2026-08-28 | 2015 | Apache-2.0 | — | Ídem, navegadores propios. |
| `md-to-pdf` | 5.2.5 | 2025-11-20 | 2016 | MIT | — | Envoltorio de puppeteer. |

Binarios en la máquina de desarrollo: `pdftotext` (poppler 26.08) presente; `pandoc`, `typst`, Chromium, `wkhtmltopdf`, `weasyprint` y LaTeX **ausentes**.

### 1.2 Spike (scratchpad, fuera del repositorio)

- `pdfkit` genera un CV de prueba (A4, Helvetica, acentos, viñetas) de **1,8 KB**.
- `pdfjs-dist` 6.2.108 (`legacy/build/pdf.mjs`) se carga desde CommonJS con **`require(esm)`** (sin *top-level await*) y, con opciones endurecidas (`isEvalSupported: false`, `disableFontFace: true`, `useSystemFonts: false`, `stopAtErrors: true`), extrae las cinco líneas íntegras en **~110 ms**, de forma **determinista** (dos ejecuciones, mismo texto).
- Un fichero que no es PDF produce un error controlado (`InvalidPDFException: Invalid PDF structure`), no una caída.
- Conclusión práctica: **la salida de T-2.6 se puede verificar con la entrada de T-2.5** (*round-trip* CV → PDF → texto), lo que da un test de aceptación real para el renderer.

## 2. T-2.5: extracción de texto de la oferta

### 2.1 Análisis

| Criterio | `pdfjs-dist` (directo) | `pdf-parse` 2.x | `unpdf` | `pdf2json` | `pdftotext` (poppler) |
|---|---|---|---|---|---|
| Mantenimiento | Mozilla, mensual, es el visor de Firefox | Reescritura 2025 sobre pdf.js; capa extra con su propia cadencia | Activo; capa extra, foco serverless | *Fork* con internos antiguos | Muy maduro (C++) |
| Superficie de ataque | Parser en JS puro (sin memoria insegura); el vector histórico —CVE-2024-4367, ejecución de JS vía fuentes maliciosas con `isEvalSupported`— se anula con la opción desactivada y versiones ≥ 4.2.67 (usaríamos 6.x) | La de pdf.js + la del envoltorio | Ídem | Internos no alineados con los parches de Mozilla | Código nativo con historial de CVEs propio; proceso aparte, pero binario externo |
| Contención | Ejecutable en un `worker_threads` propio con `terminate()`, tiempo máximo y límite de memoria | Igual (es pdf.js) | Igual | Igual | Proceso externo (contención natural) |
| Portabilidad | Windows/macOS/Linux, sin binarios | Ídem | Ídem | Ídem | Requiere instalar poppler en cada plataforma |
| Tamaño instalado | ~34 MB (incluye builds, *maps*, fuentes CMap) | ~21 MB + pdf.js | ~2 MB (build empaquetado) | ~8 MB | 0 en npm; binario del sistema |
| Control | Total sobre opciones de seguridad y límites | Mediado por el envoltorio | Mediado | Mediado | Solo por flags |
| Privacidad | Sin red (no se configuran URLs de fuentes ni CMaps; solo texto, no *render*) | Ídem | Ídem | Ídem | Sin red |

### 2.2 Recomendación: `pdfjs-dist` directo, endurecido y contenido

1. **Dependencia directa de `pdfjs-dist`** (sin envoltorios): el mantenedor es Mozilla, la cadencia de parches es la del visor de Firefox y no hay capa intermedia que retrase un arreglo de seguridad ni que añada superficie.
2. **Opciones endurecidas fijas** (no configurables): `disableFontFace: true`, `useSystemFonts: false`, `stopAtErrors: true`, `verbosity: 0`, sin `cMapUrl` ni `standardFontDataUrl`. Solo se pide texto (`getTextContent`); nunca se rasteriza ni se cargan fuentes: el contenido de la oferta no puede ejecutar nada. Precisión tras la implementación (2026-08-28): **pdf.js ≥ 5 eliminó por completo el código evaluado dinámicamente**; la opción `isEvalSupported` ya no existe en 6.x y el build no contiene ningún `new Function` (verificado), de modo que el vector CVE-2024-4367 desaparece por construcción, no por configuración.
3. **Contención**: la extracción corre en un **`worker_threads` Worker** con `resourceLimits` (memoria) y un **tiempo máximo** (p. ej. 20 s) tras el cual se llama a `terminate()`; el *worker* recibe bytes y devuelve texto, sin acceso al artefacto ni a `output/`. Un PDF patológico no puede colgar ni tumbar la CLI.
4. **Límites de entrada**: ≤ 10 MiB por fichero (frente a 1 MiB del texto plano), ≤ 50 páginas, texto resultante ≤ 1 MiB (después se aplica el mismo camino que el texto plano).
5. **Misma puerta**: `readOfferText` despacha por extensión: `.pdf` → extracción → texto normalizado → `extractJobRequirements`. `generate-cv --from-job-offer oferta.pdf` y `analyze-offer oferta.pdf` funcionan sin ninguna otra opción. Por `stdin` (`-`) solo se admite texto.
6. **Riesgo resuelto en la implementación**: el *worker* es un módulo ESM autocontenido (`src/pdf/worker.mts`, compilado a `dist/pdf/worker.mjs`) que solo importa paquetes; Node lo carga nativamente en desarrollo (*type stripping*) y compilado en `dist/`, sin `ts-node` ni precompilación aparte. Verificado con Vitest y con el binario compilado.

`pdftotext` queda descartado por portabilidad (binario externo en las tres plataformas), no por calidad; `pdf-parse`/`unpdf` por ser capas sobre el mismo pdf.js.

## 3. T-2.6: generación del CV en PDF

### 3.1 Análisis comparativo

| Criterio | A · Pandoc (+ motor) | B · Puppeteer / Playwright | C · Typst (binario) | D · JS puro: `pdfkit` (o `pdfmake`) | E · `@react-pdf/renderer` |
|---|---|---|---|---|---|
| Calidad tipográfica | Excelente con LaTeX/Typst; mediocre con `wkhtmltopdf` | Alta (CSS de impresión) | Excelente | Buena (flujo de texto, fuentes embebidas; sin motor de párrafos avanzado) | Alta (flexbox) |
| Dependencias e instalación | Binario `pandoc` **más** un motor: LaTeX (GBs), `wkhtmltopdf` (sin mantenimiento desde 2020, WebKit antiguo), `weasyprint` (Python) o `typst` (otro binario) | Descarga de Chromium (~300 MB) en `npm install`, o Chrome ya instalado; *sandbox* problemático en Linux/CI | Un binario (~35 MB) por plataforma; no instalado por defecto | `npm install` y nada más; ~10 MB en `node_modules` | `npm install`; añade React y el motor de layout yoga a una CLI |
| Huella y consumo | Alta (LaTeX) o media | Muy alta (navegador por CV) | Baja | Baja | Media |
| Portabilidad | Depende de dos instalaciones | Depende del navegador y del *sandbox* | Buena (releases para las tres plataformas) | Total | Total |
| Mantenimiento | Pandoc activo; el motor depende de la elección | Activo (Google/Microsoft) | Activo (joven: 2023) | Activo desde 2011; última publicación 2026-08-23 | Activo |
| Privacidad | Local; Chromium no interviene | Local si se bloquea toda petición de red del navegador (hay que garantizarlo explícitamente) | Local (lenguaje sin red ni shell) | Local (no hay I/O más allá del fichero de salida) | Local |
| Encaje con nuestra arquitectura | Markdown → PDF **saltándose el modelo de vista**, o duplicando plantillas | HTML/CSS: un segundo renderer completo (plantilla HTML) | Plantilla Typst desde el modelo de vista (`cv.typ.hbs`): encaje elegante | Renderer desde el **mismo modelo de vista** (`buildCvView`), sin plantilla textual: código de maquetación | Renderer desde el modelo de vista con componentes React |
| Testabilidad | Difícil (binarios en CI) | Difícil y lenta | Media (binario en CI) | **Alta**: determinista, *round-trip* con T-2.5 | Media |
| Riesgo | Instalación y bifurcación de plantillas | Huella, *sandbox*, desproporción | Dependencia externa y juventud | Maquetación programada a mano (párrafos, listas, saltos de página) | Framework de UI en una CLI |

### 3.2 Recomendación: `pdfkit` desde el modelo de vista

- **Motor**: `pdfkit` (JS puro, MIT, 15 años, activo). Ni binarios ni navegadores: `npm install` basta, en Windows, macOS y Linux, y no hay ninguna vía por la que un dato salga del equipo.
- **Arquitectura**: un `PdfRenderer` en `src/renderers/pdf/` que consume **el mismo `CvView`** que el renderer Markdown (mismas etiquetas por idioma, mismas fechas, mismo orden, misma selección y recorte). La doctrina «renderers, no parsers» se cumple sin tocar el núcleo: el PDF es otra salida del modelo de vista.
- **Markdown en línea** (`**40 %**`, enlaces, código) en resúmenes y logros: se convierte en *runs* con estilo (negrita, cursiva, monoespaciada, enlaces) reutilizando el parser mdast que ya tenemos, y pdfkit los encadena con `continued`.
- **Tipografía**: fuente **embebida** con cobertura Unicode completa (recomendación: *Inter* o *Source Sans 3*, licencia OFL, tres estilos estáticos, ~0,9 MB en `templates/fonts/` con su licencia). Las fuentes estándar de PDF (Helvetica, sin embeber) cubrirían el castellano pero no símbolos como «→» o «✓» que el usuario puede escribir. Tamaño A4, márgenes de 2 cm, jerarquía tipográfica sobria; metadatos con `CreationDate` fijo para que el fichero sea **reproducible**.
- **Verificación**: *golden* por *round-trip* — el CV de ejemplo se renderiza a PDF, T-2.5 extrae el texto y se compara con las líneas esperadas; además, comprobaciones estructurales (una página, fuente embebida, sin enlaces externos).
- **CLI (T-2.6)**: `generate-cv --format pdf` (por defecto `md`); salida `output/cv-<nombre>[-<especialidad>][-<oferta>].pdf` con permisos 0600; `--stdout` con `pdf` es error de uso; `--template` solo aplica a Markdown (el PDF no usa plantilla textual).

### 3.3 Descartes y alternativas

- **Puppeteer/Playwright**: lanzar un navegador para imprimir un CV es desproporcionado: ~300 MB, *sandbox* de Chromium, arranque lento, y habría que garantizar el bloqueo de red del navegador. Se descarta.
- **Pandoc**: exige un segundo motor; con LaTeX son gigabytes; `wkhtmltopdf` está sin mantenimiento; y la ruta Markdown → PDF se saltaría el modelo de vista o duplicaría las plantillas. Se descarta.
- **`md-to-pdf`**: es puppeteer. **`pdf-lib`**: sin mantenimiento desde 2022 y sin flujo de texto. **`@react-pdf/renderer`**: viable, pero introduce React y yoga en una CLI para resolver lo que pdfkit ya resuelve.
- **Typst (B-4, backlog)**: la mejor calidad tipográfica con un solo binario y un encaje natural con nuestras plantillas Handlebars (`templates/cv.typ.hbs`). No se adopta ahora porque introduce una dependencia externa no instalada por defecto; la arquitectura de renderers permite añadirlo después como motor opcional (`--engine typst`) sin tocar el núcleo. Queda registrado en el backlog.

## 4. Recomendación integrada

**Una sola pila JS pura para PDF: `pdfjs-dist` en la entrada y `pdfkit` en la salida.**

| Garantía | Cómo se cumple |
|---|---|
| Seguridad (T-2.5) | pdf.js de Mozilla con `isEvalSupported: false` y sin fuentes ni *render*; *worker* aislado con tiempo y memoria acotados; límites de tamaño y páginas; el error es siempre controlado. |
| Contención | La extracción no puede tocar el artefacto ni `output/`; un PDF hostil como mucho agota su *worker*, que se termina. |
| Calidad frente a dependencias (T-2.6) | Calidad profesional suficiente para un CV con fuente embebida; cero binarios y cero navegadores; ~45 MB más en `node_modules` (pdf.js 34 + pdfkit 10). |
| Mantenimiento | Dos proyectos veteranos y activos (Mozilla 2014–, pdfkit 2011–), ambos con publicaciones en las últimas semanas. |
| Portabilidad | `npm install` en Windows, macOS y Linux; sin PATH ni instaladores. |
| Privacidad | Ninguna de las dos librerías abre conexiones; no hay descargas en instalación (a diferencia de Puppeteer) ni fuentes remotas; las fuentes van en el repositorio. |
| Coherencia | El PDF sale del mismo `CvView` que el Markdown: selección, oferta, recorte y etiquetas idénticos en las dos salidas. |
| Verificabilidad | *Round-trip* CV → PDF → texto como test de aceptación; cobertura 100 % en `src/renderers/pdf/**` y en la lógica de extracción (el *worker* es I/O y se trata como `src/index.ts`). |

Coste asumido: la maquetación se programa (no se escribe en CSS); es el precio de no depender de un navegador. Para un CV —cabecera, contacto, secciones, párrafos y viñetas— es asumible y queda encapsulado en el renderer.

## 5. Plan de implementación

| Pieza | Ubicación | Notas |
|---|---|---|
| Extracción PDF | `src/pdf/extract-text.ts` (API: `extractPdfText(bytes, limits) → Result<string>`) + `src/pdf/worker.ts` (I/O, fuera de cobertura) | Opciones endurecidas fijas; límites de §2.2; errores tipificados (corrupto, demasiado grande, demasiadas páginas, tiempo agotado). |
| Puerta de entrada | `src/cli/offer.ts`: `.pdf` → bytes → `extractPdfText` → texto; el resto sin cambios | `analyze-offer` y `generate-cv --from-job-offer` aceptan PDF automáticamente. |
| Renderer PDF | `src/renderers/pdf/` (`renderPdfCv(profile, options) → Buffer`, `inline.ts` para *runs* con estilo, `layout.ts`) | Desde `buildCvView`; fuente embebida de `templates/fonts/`; `CreationDate` fijo. |
| CLI | `generate-cv --format md\|pdf`, salida `.pdf` 0600 | `--stdout` + `pdf` = error de uso. |
| Tests | Fixtures PDF generadas en test con pdfkit (válido, corrupto, multipágina, grande), límites y tiempo agotado con un *worker* simulado; *golden* por *round-trip* del CV de ejemplo; estructura del PDF | 100 % en `src/pdf/**` (salvo el *worker*) y `src/renderers/pdf/**`. |
| Docs | README (oferta en PDF, `--format pdf`), `docs/arquitectura.md` §2.5 actualizado | — |

Orden: T-2.5 primero (habilita el test de aceptación de T-2.6), después T-2.6.

## 6. Puntos de decisión (todos aprobados el 2026-08-28)

1. **T-2.5 = `pdfjs-dist` directo**, endurecido, en un *worker* con tiempo y memoria acotados, límites 10 MiB / 50 páginas / 20 s, misma puerta `readOfferText` (§2.2). Recomendación: aprobar.
2. **T-2.6 = `pdfkit` desde el modelo de vista**, sin Pandoc ni Puppeteer (§3.2). Recomendación: aprobar.
3. **Fuente embebida OFL en el repositorio** (~0,9 MB; *Inter* o *Source Sans 3*) frente a fuentes estándar sin embeber (§3.2). Recomendación: embebida.
4. **CLI**: `--format md|pdf`, `.pdf` con 0600, `--stdout` incompatible con PDF, PDF no admitido por `stdin` (§2.2, §3.2). Recomendación: aprobar.
5. **Typst como motor opcional futuro (B-4)** en el backlog (§3.3). Recomendación: aprobar el registro sin compromiso de fecha.
6. **Verificación por *round-trip*** como test de aceptación de T-2.6 (§1.2, §4). Recomendación: aprobar.

Con la aprobación se marca el documento como APROBADO y se implementan T-2.5 y T-2.6 (en ese orden, cada una con su cobertura al 100 %).

## 7. Estado de la implementación (2026-08-28)

- **T-2.5 (entrada)**: `src/pdf/extract-text.ts` + `src/pdf/worker.mts` (ESM autocontenido, cargado nativamente por Node en desarrollo y como `dist/pdf/worker.mjs` compilado). Límites aplicados tal cual §2.2; pdf.js 6.2 sin código evaluable (§2.2, punto 2). `generate-cv -f` y `analyze-offer` aceptan `.pdf`; por `stdin` solo texto.
- **T-2.6 (salida)**: `src/renderers/pdf/` — `inline.ts` (Markdown en línea → runs con negrita/cursiva/código/enlace, reutilizando mdast) y `renderer.ts` (`renderPdfCv`, maquetación con `pdfkit` sobre el mismo `CvView` que Markdown: A4, márgenes de 56 pt, Source Sans 3 Regular/Semibold/It embebida, código en Courier, viñetas, regla bajo cada sección, paginación automática). Fuente elegida: **Source Sans 3** (release 3.052R de Adobe, tres estilos estáticos, 1,2 MB con la licencia OFL en `templates/fonts/`); Inter quedó descartada por tamaño (sus estáticos superan los 300 KB por estilo).
- **Reproducibilidad**: la fecha de creación/modificación es `meta.updatedAt` del perfil o una constante (2000-01-01) si no la declara; `Producer`/`Creator` fijos; dos renderizados del mismo perfil son idénticos byte a byte (verificado en tests).
- **Aceptación (§6, punto 6)**: `tests/renderers/pdf/renderer.test.ts` renderiza el CV backend de `docs/selector-engine.md` §5.4, extrae el texto con T-2.5 y lo compara con el golden `tests/fixtures/golden/cv-backend.pdf.txt`; además comprueba fuente embebida (`/FontFile2`), ausencia de `/JavaScript`, `/Launch`, `/OpenAction`, `/AA` y `/EmbeddedFile`, y la paginación de CV largos.
- **Defecto detectado por el round-trip y corregido antes de cerrar**: un run vacío al final de una línea (p. ej. certificación sin emisor ni fecha) no cerraba la línea en `pdfkit` y la viñeta siguiente se fundía con la anterior; el renderer descarta ahora los runs vacíos y escribe una línea en blanco explícita cuando no queda ninguno.
- **Enlaces**: los enlaces explícitos (contacto, certificaciones, Markdown en logros) se conservan como anotaciones `/URI` clicables; no implican ninguna carga externa al generar ni al abrir el PDF.
