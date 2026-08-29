# API headless: `cv serve`, la capa de casos de uso y el contrato para los clientes

| | |
|---|---|
| **Tarea** | T-7.4 · [API] Diseño de la API headless (Hito 7, pilar 3); base de T-7.5 (GUI) |
| **Estado** | PROPUESTA v1 (2026-08-29) **APROBADA en su totalidad** por el Director de Ingeniería y Producto el 2026-08-29, con las ocho decisiones de §11. T-7.4a (S1–S3) y T-7.4b (S4–S6) **entregadas y aprobadas** por el Director el 2026-08-29 (§12). |
| **Autor** | Claude (Director Técnico) |
| **Base** | Plan estratégico del Hito 7 y observaciones registradas en el ROADMAP (modelo de amenazas de `cv serve`, identificadores en lugar de rutas, consentimiento C11 en la GUI, clarificación de C9); cánones C3, C9, C11, C14 y C15; `src/cli/` (comandos sobre `CliContext` inyectable y ayudantes compartidos); `docs/docker.md` (la imagen ya está preparada para un servicio de larga duración). |

## 0. Resumen ejecutivo

- **El núcleo es el producto (C14), y su API son los casos de uso**: una capa `src/app/` con funciones puras de orquestación —`generateCv`, `analyzeOffer`, `buildProfile`, `improve`…— que reciben el `CliContext` y devuelven **datos**, nunca texto ni códigos de salida. La CLI (en proceso) y el servidor HTTP son dos clientes de esa misma capa; la CLI conserva su salida y sus códigos byte a byte (el arnés determinista es la red de seguridad).
- **`cv serve`**: un servidor HTTP local sobre `node:http` (sin dependencias nuevas en el binario), solo en `127.0.0.1`, con **token de sesión** obligatorio, comprobación de `Host` y `Origin` (anti-CSRF y anti-*DNS rebinding*), sin CORS, recursos por **identificador dentro del espacio de trabajo** (nunca rutas del cliente), consentimiento explícito para proveedores remotos, y las operaciones largas del co-piloto como **trabajos** con progreso por SSE. Un espacio de trabajo por servidor; sin usuarios ni sesiones múltiples (fuera de alcance, por decisión estratégica).
- **La CLI no se adelgaza**: sigue siendo autónoma y en proceso. Un «cliente delgado» por HTTP haría depender cada orden de un demonio, añadiría latencia y superficie de red y rompería el ejecutable único; C14 se cumple por la capa compartida, no por el transporte (§9).
- **Contrato** (§5): `/api/v1/…` en JSON con errores tipificados; PDF servido como fichero de `output/`; escritura en las fuentes solo por acción explícita del usuario con concurrencia optimista (huella), que es la clarificación de C9 para la GUI; la referencia de la API se **genera** desde el registro de rutas y sus esquemas zod (C15).
- **Entrega en dos partes**: T-7.4a (capa de casos de uso, servidor y endpoints deterministas) y T-7.4b (trabajos del co-piloto, revisiones, consentimiento, Docker y documentación). Versión **1.1.0**.

## 1. Objetivo y alcance

Exponer la lógica central para clientes distintos de la CLI —primero la GUI web del MVP (T-7.5)— sin duplicarla ni relajar las garantías del producto: local, sin invención, fuentes del usuario intocables salvo por su acción, consentimiento para cualquier salida a la red.

Dentro: capa de casos de uso, servidor `cv serve`, contrato de la API para todo lo que la GUI MVP necesita (explorar y editar las fuentes, validar y compilar, generar, analizar ofertas, co-piloto con revisiones y aplicación, temas, estado), seguridad, pruebas, documentación y superposición de Compose. Fuera: la GUI (T-7.5), multiusuario y autenticación de personas (visión posterior), acceso remoto (el servidor no escucha fuera de loopback), Windows/macOS más allá de lo que ya cubre el ejecutable.

## 2. Situación de partida (lo que ya existe)

- Cada comando es `run<X>(context: CliContext, options): Promise<number>`: orquesta ayudantes compartidos (`prepareSelection`, `readOfferText`, `artifactStatus`/`warnIfStale`, `defaultOutputPath`, `loadDatasetOrReport`, `indexSources`, `parseReview`, `consentToRemote`…) y escribe por `context.stdout`/`context.stderr`. El `CliContext` ya inyecta sistemas de ficheros, parsers, extractor de PDF, renderer de Typst, proveedor de modelos, caché, reloj y assets: es la base de un servidor sin globales.
- Lo que falta es la separación entre **decidir/calcular** (datos) y **presentar** (texto y códigos): hoy `runGenerateCv` calcula la selección, renderiza y escribe el fichero mientras imprime informes. La API necesita esos mismos pasos devolviendo estructuras.

## 3. Capa de casos de uso: `src/app/`

Una función por caso de uso, sin `stdout`, sin `process`, sin códigos de salida:

```ts
// src/app/generate.ts
export interface GenerateRequest { specialty?: string; offer?: OfferInput; limits: LimitOptions; format: 'md' | 'pdf'; engine: 'pdfkit' | 'typst'; theme?: string; locale?: string; template?: TemplateInput; explain: boolean }
export type GenerateResult =
  | { ok: true; output: { name: string; kind: 'md' | 'pdf'; bytes: Uint8Array }; report: GenerateReport; warnings: string[] }
  | { ok: false; error: AppError };
export async function generateCv(context: AppContext, request: GenerateRequest): Promise<GenerateResult>;
```

- `AppContext` es el `CliContext` menos `stdout`/`stderr`/`stdin`/`confirm` (lo que solo tiene sentido en una terminal). La CLI lo construye como hoy; el servidor, una vez por espacio de trabajo.
- `AppError` tipifica lo que hoy son mensajes y códigos: `invalid-data` (→ CLI 1 / HTTP 422), `not-found` (404), `conflict` (409: artefacto obsoleto, revisión sin marcas, huella cambiada), `environment` (→ CLI 2 / HTTP 503: Typst ausente, proveedor no responde), `consent-required` (→ CLI cancela / HTTP 409 con la estimación), `unsafe-path` (400).
- Los informes que hoy son texto (`formatSelectionReport`, `formatMatchReport`, `formatTrimReport`, «Tema: …») pasan a ser estructuras (`GenerateReport`) con **formateadores** en la CLI que producen exactamente el texto actual: la diferencia entre la CLI de hoy y la de mañana es cero bytes en las 77 salidas del arnés.
- Casos de uso del MVP: `inspectWorkspace` (estado, frescura, temas, Typst, modelo), `listSources`/`readSource`/`writeSource`, `validateSources`, `buildProfile`, `loadProfile`, `generateCv`, `analyzeOffer`, `extractOfferText` (PDF), `improve`, `summarize`, `suggestTags`, `listReviews`/`readReview`/`writeReview`/`applyReview`, `listThemes`/`createTheme`. Cada comando de la CLI migra a su caso de uso conforme se extrae; los que no necesita la GUI (`init`, `typst install`) se quedan como están.
- Entradas que hoy son rutas (`-f oferta.pdf`, `-t plantilla.hbs`, `improve apply <revisión>`) se modelan como **uniones**: `{ text }` | `{ workspaceFile: 'offers/acme.txt' }`; el servidor solo acepta la segunda forma con identificadores relativos y saneados; la CLI acepta además rutas absolutas y stdin, como hoy.

## 4. El servidor: `cv serve`

```bash
cv serve                         # http://127.0.0.1:4310/  (imprime la URL con el token y, con --open, abre el navegador)
cv serve --port 0 --api-only     # puerto efímero, sin interfaz estática (para pruebas y clientes propios)
cv serve --host 0.0.0.0          # solo dentro de un contenedor cuyo puerto publique Docker en 127.0.0.1 del anfitrión (§7)
```

- **Transporte**: `node:http` con un enrutador propio (método + patrón de ruta con parámetros, ≈ 150 líneas, cubierto al 100 %) y validación de cuerpos con **zod** (ya en el binario). Ninguna dependencia nueva: el servidor viaja en el mismo ejecutable y en la misma imagen. Si el enrutador creciera, Hono (sin dependencias, sobre `node:http`) sería el sustituto natural; Fastify (≈ 50 paquetes) queda descartado.
- **Ciclo de vida**: el servidor se liga a un espacio de trabajo (`cwd` o `--workspace <dir>`) al arrancar; construye un `AppContext` una vez; cachea el artefacto validado con invalidación por huella; se para con Ctrl-C o `POST /api/v1/shutdown`.
- **Estático**: sirve la GUI (T-7.5) desde la capa de assets (`gui/…`, embebida como los temas); hasta entonces, una página mínima con el estado y la URL de la documentación. `--api-only` la desactiva.
- **Registro de rutas** con metadatos (método, ruta, resumen, esquemas de petición y respuesta, si escribe, si necesita consentimiento): de él salen el enrutamiento, la validación y la **referencia generada** de la API (§8).

## 5. Contrato de la API (v1)

Prefijo `/api/v1`. JSON UTF-8; errores siempre `{ "error": { "code", "message", "details"? } }` con los códigos de `AppError`. Todas las rutas exigen `Authorization: Bearer <token>` (§6). Rutas que escriben en el espacio de trabajo marcadas con ✎.

| Método y ruta | Qué hace |
|---|---|
| `GET /status` | Versión, espacio de trabajo, estado del artefacto (`current`/`missing`/`outdated`), especialidades, Typst (utilizable, versión), proveedor local (responde, modelo), temas disponibles y tema por defecto. Nunca sale a la red. |
| `GET /sources` | Árbol de `data/sources`: ruta relativa, tipo, tamaño, fecha, `sha256`. |
| `GET /sources/{path}` | Contenido de un fichero de fuentes con su `sha256` (`ETag`). |
| `PUT /sources/{path}` ✎ | Escribe un fichero de fuentes (creación o sustitución). Exige `If-Match: <sha256>` del contenido actual (o `*` para crear): sin él o con huella distinta, 409 `conflict`. Escritura atómica, 0600, ruta saneada. **Es el usuario escribiendo sus fuentes** (§6, C9). |
| `POST /validate` | Problemas de las fuentes (fichero, línea, clave, mensaje). |
| `POST /build` ✎ | Compila el artefacto (`data/dist/profile.json`); devuelve resumen y problemas. |
| `GET /profile` | El perfil validado (artefacto) con ids de entidades y logros. |
| `POST /generate` ✎ | `GenerateRequest` (§3, oferta como `{ text }` o `{ workspaceFile }`, plantilla solo como fichero del espacio de trabajo); escribe `output/<nombre>` y devuelve `{ output: { name, kind, bytes? }, report, warnings }`. El Markdown va en línea; el PDF, por `GET /output/{name}`. |
| `GET /output` · `GET /output/{name}` | Lista y sirve los ficheros de `output/` (`application/pdf`, `text/markdown`). Solo nombres del propio directorio. |
| `POST /analyze-offer` | `{ offer: { text } \| { workspaceFile }, specialty?, explain? }` → el mismo JSON de `cv analyze-offer --json`. |
| `POST /offers/extract` | PDF en el cuerpo (`application/pdf`, ≤ 10 MiB) → texto extraído en el worker aislado, con los mismos límites que la CLI. |
| `POST /jobs/improve` · `/jobs/summarize` · `/jobs/suggest-tags` | Crean un **trabajo** con las mismas opciones que la CLI (sin rutas). Respuesta 202 `{ job, sending, warnings }` con `Location`; `sending` dice qué sale y a dónde (C3). Remoto sin `--allow-remote` → 403 `remote-disabled`; con él y sin consentimiento → 409 `consent-required` con la estimación de coste y un `estimateId` de un solo uso (§6). |
| `GET /jobs` · `GET /jobs/{id}` | Estado (`queued`, `running`, `done`, `failed`, `cancelled`), líneas de progreso y avisos, tiempos, y resultado (revisión escrita con huella y estadísticas; etiquetas por fragmento) o error tipificado. |
| `GET /jobs/{id}/events` | SSE: `status` con el trabajo completo al conectar y en cada cambio, `line` por cada línea de progreso (las mismas que la CLI imprime por stderr); se cierra al terminar. |
| `DELETE /jobs/{id}` | Cancela: en cola termina ya; en marcha, la `AbortSignal` aborta la petición en curso y el lote para; no se escribe la revisión. |
| `GET /reviews` · `GET /reviews/{name}` | Revisiones de `output/`: el fichero y su estructura (`parseReview`: cabecera, ítems, propuestas, veredictos, marcas). |
| `PUT /reviews/{name}` ✎ · `DELETE /reviews/{name}` ✎ | Guarda la revisión editada por el usuario (marcas `[x]`, retoques de texto) con `If-Match`; elimina una revisión. |
| `POST /reviews/{name}/apply` ✎ | `{ dryRun?, deleteReview? }` → lo mismo que `cv improve apply`: por defecto solo el plan (`dryRun: true`); con `dryRun: false`, ficheros escritos con su `.bak`; 422 con las líneas si no hay marcas o la huella cambió. |
| `GET /themes` · `POST /themes` ✎ | Inventario (origen, validez, por defecto) y creación (`{ name, from }`). |
| `POST /shutdown` | Detiene el servidor (la GUI lo usa al cerrar). |

Reglas transversales: paginación innecesaria (un espacio de trabajo); `Cache-Control: no-store`; `ETag`/`If-Match` en todo lo editable; las operaciones ✎ requieren `Content-Type: application/json` (o el PDF en `offers/extract`); nunca se devuelven claves ni rutas absolutas del sistema; las respuestas de estado del modelo remoto muestran la procedencia de la clave, como la CLI, nunca su valor.

## 6. Seguridad: modelo de amenazas de un servidor local

Pasar de «sin red» a un servidor HTTP —aunque sea en loopback— cambia el modelo de amenazas: cualquier pestaña del navegador puede intentar hablar con `127.0.0.1`. Diseño:

| Amenaza | Control |
|---|---|
| Acceso desde otras máquinas | Solo `127.0.0.1` (y `::1`) por defecto; `--host` explícito y documentado para Docker (§7). |
| Otra web hace peticiones a `127.0.0.1:4310` (CSRF) | **Token de sesión** de 256 bits generado al arrancar, entregado al navegador en el fragmento de la URL (`#token=…`, que nunca viaja en peticiones ni queda en registros); el cliente lo envía como `Authorization: Bearer`. Sin CORS (ninguna cabecera `Access-Control-Allow-*`): un origen ajeno no puede leer respuestas ni enviar la cabecera sin un *preflight* que se rechaza. |
| *DNS rebinding* (un dominio ajeno que resuelve a 127.0.0.1) | Comprobación estricta de `Host` (solo `127.0.0.1:<puerto>`, `localhost:<puerto>` o los de `--allowed-hosts`) y de `Origin` en toda petición que escribe: distinto del propio origen → 403. |
| Rutas del cliente hacia el sistema de ficheros | La API no acepta rutas: identificadores relativos al espacio de trabajo, normalizados y verificados (sin `..`, sin absolutos, sin enlaces simbólicos hacia fuera; las mismas reglas que el cargador del dataset y que `improve apply`). |
| Escritura de fuentes desde la GUI (C9) | Solo `PUT /sources/{path}` y `PUT /reviews/{name}` con `If-Match`: es el usuario editando, por acción explícita; la IA nunca escribe; `apply` exige marcas. `.bak` como en la CLI cuando `apply` sustituye. |
| Salida a proveedores remotos (C3, C11) | El servidor arranca con los proveedores remotos **desactivados** salvo `--allow-remote`; aun así, cada trabajo remoto pasa por el doble paso `consent-required` → estimación → reenvío con `consent: { estimateId }`. Nunca `--yes` implícito. |
| Fuga de datos en registros | El servidor registra método, ruta, código y duración; nunca cuerpos, tokens ni contenido de fuentes. |
| Agotamiento (PDF grandes, muchos trabajos) | Límites de cuerpo (1 MiB JSON, 10 MiB PDF), un trabajo del co-piloto en ejecución a la vez, tiempos máximos por petición; los del worker de PDF y de Typst se heredan. |
| Token en la barra de direcciones | El fragmento no se envía al servidor ni aparece en `Referer`; la GUI lo guarda en memoria (no en `localStorage`) y lo elimina de la URL al cargar. |

`cv serve` nunca se arranca solo: es una orden explícita del usuario, como el resto.

## 7. Docker

`compose.serve.yml` (superposición): `command: ["serve", "--host", "0.0.0.0", "--port", "4310"]`, `ports: ["127.0.0.1:4310:4310"]` (publicado solo en el loopback del anfitrión), `--allowed-hosts localhost:4310,127.0.0.1:4310`; el token se imprime en los registros del contenedor (`docker compose logs`). Compatible con `compose.ai.yml` (el servidor comparte el espacio de red de Ollama y publica su puerto desde ahí). Es el primer uso de la imagen como servicio de larga duración, previsto en T-7.2.

## 8. Pruebas y documentación (C12, C13, C15)

- **Unitarias**: casos de uso y servidor con el `AppContext` en memoria; 100 % de cobertura (enrutador, autenticación, comprobaciones de `Host`/`Origin`, saneado de identificadores, trabajos, SSE, errores).
- **Integración**: el servidor real en un puerto efímero sobre una copia temporal del banco de pruebas, con `fetch` (Node): el contrato completo, incluidas las respuestas de error, el flujo de consentimiento y la cancelación de trabajos (con un proveedor falso).
- **Paridad CLI–API**: para cada caso de uso, una prueba que ejecuta la misma petición por los dos clientes y compara los datos; el arnés determinista sigue exigiendo 77 pasos idénticos (la CLI no cambia de salida).
- **Aceptación**: escenario `serve` en el arnés determinista (arranca el servidor con `--port 0 --api-only`, ejecuta una secuencia fija con un cliente mínimo y compara las respuestas normalizadas byte a byte para los endpoints deterministas).
- **Documentación**: `docs/api-headless.md` (esta nota, con §11 de estado), guía «La API local (`cv serve`)» y **referencia generada** desde el registro de rutas y los esquemas zod (`scripts/docs/api.ts` → `/reference/api`, como la referencia de la CLI); tutorial 6 con bloques ejecutables (`cv serve --port 0 --api-only` y peticiones con `curl`).

## 9. El «cliente delgado», analizado

| | A · CLI en proceso + capa compartida (recomendada) | B · CLI delgada por HTTP |
|---|---|---|
| C14 | Cumplido: CLI y API son clientes de `src/app/`. | Cumplido, a costa de un demonio. |
| Ejecutable único, scripts y CI | Intacto: `cv build` en un *hook* de git o en la CI no necesita nada más. | Cada orden exige `cv serve` en marcha (o arrancarlo y pararlo por orden). |
| Latencia y superficie | Cero red. | Un servidor HTTP abierto siempre que se usa la CLI; puertos, tokens, ciclo de vida. |
| Paridad de comportamiento | Garantizada por la capa compartida y las pruebas de paridad. | Garantizada solo si la API cubre el 100 % de las opciones (stdin, rutas absolutas, `--yes`…). |
| Arnés de aceptación | Sin cambios (77 pasos byte a byte). | Hay que orquestar el demonio en cada escenario. |
| Coste | Extracción incremental. | Reescritura de la CLI. |

Recomendación firme: **A**. Si en el futuro un servicio (visión multiusuario) exige que *todos* los clientes pasen por HTTP, la capa `src/app/` es la costura ya preparada; la CLI podría entonces ganar un modo `--remote <url>` sin perder el modo en proceso.

## 10. Plan de ejecución

| Paso | Contenido | Verificación |
|---|---|---|
| **T-7.4a** S1 | `src/app/`: `AppContext`, `AppError`, casos de uso deterministas (`inspectWorkspace`, fuentes, `validateSources`, `buildProfile`, `loadProfile`, `generateCv`, `analyzeOffer`, `extractOfferText`, temas); la CLI migra a ellos con formateadores que reproducen su salida. | Arnés determinista 77/77 sin cambios; 100 % cobertura. |
| S2 | `src/serve/`: enrutador, registro de rutas, validación zod, token, `Host`/`Origin`, envoltura de errores, estático, `cv serve` (`--port`, `--host`, `--open`, `--api-only`, `--workspace`, `--allowed-hosts`, `--allow-remote`). | Unitarias; integración del contrato determinista. |
| S3 | Endpoints deterministas (§5, sin `jobs`, `reviews`); `GET /output/{name}`. | Integración; escenario `serve` del arnés. |
| **T-7.4b** S4 | Trabajos (`improve`, `summarize`, `suggest-tags`), SSE, cancelación, consentimiento en dos pasos, revisiones (`GET`/`PUT`/`apply`). | Integración con proveedor falso; una pasada real con Qwen2.5-7B (C12). |
| S5 | `compose.serve.yml`; guía, tutorial 6 y referencia generada de la API; CHANGELOG; versión 1.1.0. | `docs:check`; humo de Docker ampliado. |
| S6 | Cierre: ROADMAP, §11 de esta nota, informe. | Suite y arneses en verde. |

Estimación: la tarea más grande del proyecto hasta ahora; la división en a/b permite entregar y aprobar la mitad determinista antes de tocar el co-piloto.

## 11. Decisiones que se piden al Director

1. **Arquitectura A** (CLI en proceso + capa `src/app/` compartida) frente a B (CLI delgada por HTTP). Recomendada: A.
2. **`node:http` con enrutador propio** (sin dependencias nuevas) frente a Hono o Fastify. Recomendado: `node:http`; Hono como sustituto si el enrutador crece.
3. **Autenticación por token de sesión** en el fragmento de la URL + `Bearer` (recomendada) frente a sin autenticación (rechazada) o cookie de sesión.
4. **Edición de fuentes por la API** con `If-Match` como acción explícita del usuario: clarificación de C9 para la GUI. Recomendado: sí.
5. **Proveedores remotos desactivados en `cv serve` salvo `--allow-remote`**, y consentimiento en dos pasos por trabajo. Recomendado: sí.
6. **Trabajos asíncronos con SSE** para el co-piloto (recomendado) frente a peticiones síncronas largas.
7. **División en T-7.4a y T-7.4b** y versión **1.1.0** al cerrar la b. Recomendado: sí.
8. **Referencia de la API generada** desde el registro de rutas y zod (C15). Recomendado: sí.

## 12. Estado de la implementación

- **T-7.4a S1 (2026-08-29)**: capa de casos de uso `src/app/` entregada: `AppContext` (el `CliContext` sin terminal; `CliContext` lo extiende), `AppError` tipificado con código de salida, y los casos deterministas `loadSources`/`buildProfile`/`loadProfile`, `readOffer` (texto, lector diferido o fichero), `tailorProfile`/`tailorWithOffer`, `generateCv` + `writeCvFile` (informe estructurado en lugar de texto), `analyzeOffer` + `analysisPayload`, `themeInventory`/`themeDirectory`/`createTheme`, `listSources`/`readSource`/`writeSource` (huella SHA-256 e `If-Match`, escritura atómica 0600), `inspectWorkspace`; `validate`, `build`, `generate-cv`, `analyze-offer`, `theme` y la preparación de los comandos del co-piloto migrados a la capa con formateadores que reproducen su salida. **Verificación**: arnés determinista **77/77 idénticos** (cero bytes de diferencia), 638 pruebas con el 100 % de cobertura (`src/app` incluido en el umbral), typecheck. Pendiente en T-7.4a: S2 (servidor `src/serve/` y `cv serve`) y S3 (endpoints deterministas y escenario de aceptación).
- **T-7.4a S2–S3 (2026-08-29)**: entregados. `src/serve/`: enrutador propio (patrones `{x}` y `{x+}`, registro de rutas con metadatos para la referencia generada), token de sesión de 256 bits comparado en tiempo constante, `Host` restringido al loopback en sus tres grafías (y `--allowed-hosts`), `Origin` obligatoriamente propio en las escrituras, **sin CORS**, cuerpos acotados (1 MiB JSON, 10 MiB PDF; 413 sin cortar la conexión salvo abuso), cabeceras `no-store`/`nosniff`/CSP, errores `{ error: { code, message, lines? } }` con la correspondencia 400/401/403/404/405/409/413/422/428/503, y los **15 endpoints deterministas** de §5 (sin `jobs` ni `reviews`): estado, fuentes (árbol con huellas, lectura con `ETag`, `PUT` con `If-Match`), validar, compilar, perfil, generar (Markdown en línea; PDF escrito y servido por `GET /output/{name}`), salida, análisis de ofertas, extracción de PDF, temas y apagado. `cv serve` (`--port`, `--host`, `--workspace`, `--api-only`, `--open`, `--allowed-hosts`) con página mínima en `/` hasta la GUI. **Verificación**: 666 pruebas con el 100 % de cobertura (unitarias del enrutador, la seguridad y las piezas HTTP; integración con el servidor real sobre un disco en memoria —seguridad, contrato completo, errores, apagado—; `cv serve` a través de commander con un servidor real); **escenario `serve` del arnés determinista** (un cliente mínimo arranca `cv serve --port 0 --api-only` con el binario bajo prueba, ejecuta 25 peticiones fijas y sus respuestas normalizadas se comparan byte a byte): 9 escenarios y 78 pasos idénticos tanto con `dist/` como **contra el ejecutable empaquetado**; `docs:check` en verde con la referencia de `cv serve` generada. Pendiente: T-7.4b.
- **T-7.4b (2026-08-29)**: entregada. **S4** — `src/app/copilot.ts`: los casos de uso del co-piloto en tres pasos (planificar sin red → proveedor, salud y estimación → ejecutar con progreso y `AbortSignal`), `src/app/review.ts` (`applyReview`, `listReviews`, `readReview`) y `src/app/provenance.ts`; `improve`, `summarize`, `suggest tags` y `improve apply` migrados como clientes delgados **sin cambiar un byte de su salida** (arnés 78/78). La señal de cancelación atraviesa el cliente HTTP (código `cancelled`, combinado con el tiempo máximo mediante `AbortSignal.any`), los proveedores, las tareas y los lotes (un ítem abortado no se anota como fallo; el lote para). **S5** — `src/serve/jobs.ts` (cola en memoria, de uno en uno, histórico de 50, suscripción que repite el estado y sigue en directo, `idle()` para el cierre), `src/serve/consent.ts` (consentimiento en dos pasos: `estimateId` de un solo uso, por tarea, diez minutos), respuesta en flujo en el enrutador y el servidor (SSE con cabeceras de seguridad), rutas `GET /jobs`, `POST /jobs/{improve,summarize,suggest-tags}` (202 + `Location` + `sending`), `GET/DELETE /jobs/{id}`, `GET /jobs/{id}/events`, `GET /reviews`, `GET/PUT/DELETE /reviews/{name}`, `POST /reviews/{name}/apply` (plan por defecto); `cv serve --allow-remote`; el cierre del servidor cancela los trabajos y espera hasta dos segundos su estado final. Códigos nuevos: `remote-disabled` (403) y `consent-required` (409). **S6** — referencia de la API generada desde `createRouter().specs()` y los esquemas zod (`scripts/docs/api.ts` → `/reference/api`, C15), guía «La API local (cv serve)», tutorial 6 ejecutable (servidor en segundo plano y `curl`; el trabajo real del co-piloto en un bloque `needs-llm`), `compose.serve.yml` y `compose.serve-ai.yml`, CHANGELOG y versión 1.1.0. **Verificación**: 698 pruebas con el 100 % de cobertura (cola, consentimiento, rutas de trabajos con SSE real, cancelación con proveedor lento, consentimiento remoto, revisiones y `apply` sobre la fixture, cierre con trabajo en marcha); arnés determinista 78/78 con 35 respuestas fijas en el escenario `serve` (trabajos y revisiones sin modelo); `docs:check` con el tutorial 6; ejecución real del tutorial 6 y del arnés de IA con Qwen2.5-7B local (llama-server); dos carreras que solo aparecían en el runner de GitHub, reproducidas en `node:26-bookworm-slim` y corregidas (el cierre vacía los flujos SSE antes de cortar). **APROBADA por el Director el 2026-08-29** («aprobación total y sin reservas»).
