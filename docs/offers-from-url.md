# T-8.5 · Ofertas desde URL y selector de ofertas del espacio de trabajo — PROPUESTA v1

| | |
|---|---|
| **Tarea** | T-8.5 [OFERTAS] Ingesta desde URL (Hito 8, `ROADMAP.md`) |
| **Estado** | PROPUESTA v1 (2026-08-30) **APROBADA** por el Director de Ingeniería y Producto el 2026-08-30 (ocho decisiones de §10 aprobadas; T-8.5 tiene prioridad sobre T-8.4b; versión 1.7.0); S0 hecho (siete URL del Director, seis descargadas); **S1 (núcleo) implementado y verificado en vivo el 2026-08-30** (§11); quedan S2 (API+GUI) y S3 |
| **Origen** | Requisitos del Director del 2026-08-30 durante las pruebas con datos reales: «la oferta debe aceptar también URL» y «en Analizar oferta del espacio de trabajo debería salir un selector de las opciones disponibles» |
| **Versión prevista** | 1.9.0 (menor; la 1.8.0 del 2026-08-30 recoge T-8.6 S1–S3, T-8.8 a T-8.13 y el catálogo de 27 temas sin esperar a las seis páginas reales de ofertas; decisión original del PO del 2026-08-30: la 1.7.0 recoge lo entregado ese día —temas, selección explícita, historial de ofertas, modelos de Groq—) |

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
| `POST /api/v1/offers/fetch` `{ url }` | `403 remote-disabled` sin `--allow-remote`; `409 consent-required` con `{ estimateId, host, limitBytes }`; con `{ url, consent: { estimateId } }` → `200 { text, title?, company?, location?, source, warnings, origin: { url, fetchedAt, kind, bytes } }`. Sin efectos secundarios; el `estimateId` es de un solo uso y caduca |
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

## S0 · Corpus real (2026-08-30)

Páginas facilitadas por el Director (siete URL; las copias HTML viven en `build/offers-corpus/`, fuera del repositorio por ser
contenido de terceros; las pruebas usarán réplicas sintéticas con la misma estructura):

| # | Portal | Oferta | Descarga (curl, UA de navegador) | JSON-LD | Descripción JSON-LD | Texto visible |
|---|---|---|---|---|---|---|
| 1 | LinkedIn (vista pública) | Backend Software Engineer – Golang (BETWEEN Group) | 200 · 293 KB | `JobPosting` | 342 palabras | 1957 palabras |
| 2 | LinkedIn (vista pública) | Senior Back-End Engineer (Preply) | 200 · 300 KB | `JobPosting` | 1090 palabras | 2704 palabras |
| 3 | Jobgether | Banking Customer Agent (Skillmatch) | 200 · 196 KB | `BreadcrumbList` + `JobPosting` | 335 palabras | 1974 palabras |
| 4 | Jobgether | Senior Quality Assurance Engineer (Trading 212) | 200 · 205 KB | `BreadcrumbList` + `JobPosting` | 446 palabras | 2245 palabras |
| 5 | Jobgether | Security Engineer – Product | **503** en tres intentos (oferta retirada o protección) | — | — | — |
| 6 | Manfred | Product Manager (Valsea Technologies) | 200 · 279 KB | `JobPosting` | 106 palabras | 2442 palabras |
| 7 | Manfred | Performance Marketing Specialist (Topcar) | 200 · 272 KB | `JobPosting` | 69 palabras | 2631 palabras |

Conclusiones para S1:

1. **Primera vía: JSON-LD `JobPosting`** (schema.org), presente en las seis páginas descargadas: `title`, `hiringOrganization.name`,
   `description` (HTML), y en algunos portales `datePosted`, `jobLocation`, `employmentType`, `baseSalary`. Es determinista y no
   depende del DOM del portal.
2. **Segunda vía: texto visible principal**, porque la descripción del JSON-LD puede ser un resumen (Manfred: 69–106 palabras frente
   a 2400+ visibles). Regla propuesta: si la descripción tiene menos de ~250 palabras, completar con el bloque de texto más largo
   del cuerpo (excluyendo `nav`, `header`, `footer`, `script`, `style` y listas de ofertas relacionadas), sin superar el límite de
   tamaño de la ingesta.
3. `og:title`/`og:description` existen en todas y sirven de tercera vía (portales sin JSON-LD).
4. Las páginas pesan 200–300 KB de HTML: el límite de descarga de 2 MB de la propuesta es holgado; el consentimiento debe citar host y
   tamaño como ya hace la instalación de temas.
5. LinkedIn sirve la vista pública sin sesión con un `User-Agent` de navegador; sin él devuelve otra página. La cabecera se fija
   en el extractor y se documenta.

## S1 · Plan concreto (2026-08-30, para la puerta del PO) — APROBADO; núcleo implementado el 2026-08-30 (extractor + descarga + CLI; véase §11)

Sobre las ocho decisiones aprobadas de §10 y las conclusiones de §S0:

1. **Cerrar §4.6 primero** (resto del S0): corpus versionado en `tests/offers/corpus/` con 6 páginas sintéticas (JSON-LD completo; JSON-LD con descripción corta tipo Manfred; `main`/`article` sin JSON-LD; sin semántica; entidades y `charset`; SPA vacía) y 3 réplicas anonimizadas de las familias reales (LinkedIn/Jobgether/Manfred: misma estructura, texto inventado), más el arnés de calidad con umbrales fijados antes de medir (título y empresa exactos donde la página los declara; ≥ 95 % de las palabras del cuerpo de la oferta presentes en el texto extraído; 0 palabras de navegación/pie en las sintéticas).
2. **Cascada fijada por la evidencia de §S0**: (1) JSON-LD `JobPosting` (título, empresa, lugar, fecha; `description` HTML → texto); (2) si la descripción queda por debajo de ~250 palabras, se completa con el bloque principal del cuerpo (`htmlToText` + selección del bloque más largo excluyendo `nav`/`header`/`footer`/`aside` y listas de ofertas relacionadas), marcado con su procedencia; (3) `og:title`/`og:description`/`<title>` como reserva. `source` visible en `--explain` y en la API.
3. **`src/offers/extract.ts` + `fetch.ts`** según §4.1–§4.2 (https solo, UA de navegador documentado —la vista pública de LinkedIn lo exige, §S0.5—, `accept-language` del perfil, 2 MB / 15 s, SSRF con resolutor inyectado, redirecciones ≤ 5 a https).
4. **CLI** según §4.3: URL en `analyze-offer` y `generate-cv -f` con `--allow-remote` + confirmación por petición, `--save-offer` con cabecera de origen, listado de `offers/**`, `--explain` con procedencia; arnés `offer-url-*` con `Fetcher` doble (sin red).
5. **Pruebas**: 100 % de `src/offers/**`; el arnés de calidad del corpus como prueba (umbrales = asserts); verificación en vivo final con tres de las URL reales de §S0 anotada en §11.
6. S2 (API + GUI) y S3 (guías, tutorial, release 1.9.0) quedan como en §9, con las tres rutas de §4.4 y el selector/modo URL de §4.5.

Petición al PO: conformidad con este plan de S1 (incluido cerrar §4.6 dentro de S1 y el umbral de 250 palabras para completar la descripción del JSON-LD).

### S1 · Estado (2026-08-30, noche)

- Hecho: corpus `tests/offers/corpus/` (6 sintéticas + 3 réplicas) con el arnés de calidad §4.6 (umbrales como asserts); `src/offers/extract.ts` (tokenizador, JSON-LD también en listas/`@graph`, cascada con la regla ×1,5 sobre el umbral de 250 palabras, `og:*`/`<title>`, avisos) y `fetch.ts` (https, SSRF con resolutor inyectable y salto de DNS para IP literales, 2 MB/15 s, redirecciones re-validadas, UA de navegador exportado y probado contra un servidor local, HTML/PDF/texto); CLI: URL en `analyze-offer` y `generate-cv -f` con `--allow-remote` + confirmación (o `--yes`), `--save-offer [ruta]` con cabecera de origen y `--replace`, listado de `offers/**` sin argumento o con `--list`; 100 % de `src/offers/**` y pruebas de la CLI con el doble de red; escenario `offer-url` en el arnés (rutas de negativa y listado, sin red).
- **Verificación en vivo (2026-08-30, una persona + registro íntegro en la sesión; §5)**, desde una copia del banco fuera del repositorio, `--allow-remote --yes`:
  1. `es.linkedin.com` (Backend Software Engineer – Golang, BETWEEN Group): 345.094 bytes, HTML, **procedencia json-ld**; 7 requisitos reconocidos, adecuación 7/7 (100 %), imprescindibles 7/7.
  2. `jobgether.com` (Senior QA Engineer, Trading 212): 210.896 bytes, HTML, **procedencia json-ld**; 6 requisitos, adecuación 6/6 (100 %).
  3. `getmanfred.com` (Product Manager, Valsea Technologies): 287.133 bytes, HTML, **procedencia json-ld+cuerpo** con el aviso esperado («la descripción del JSON-LD tiene 106 palabras; el cuerpo se toma del contenido de la página (1703)»); 9 requisitos, adecuación 8/9 (89 %), imprescindibles 1/1.
- **S2 IMPLEMENTADO (31-ago)**: las tres rutas de §4.4 (`GET /offers` con tipo y orden; `POST /offers/fetch` con 403/409-consentimiento de un solo uso —`ConsentStore`, 10 min— y descarga única con procedencia; `POST /offers` saneado con cabecera de origen y 409 salvo `replace`) con pruebas contra servidor real; en Generar, selector de `offers/` con «Recargar» y pestaña «URL» → diálogo de consentimiento (host, límite, «sin cookies ni datos tuyos») → texto editable en «Texto» con procedencia/avisos → «Guardar en offers/…» con «Sustituir» ante conflicto. `origin.kind` en vez de `contentType` (el vocabulario real del extractor: html | texto | pdf). El listado se movió a `src/app/offer.ts` (mismo límite ≤3 niveles/≤500).
- Pendiente: S3 según §9.
