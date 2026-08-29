---
title: Visión arquitectónica
---
# Visión arquitectónica

Chameleon CV es una CLI en TypeScript (Node.js) organizada en **dos capas**: un ecosistema de datos determinista —fuentes, artefacto, selección y renderizado— y, encima, una capa de inteligencia que solo propone. Todo lo que hace el producto se puede explicar con cuatro invariantes:

1. **Las fuentes son la única verdad** y nunca las toca nadie salvo tú (o `cv improve apply` con tu marca).
2. **Todo es determinista** salvo la respuesta del modelo, y esa se verifica por código antes de llegar a ti.
3. **Local por diseño**: ninguna conexión de red sin una orden explícita; ficheros con datos personales a 0600.
4. **El núcleo es el producto**: la CLI es un cliente de la lógica central; cualquier otra interfaz (API headless, GUI) también lo será.

## Flujo de datos

![Flujo de datos: fuentes, parsers y esquema, artefacto, selección y adaptación, renderers](/diagrams/data-flow.svg)

1. **Parsers y esquema** (`src/parsers/`, `src/core/schema/`): Markdown con frontmatter y CSV se convierten en un `MasterProfile` validado con zod en modo estricto (claves desconocidas, fechas, longitudes, caracteres de control, URL). Todos los errores se recogen a la vez con fichero y línea.
2. **Artefacto** (`src/artifact/`): `cv build` escribe `data/dist/profile.json` de forma atómica con permisos 0600; cada lectura posterior lo re-valida.
3. **Selección y adaptación** (`src/core/selection/`, `src/core/keywords/`, `src/core/scoring/`): el `SelectorEngine` aplica la regla de las etiquetas por especialidad (y `#pin`); con una oferta, el extractor de palabras clave lee la oferta con el vocabulario del perfil, el *scorer* pesa cada requisito por sección y el recorte «N mejores» condensa. Cada decisión se explica (`--explain`).
4. **Vista estructurada y renderers** (`src/renderers/`): una `StructuredView` única alimenta el Markdown (Handlebars), el PDF con pdfkit y el PDF con Typst (`src/typst/`, proceso contenido) y sus temas (`src/themes/`). Cambia la maquetación, nunca el contenido: la suite lo comprueba extrayendo el texto de los PDF.

## La capa de inteligencia

![Flujo del co-piloto: perfil filtrado, carga útil mínima, proveedor, verificación por código, revisión y aplicación con marca](/diagrams/copilot-flow.svg)

`src/llm/` define `LlmProvider` (locales `ollama` y `openai-compatible`, remotos `openai` y `anthropic`), las tareas (`improve`, `summarize`, `suggest tags`), la caché local y el estado. `src/core/llm/` contiene lo que no depende de ningún modelo: la seudonimización, el **verificador de integridad semántica** (canon C2) y el diccionario cerrado de etiquetas. El resultado de cada tarea es un fichero de revisión; `cv improve apply` (`src/cli/commands/apply.ts`) es la única vía de vuelta a las fuentes. Doctrina completa: [Co-piloto de IA: diseño y principios](/design/llm-integration).

## Módulos

| Módulo | Responsabilidad |
|---|---|
| `src/core/schema` | `MasterProfile` y su validación (zod), fechas, rutas de error. |
| `src/parsers` | Cargador del dataset con un `FileSystem` inyectable; parsers Markdown y CSV; validación de secciones. |
| `src/artifact` | Serialización y escritura atómica del artefacto; `WritableFileSystem`. |
| `src/core/selection` · `keywords` · `scoring` | Selección por especialidad, extracción de palabras clave, puntuación y recorte. |
| `src/renderers` | `structured` (vista única), `markdown` (Handlebars), `pdf` (pdfkit), `typst` (documento Typst y contrato `cv(d, theme)`). |
| `src/themes` | `theme.toml` (TOML → zod), cargador (proyecto y distribuidos), `cv.toml` con anulaciones en cascada. |
| `src/typst` | Instalación verificada del binario (manifiesto SHA-256) y ejecución contenida. |
| `src/pdf` | Extracción de texto de ofertas en PDF en un worker aislado (pdf.js) con límites. |
| `src/llm` · `src/core/llm` | Proveedores, tareas, caché, claves y lista blanca; seudonimización y verificación. |
| `src/cli` | Programa commander, contexto inyectable (`CliContext`), comandos, consentimiento remoto. |
| `src/shared` | Capa de assets (repositorio o `node:sea` con materialización verificada), caché de usuario, errores. |
| `src/release` | Notas de la release desde `CHANGELOG.md` y avisos de licencias de terceros para el ejecutable. |

## Inyección de dependencias y pruebas

Toda la CLI recibe un `CliContext` (`src/cli/context.ts`): sistemas de ficheros, parsers, extractor de PDF, renderer de Typst, instalador, proveedor de modelos, caché, reloj y assets. Las pruebas unitarias sustituyen cada pieza por un doble en memoria (`tests/helpers/memory-file-system.ts`) y exigen el 100 % de cobertura; las pruebas de aceptación ejecutan el binario real sobre un banco sintético. Detalle: [Pruebas](/developers/testing).

## Los cánones

| | Canon | En una frase |
|---|---|---|
| C1 | La IA sugiere, el usuario decide | Ninguna orden del co-piloto escribe en las fuentes; `apply` solo con tu marca. |
| C2 | Sin invención | Integridad semántica verificada por código: ni cifras ni entidades añadidas u omitidas. |
| C3 | Local por defecto | Solo loopback; remoto solo con `--provider` explícito. |
| C4 | Minimización y seudonimización | Sale lo mínimo, sin PII; `--show-payload` lo enseña. |
| C5 | Prompts transparentes | Versionados en `prompts/`; `--show-prompt`. |
| C6 | Salida validada | JSON con esquema; lo que no valida se rechaza. |
| C7 | Sin entrenamiento | Nada de lo tuyo entrena nada. |
| C8 | Determinismo razonable | Temperatura 0, semilla fija, caché local. |
| C9 | Inmutabilidad de la fuente | Solo `improve apply` escribe, con huella y `.bak`. |
| C10 | Verificación contextual | Políticas `strict` (logros) y `synthesis` (resumen). |
| C11 | Soberanía del usuario sobre los recursos | Coste estimado, confirmación, cancelación segura. |
| C12 | Validar el proceso, no el resultado | Con sistemas no deterministas se valida la estructura y la coherencia, no el texto exacto. |
| C13 | La prueba debe probarse a sí misma | Los arneses comprueban sus propias precondiciones y artefactos; la documentación se ejecuta. |
| C14 | El núcleo es el producto | El núcleo es su propia API; toda interfaz es un cliente. |
| C15 | La documentación es código verificable | Guías y tutoriales se generan y se ejecutan contra el producto real (`npm run docs:check`). |

Texto completo y contexto de cada canon: [Co-piloto de IA: diseño y principios](/design/llm-integration) §3. Historia y decisiones: [Arquitectura](/design/arquitectura) y el resto de [notas de diseño](/design/).
