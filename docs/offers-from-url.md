# T-8.5 · Ofertas desde URL y selector de ofertas del espacio de trabajo — PROPUESTA v1

| | |
|---|---|
| **Tarea** | T-8.5 [OFERTAS] Ingesta desde URL (Hito 8, `ROADMAP.md`) |
| **Estado** | PROPUESTA v1 (2026-08-30) **APROBADA** por el Director de Ingeniería y Producto el 2026-08-30 (ocho decisiones de §10 aprobadas; T-8.5 tiene prioridad sobre T-8.4b; versión 1.7.0); S0 pendiente de las seis páginas reales que aporta Lucas |
| **Origen** | Requisitos del Director del 2026-08-30 durante las pruebas con datos reales: «la oferta debe aceptar también URL» y «en Analizar oferta del espacio de trabajo debería salir un selector de las opciones disponibles» |
| **Versión prevista** | 1.8.0 (menor; decisión del PO del 2026-08-30: la 1.7.0 recoge lo entregado ese día —temas, selección explícita, historial de ofertas, modelos de Groq—) |

## 0. Resumen ejecutivo

Hoy una oferta llega al producto como texto pegado, PDF subido (texto extraído en local), fichero del espacio de trabajo o entrada estándar. Esta tarea añade dos cosas que pide el Director: (1) **una URL como origen de la oferta** —en `cv analyze-offer`, `cv generate-cv --from-job-offer`, la API y la pantalla Generar— con la primera salida a la red del producto fuera del co-piloto, y por tanto con **consentimiento explícito por petición**, sin cookies ni identidad del usuario, sin ejecutar JavaScript y sin navegador embebido; y (2) **un selector de las ofertas disponibles en el espacio de trabajo** (`offers/`) en la GUI y en la CLI, en lugar del campo de texto libre con la ruta. Lo descargado se convierte a texto por código (JSON-LD `JobPosting` si existe, si no el contenido principal del HTML, si no una heurística), se muestra al usuario y **solo se guarda en `offers/` si él lo pide**, con su origen anotado para que el análisis sea reproducible. Nada del núcleo cambia: la oferta sigue entrando como texto.

## 1. Objetivo y alcance

Dentro:

- `cv analyze-offer <fichero|url>` y `cv generate-cv -f <fichero|url>`: si el argumento es una URL `https`, descarga con consentimiento (`--allow-remote` y confirmación, o `--yes`), extrae el texto y continúa como hoy; `--save-offer [ruta]` guarda el texto en `offers/` con una cabecera de origen.
- `cv analyze-offer` sin argumento: lista las ofertas de `offers/` (ruta, tamaño, fecha) y termina con código 2 pidiendo elegir una (la CLI no es interactiva; la GUI sí).
- API: `GET /api/v1/offers` (listado de solo lectura de `offers/`), `POST /api/v1/offers/fetch` (descarga en dos pasos con consentimiento; sin efectos secundarios) y `POST /api/v1/offers` (guardar una oferta en `offers/`, acción explícita).
- GUI (Generar): el control «Oferta» pasa a cuatro modos: sin oferta · texto pegado o PDF subido · **fichero del espacio de trabajo (desplegable)** · **URL** (descargar con consentimiento, previsualizar, guardar opcionalmente).
- Extractor HTML → texto propio, sin dependencias, con pruebas al 100 % y un pequeño corpus de páginas reales anonimizadas.

Fuera (esta tarea): páginas que solo pintan la oferta con JavaScript (se detectan y se explica cómo pegar el texto), páginas con inicio de sesión, rastreo de listados, caché entre sesiones, envío de candidaturas, y cualquier navegador embebido (solo con evidencia de un spike posterior, como fija el ROADMAP).

## 2. Situación de partida

- `src/app/offer.ts`: `readOffer(context, input)` admite `{ text }`, `{ file }` (texto o PDF, detectado por extensión; PDF por el extractor endurecido de `src/pdf/`), `{ stdin }`; límite `OFFER_MAX_BYTES` = 1 MiB; el nombre de la oferta sale del fichero.
- API (`src/serve/contract.ts`): `OfferSchema = { text } | { workspaceFile }`; `POST /analyze` y `POST /generate` la reciben; la GUI extrae el PDF en el navegador con el mismo *worker* y envía texto.
- GUI (`gui/src/pages/Generar.svelte`): `offerMode` = `none | text | file`; el modo `file` es un `input` de texto con la ruta relativa.
- Red: solo el co-piloto remoto (lista blanca de hosts, `src/llm/http.ts`) y las descargas con consentimiento de Typst y de temas (`src/typst/download.ts`: `Fetcher` inyectable, `downloadToBuffer`, solo `https`, redirecciones seguras, tamaño y tiempo acotados, `user-agent: chameleon-cv`). El patrón de consentimiento en dos pasos ya existe (`ConsentStore`: `issue`/`redeem`, respuesta `409 consent-required` con `estimateId`, `403 remote-disabled` sin `--allow-remote`).
- `AppContext.fetcher` ya permite inyectar el transporte en pruebas y en el arnés de aceptación (determinista, sin red).

## 3. Principios de diseño

1. **C3 y C11**: ninguna petición de red sin una orden del usuario y su confirmación; la URL se descarga una vez, sin cookies, sin credenciales, con un `user-agent` neutro y sin reintentos silenciosos; el servidor solo admite URL con `--allow-remote`, como los temas.
2. **C9**: `offers/` no es fuente del perfil, pero sigue siendo del usuario: guardar la oferta descargada es una acción deliberada (`--save-offer`, botón «Guardar en offers/»), nunca automática.
3. **C2 y C6**: el texto extraído es literal (sin resumir, sin «arreglar»); metadatos (título, empresa, lugar) solo si la página los declara (JSON-LD, `<title>`, OpenGraph) y siempre marcados con su procedencia.
4. **C12 y C13**: la calidad del extractor se mide con un corpus versionado (páginas reales anonimizadas y sintéticas) y umbrales fijados antes de medir; las pruebas del extractor prueban también al arnés.
5. **C14**: el núcleo recibe texto; la URL es una capa de entrada. **C15**: la guía se ejecuta como tutorial con un `Fetcher` doble.
6. Seguridad primero (§7): SSRF, tamaño, tiempo, tipo de contenido y rutas dentro del espacio de trabajo.

## 4. Diseño

### 4.1 Extractor (`src/offers/`, puro, sin dependencias)

- `htmlToText(html)`: tokenizador tolerante (no un DOM completo): descarta `script`, `style`, `noscript`, `svg`, `template`, comentarios; salto de línea en bloques (`p`, `div`, `li`, `br`, `h1`–`h6`, `tr`, `section`…), viñeta en `li`, decodificación de entidades (tabla de las HTML5 más comunes + numéricas), colapso de espacios, límite de 200 000 caracteres.
- `extractOffer(html, url)` en cascada, con procedencia: (1) **JSON-LD `JobPosting`** (schema.org, lo usan la mayoría de portales y ATS: `title`, `hiringOrganization.name`, `jobLocation`, `datePosted`, `description` en HTML → texto); (2) **contenido principal**: `<main>`, `<article>` o el bloque con más texto una vez quitados `nav`, `header`, `footer`, `aside` y bloques con densidad de enlaces alta; (3) **heurística**: todo el texto visible. Devuelve `{ text, title?, company?, location?, postedAt?, source: 'json-ld' | 'main' | 'page', warnings }`; `warnings` incluye «página casi vacía: probablemente se pinta con JavaScript» cuando el texto útil es < 400 caracteres y hay indicios (`<noscript>`, `id="root"`, bundles).
- Tipos de contenido: `text/html` → extractor; `application/pdf` → `extractPdfText` (ya endurecido); `text/plain` y `text/markdown` → tal cual. Cualquier otro → error tipificado.

### 4.2 Descarga (`src/offers/fetch.ts`)

`fetchOffer(url, { fetcher, limits })` sobre `downloadToBuffer`: solo `https` (decisión §10.1), redirecciones ≤ 5 y siempre a `https`, `accept: text/html, application/pdf, text/plain`, `accept-language` del perfil, `user-agent: chameleon-cv/<versión> (+https://github.com/nunzi00/chameleon-cv)`, sin cookies, tiempo 20 s, tamaño 2 MiB (HTML/texto) o `OFFER_MAX_BYTES` × 8 (PDF). Antes de conectar se resuelve el host y se rechazan direcciones de loopback, privadas, de enlace local y metadatos de nube (SSRF); tras cada redirección se repite la comprobación. Errores tipificados: `insecure`, `blocked-host`, `network`, `http` (con el estado), `too-large`, `unsupported-type`, `empty` (con la pista de JavaScript).

### 4.3 CLI (`src/cli/commands/`)

- `analyze-offer <fichero|url>` y `generate-cv -f <fichero|url>`: la URL exige `--allow-remote`; sin `--yes`, imprime «Se descargará «<url>» (host <host>, máximo <n> bytes, sin cookies)» y pide confirmación por la entrada estándar (como `theme install`). Con `--save-offer [ruta]` escribe `offers/<slug-del-título-o-host>.txt` (o la ruta dada, siempre dentro de `offers/`) con cabecera `# Origen: <url> · descargado el <ISO> · <fuente>`; si existe, exige `--replace`.
- `analyze-offer` sin argumento: lista `offers/**` (`.txt`, `.md`, `.pdf`; ordenado por fecha) y sale con código 2; `--list` hace lo mismo con código 0.
- `--explain` muestra la procedencia del texto (JSON-LD, contenido principal o página) y las advertencias.

### 4.4 API (`src/serve/`)

| Ruta | Comportamiento |
|---|---|
| `GET /api/v1/offers` | Lista `offers/**` (profundidad ≤ 3, ≤ 500 entradas): `{ path, bytes, modifiedAt, kind: 'text' \| 'markdown' \| 'pdf' }`; ignora enlaces simbólicos que salgan del espacio de trabajo |
| `POST /api/v1/offers/fetch` `{ url }` | `403 remote-disabled` sin `--allow-remote`; `409 consent-required` con `{ estimateId, host, limitBytes }`; con `{ url, consent: { estimateId } }` → `200 { text, title?, company?, location?, source, warnings, origin: { url, fetchedAt, contentType, bytes } }`. Sin efectos secundarios; el `estimateId` es de un solo uso y caduca |
| `POST /api/v1/offers` `{ path, text, origin? }` | Guarda en `offers/` (ruta saneada, sin `..`, extensión `.txt` o `.md`); `409` si existe salvo `replace: true`; `201 { path }` |

`OfferSchema` de `POST /analyze` y `POST /generate` **no cambia**: la URL pasa antes por `/offers/fetch` (única frontera de consentimiento) y después se envía como `{ text }` o, si se guardó, como `{ workspaceFile }`.

### 4.5 GUI (Generar)

Modo «Fichero del espacio de trabajo»: un `<select>` alimentado por `GET /api/v1/offers` (con recarga y con el campo de texto como alternativa para rutas fuera de `offers/`). Modo «URL»: campo de URL + «Descargar»; con el servidor sin `--allow-remote`, el botón explica cómo arrancarlo; el `409` abre el diálogo de consentimiento ya existente (host, límite, «sin cookies ni datos tuyos»); al confirmar se muestra el texto extraído (editable) con su procedencia y advertencias, y una casilla «Guardar en offers/ como …» que llama a `POST /api/v1/offers`. Analizar y Generar usan el texto mostrado.

### 4.6 Medida de calidad (S0, dentro de la tarea, antes de fijar la cascada)

Corpus versionado en `tests/offers/corpus/`: 12 páginas —6 sintéticas que cubren JSON-LD, `main`/`article`, sin semántica, entidades y SPA vacía; 6 reales anonimizadas que aporte el Director (portales y ATS habituales: p. ej. LinkedIn, InfoJobs, Indeed, Greenhouse, Lever, Workday)— con la verdad (título, empresa, lugar y el bloque de requisitos). Umbrales fijados de antemano: ≥ 10 de 12 páginas con el bloque de requisitos recuperado al ≥ 90 % y ≥ 5 de 6 reales con título y empresa correctos. Si no se alcanza, la tarea se cierra con lo que sí funciona y un spike separado evalúa alternativas (navegador externo del usuario, `Readability`), nunca un navegador embebido sin esa evidencia.

## 5. Pruebas y verificación (C12, C13)

- Unitarias al 100 % de `src/offers/**` (tokenizador, entidades, cascada, advertencias, tipos de contenido, límites, SSRF con resolutor DNS inyectado, redirecciones), de las rutas nuevas (consentimiento, listado con `..`/enlaces simbólicos, guardado con rutas saneadas) y de la GUI (`gui/src/lib/offers/*`).
- Arnés de aceptación: casos `offer-url-*` con un `Fetcher` doble inyectado por `AppContext` (sin red), incluidos `--save-offer`, `--replace` y la lista sin argumento; caso GUI E2E con el servidor real y el mismo doble.
- Verificación en vivo antes de cerrar (una persona, C12): tres URL reales, anotadas en §11 con fecha, host y resultado.

## 6. Documentación (C15)

Guía nueva `guide/offers.md` (orígenes, consentimiento, `--save-offer`, cabecera de origen), actualización de `guide/web.md`, `guide/api.md`, `guide/cli.md` y del tutorial `three-offers.md` (ejecutable con el `Fetcher` doble); `docs/api-headless.md` (rutas y modelo de amenazas); CHANGELOG `[Unreleased]` → `[1.7.0]`.

## 7. Seguridad

SSRF (bloqueo de loopback, rangos privados, enlace local y `169.254.169.254`, comprobado también tras redirecciones), solo `https`, tamaño y tiempo acotados, tipos de contenido cerrados, sin ejecución de JavaScript, sin cookies ni cabeceras de identidad, token de consentimiento de un solo uso, rutas de lectura y escritura confinadas a `offers/`, texto tratado como dato (nunca como Markdown ejecutable en la GUI), sin telemetría: la URL solo aparece en la salida del usuario y en la cabecera de origen del fichero que él decide guardar.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Portales que solo pintan con JavaScript | detección + mensaje con la alternativa (pegar texto o guardar la página como PDF); evidencia del S0 para decidir si hace falta más |
| Anti-bot (403, desafíos) | error claro sin reintentos; el usuario pega el texto |
| Condiciones de uso de los portales | una descarga puntual iniciada por el usuario, sin rastreo ni almacenamiento automático |
| Codificación de caracteres | `charset` de la cabecera o `<meta>`, UTF-8 por defecto, `TextDecoder` con `fatal: false` y aviso |
| Extractor propio frente a bibliotecas maduras | corpus con umbrales (§4.6) y `source` visible; el Director decide (§10.2) |

## 9. Plan de ejecución

- **S0** (medio día): corpus y arnés de calidad (§4.6), extractor mínimo y tabla; informe intermedio si no se alcanzan los umbrales.
- **S1**: `src/offers/**` completo, `fetchOffer`, CLI (`analyze-offer`, `generate-cv -f`, `--save-offer`, lista) y arnés.
- **S2**: API (tres rutas), GUI (desplegable y modo URL), E2E, `api-headless.md`.
- **S3**: guías y tutorial, CHANGELOG, verificación en vivo, versión 1.7.0 y release por el flujo habitual.

## 10. Decisiones que se piden al Director

1. **Solo `https`** para las URL (recomendado: sí, como los temas; `http` se rechaza con mensaje).
2. **Extractor propio sin dependencias** con corpus y umbrales (recomendado) frente a incorporar `@mozilla/readability` y un DOM.
3. **`--allow-remote` obligatorio** para URL en CLI y API, con confirmación por petición (recomendado: sí, coherente con T-8.3).
4. **Guardar en `offers/` solo a petición**, con cabecera de origen (recomendado: sí).
5. **Listado limitado a `offers/`** (recomendado) frente a cualquier directorio del espacio de trabajo; el campo de texto libre se mantiene como alternativa.
6. **Sin navegador embebido** en esta tarea; solo un spike posterior con la evidencia del S0 (recomendado).
7. **Prioridad**: T-8.5 antes que T-8.4b (importación desde PDF, si el veredicto del spike es Go limitado) — recomendado, porque el Director la ha pedido durante las pruebas y no depende del spike.
8. **Versión 1.7.0** (menor).

## 11. Estado de la implementación

- 2026-08-30: PROPUESTA v1 redactada tras los dos requisitos del Director (URL como origen de la oferta y selector de ofertas del espacio de trabajo) durante las pruebas con el espacio de trabajo real; enviada al Product Owner junto con el informe final de T-8.4.
- 2026-08-30: **APROBADA** por el Director de Ingeniería y Producto: las ocho decisiones de §10 tal como se recomendaban (solo `https`, extractor propio con corpus y umbrales, `--allow-remote` obligatorio, guardado explícito en `offers/`, listado limitado a `offers/`, sin navegador embebido, **prioridad sobre T-8.4b**, versión 1.7.0, después reasignada a 1.8.0 por el PO). Confirmado que Lucas aporta las seis páginas reales del S0. Luz verde para implementar.
