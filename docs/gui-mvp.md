# La interfaz web (MVP): un cliente de la API, dentro del ejecutable

| | |
|---|---|
| **Tarea** | T-7.5 · [GUI] MVP de la interfaz web (Hito 7, pilar 3) |
| **Estado** | PROPUESTA v1 (2026-08-29) **APROBADA en su totalidad** por el Director de Ingeniería y Producto el 2026-08-29 con las diez decisiones de §10; T-7.5a **entregada y APROBADA** el 2026-08-30 (v1.2.0 publicada); T-7.5b **entregada** el 2026-08-30 (S4, S5 y S6 aprobados sprint a sprint; v1.3.0 preparada, etiquetado por orden del Director) |
| **Autor** | Claude (Director Técnico) |
| **Base** | `docs/api-headless.md` (T-7.4: capa `src/app/`, contrato `/api/v1` de 27 rutas, token de sesión, `Host`/`Origin`, sin CORS, trabajos con SSE, consentimiento en dos pasos); `docs/asset-layer.md` (`AssetStore`, prefijos que viajan en el ejecutable, materialización); `docs/docker.md` y `docs/ghcr-publication.md` (la imagen sirve `cv serve`); plan estratégico del Hito 7 en el ROADMAP; *spike* medido en esta máquina el 2026-08-29 (§2.3). |

## 0. Resumen ejecutivo

- La GUI es **un cliente más de la API** (canon C14): una aplicación de una sola página (SPA) en `gui/` —Vite 8, Svelte 5, TypeScript— que **viaja dentro del ejecutable y de la imagen** como un prefijo de *assets* y que `cv serve` sirve en `/` en lugar de la página mínima de hoy. Ni un solo caso de uso nuevo en el servidor: todo lo que la GUI hace ya existe en `/api/v1`.
- **Seis pantallas, una por tarea del usuario**: Estado, Fuentes (explorador y editor con guardado por `If-Match`), Generar (selección, oferta, formato, tema; visor de PDF integrado; informe de decisiones), Co-piloto (trabajos con progreso en directo y cancelación; consentimiento de coste para remotos), Revisiones (comparación antes/después con veredictos, marcas y aplicación con copia de seguridad) y Salidas.
- **La misma doctrina de seguridad y verificación**: token de sesión que nunca sale del navegador ni queda en la URL, CSP estricta sin código en línea, ningún recurso externo, la GUI nunca convierte en HTML el contenido del usuario; lógica de negocio en módulos puros con el 100 % de cobertura, componentes probados y **pruebas de extremo a extremo con Playwright contra `cv serve` real** (y contra el ejecutable en la release), con un doble local del proveedor de IA para el co-piloto (C12, C13).
- Paquete inicial medido: **12,6 KB gzip** de aplicación; el editor CodeMirror (175 KB gzip) se carga solo al abrir un fichero. Diez decisiones para el Director (§10) y ejecución en dos entregas: **T-7.5a** (editor y generación → versión 1.2.0) y **T-7.5b** (co-piloto y revisiones → 1.3.0).

## 1. Objetivo y alcance

**Objetivo**: que una persona sin terminal pueda mantener sus fuentes, generar su CV para una especialidad o una oferta, y usar el co-piloto revisando cada propuesta antes de aplicarla —todo en local, con la misma seguridad que la CLI—.

**Dentro**: paquete `gui/`; servicio de la SPA desde `cv serve` (ejecutable e imagen); sesión y seguridad en el navegador; las seis pantallas de §4.6; cliente tipado de la API y cliente SSE; pruebas unitarias, de componentes y E2E; guía de usuario con capturas generadas; versiones 1.2.0 y 1.3.0.

**Fuera** (registrado, no planificado): edición WYSIWYG del CV, reordenación por arrastre, multiusuario y despliegue remoto (la API no tiene CORS por diseño: la GUI solo existe servida por `cv serve`), internacionalización (es-ES, con las cadenas centralizadas para un futuro), edición de temas Typst desde la GUI (solo crear a partir de otro), borrado de fuentes (la API no lo expone; se hace en el sistema de ficheros), vista previa HTML del Markdown (§3, seguridad), gestión de ofertas como entidad (son texto o ficheros).

## 2. Situación de partida

### 2.1 Lo que la GUI consume (ya existe)

`/api/v1` (T-7.4a/b, `docs/api-headless.md` §5; referencia generada en `/reference/api`): estado, fuentes (árbol con huellas, lectura con `ETag`, `PUT` con `If-Match`), validar, compilar, perfil (con los ids de logros), generar (Markdown en línea, PDF por `GET /output/{name}`, informe de selección/oferta/recortes/tema), salidas, análisis de ofertas, extracción de PDF, temas (inventario y creación), trabajos del co-piloto (202 con `sending`, estado, SSE, cancelación, 403/409 para remotos), revisiones (listar, leer con estructura, `PUT` con `If-Match`, borrar, `apply` con plan por defecto) y apagado. Errores uniformes `{ error: { code, message, lines? } }`.

### 2.2 Lo que hay que tocar en el servidor (poco)

`cv serve` sirve hoy una página mínima en `/` (`src/serve/page.ts`) con la CSP `default-src 'none'; style-src 'unsafe-inline'` y responde 404 al resto de rutas fuera de `/api/v1`. El ejecutable lleva sus assets en prefijos fijos (`ASSET_ROOTS` en `scripts/package.ts`: `themes`, `templates/fonts`, `templates/dataset`, `prompts`) y `AssetStore` los sirve por clave (`text`, `bytes`, `keys(prefix)`) tanto desde el disco (desarrollo) como desde el SEA (ejecutable) con SHA-256 en el manifiesto.

### 2.3 *Spike* (2026-08-29, Vite 8.2 + Svelte 5.57 + CodeMirror 6.43)

| Medida | Resultado |
|---|---|
| Aplicación Svelte 5 mínima (estado, lista, evento) | 31,9 KB JS → **12,6 KB gzip**; CSS 1,5 KB gzip |
| Con CodeMirror 6 (`state`, `view`, `commands`, `lang-markdown`, `lang-yaml`, `lint`) | 537 KB JS → **188 KB gzip** |
| Dependencias del paquete `gui/` | 46 paquetes, 78 MB en `node_modules` (solo desarrollo; nada de ello viaja en el producto) |

Conclusión: la aplicación es ligera; el editor se carga **bajo demanda** (importación dinámica de Vite) al abrir el primer fichero.

## 3. Principios de diseño

1. **Cliente puro** (C14): la GUI no tiene lógica de negocio del producto; muestra lo que la API devuelve y envía lo que el usuario decide. Si algo falta, se añade a la API (y por tanto a la CLI), nunca a la GUI.
2. **El usuario decide y ve lo que sale** (C3, C9, C11): guardar, compilar, generar, lanzar un trabajo, marcar, aplicar y apagar son botones explícitos; antes de cada trabajo del co-piloto la pantalla muestra a dónde va y qué sale; los remotos pasan por el consentimiento de coste; nada se escribe sin una acción con nombre.
3. **Local y mudo**: ningún recurso externo (fuentes, iconos, CDN, analítica), ninguna petición fuera del propio origen.
4. **Nada del usuario se convierte en HTML**: fuentes, revisiones y CV en Markdown se muestran como texto (editor o preformateado); el PDF, en el visor del navegador. Elimina de raíz el XSS por contenido propio.
5. **Una pantalla por tarea**, en castellano, accesible con teclado, con `prefers-color-scheme` y sin más adorno que el necesario.
6. **La verdad está en el servidor**: tras cada escritura la GUI vuelve a leer; no hay estado optimista ni caché propia más allá de la sesión.

## 4. Arquitectura

### 4.1 El paquete `gui/`

Aislado como `website/` (decisión de T-7.1): `package.json` y `package-lock.json` propios, Vite 8 + `@sveltejs/vite-plugin-svelte` 7, Svelte 5 (runas), TypeScript 5.9 estricto (la misma línea que la raíz; el andamio de Vite propone 6.x, se fija 5.9 por coherencia), `svelte-check`. Sin framework de componentes ni de estilos: CSS propio con *custom properties*. Dependabot `npm` para `/gui`. Órdenes en la raíz: `gui:build` (Vite → `gui/dist/`), `gui:check` (tipos, lint de Svelte, unitarias y componentes), `gui:e2e` (Playwright), `gui:dev` (§4.3).

```
gui/
  src/lib/            lógica pura, 100 % de cobertura: api/client.ts (fetch tipado, Bearer, errores), api/sse.ts (parser de
                      text/event-stream sobre fetch), api/types.ts (tipos importados de src/serve/routes.ts, solo tipos),
                      session.ts (token del fragmento → sessionStorage), router.ts (rutas por hash), reviews/marks.ts
                      (alterna «[ ]/[x]» conservando el resto byte a byte), generate/request.ts (formulario → cuerpo),
                      errors.ts (envoltura de error → mensaje y acción), format.ts (fechas, tamaños, plurales)
  src/components/     piezas Svelte: Button, Field, Dialog (<dialog> nativo), Table, Tabs, Issues, Progress, PdfViewer, Editor (carga diferida)
  src/pages/          Estado, Fuentes, Generar, Copiloto, Revisiones, Salidas
  src/app.css         tokens (color, espacio, tipografía), claro/oscuro
  e2e/                Playwright: escenarios contra cv serve real + doble del proveedor de IA
```

Los **tipos de las peticiones** se importan del servidor (`import type { … } from '../../../src/serve/routes'`, donde se exportan los `z.infer` de cada esquema): el compilador de la GUI falla si el contrato cambia; la importación es solo de tipos y Vite no incluye código del servidor.

### 4.2 Distribución: dentro del ejecutable y de la imagen

- `gui/dist/` entra en `ASSET_ROOTS`: viaja en el SEA con su SHA-256 en el manifiesto y llega a la imagen sin más (la etapa `build` ejecuta `npm run package`, que construirá la GUI antes de inventariar los assets: `npm ci --prefix gui && npm run gui:build`). `.dockerignore` deja pasar `gui/` (no sus `node_modules` ni `dist`).
- `cv serve` sirve la SPA desde `AssetStore` con una **lista cerrada** construida al arrancar (`keys('gui/dist')`): `/` → `gui/dist/index.html`; `/assets/<nombre con hash>` → el asset exacto; cualquier otra ruta → 404 (no hay *fallback*: el enrutado de la GUI va en el fragmento, `#/fuentes`, así que solo existe un HTML). Sin resolución de rutas del sistema de ficheros: se busca por pertenencia a la lista, nunca por concatenación de rutas.
- Cabeceras: `Content-Type` por extensión (`html`, `js`, `css`, `svg`, `woff2`, `png`); `Cache-Control: no-store` para `index.html` y `public, max-age=31536000, immutable` para los ficheros con hash; las de seguridad de siempre más la CSP de §4.4. `--api-only` sigue devolviendo 404 en todo lo que no sea `/api/v1`. `src/serve/page.ts` desaparece.
- En desarrollo `DiskAssets` lee `gui/dist/` del repositorio: `npm run gui:dev` = `vite build --watch` + `cv serve --open`; misma URL, mismo origen, sin proxy ni excepciones de `Host`/`Origin`. (El servidor de desarrollo de Vite con *proxy* queda documentado como alternativa con `--allowed-hosts localhost:5173`.)

### 4.3 Sesión

`cv serve --open` abre `http://127.0.0.1:4310/#token=<token>`. Al cargar, la GUI lee el token del fragmento, lo guarda en `sessionStorage` (vive lo que la pestaña, nunca en disco de forma persistente ni compartido entre pestañas) y **lo retira de la URL** con `history.replaceState` (no queda en el historial, en capturas ni en marcadores). Cada petición lleva `Authorization: Bearer`. Sin token o con 401, una pantalla explica cómo obtenerlo (la URL que imprime `cv serve`) y ofrece pegarlo. `POST /shutdown` tiene botón con confirmación; tras él la GUI muestra «servidor detenido».

### 4.4 Seguridad en el navegador

- **CSP** para la SPA: `default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self'; connect-src 'self'; frame-src blob:; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Sin *scripts* en línea (Svelte compila los estilos a un `.css`). `style-src` admite estilos en línea porque CodeMirror inyecta los suyos con elementos `<style>` (style-mod); la alternativa, un *nonce* por respuesta, exigiría reescribir el HTML en cada petición para un riesgo (inyección de estilos, sin ejecución de código) que no compensa. Ajuste de la S1 respecto a la propuesta. `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer` (ya), `X-Content-Type-Options: nosniff` (ya).
- **PDF**: se descarga con el token (`fetch`), se convierte en `blob:` y se muestra en un `<iframe>` con el visor del navegador; es un PDF generado por el propio producto.
- **CSRF, DNS rebinding, otros orígenes**: los cubre el servidor (`Origin` obligatoriamente propio en escrituras, `Host` en loopback, sin CORS); la GUI es del mismo origen y no necesita nada más.
- **Nada del usuario como HTML** (§3.4); los identificadores de ficheros son relativos y el servidor los sanea (`unsafe-path`).
- **Sin telemetría, sin recursos externos, sin almacenamiento persistente** más allá de las preferencias de vista (tema claro/oscuro) en `localStorage`.

### 4.5 SSE sobre `fetch`

`EventSource` no admite cabeceras, y el token no puede ir en la URL. El cliente SSE de la GUI usa `fetch` con `Authorization` y un `ReadableStream`: analiza bloques `event:`/`data:` (JSON), entrega `status` y `line`, termina cuando el servidor cierra y se cancela con `AbortController` (cerrar la pestaña del trabajo deja de escuchar; **cancelar el trabajo** es `DELETE /jobs/{id}`, un botón distinto). Es un módulo puro, probado con flujos sintéticos (bloques partidos entre *chunks*, comentarios, JSON inválido).

### 4.6 Las pantallas

| Pantalla | Rutas de la API | Qué hace el usuario | Detalles |
|---|---|---|---|
| **Estado** | `GET /status`, `POST /validate`, `POST /build`, `POST /shutdown` | Ve el espacio de trabajo, el artefacto (al día / obsoleto / ausente), Typst, el proveedor de IA y el tema por defecto; valida; compila; apaga | Los problemas de validación salen con fichero y línea; cada uno enlaza con el editor en esa línea |
| **Fuentes** | `GET /sources`, `GET /sources/{path}`, `PUT /sources/{path}` | Explora el árbol, abre un fichero, lo edita (Markdown y CSV con resaltado), guarda; crea un fichero nuevo | Guardar envía `If-Match` con la huella leída; un 409 abre un diálogo (recargar / sobrescribir tras releer) y nunca pisa en silencio. Tras guardar se valida solo y se avisa si el artefacto queda obsoleto (con el botón de compilar) |
| **Generar** | `GET /profile`, `GET /themes`, `POST /themes`, `POST /offers/extract`, `POST /analyze-offer`, `POST /generate`, `GET /output/{name}` | Elige especialidad, oferta (texto pegado, fichero del espacio de trabajo o PDF subido), formato, motor, tema, límites; analiza la oferta; genera; ve el PDF o el Markdown; descarga | El informe de decisiones (`--explain`) en un panel plegable: selección, cobertura de la oferta, recortes, tema. El análisis muestra la puntuación, lo que demuestra y lo que falta |
| **Co-piloto** | `POST /jobs/*`, `GET /jobs`, `GET /jobs/{id}`, `GET /jobs/{id}/events`, `DELETE /jobs/{id}` | Lanza mejorar / resumir / etiquetar con las mismas opciones que la CLI; sigue el progreso en directo; cancela | Antes de lanzar se muestra el proveedor (de `/status`); el 202 devuelve `sending` (qué salió y a dónde) y se muestra tal cual. Un 403 explica `--allow-remote`; un 409 muestra la estimación y el botón «Confirmar coste» que repite con `consent.estimateId` (C11). Las etiquetas sugeridas se muestran listas para copiar |
| **Revisiones** | `GET /reviews`, `GET /reviews/{name}`, `PUT /reviews/{name}`, `POST /reviews/{name}/apply`, `DELETE /reviews/{name}` | Abre una revisión: **antes / después** por ítem, cada propuesta con su veredicto (aceptada o rechazada, con las infracciones del verificador); marca la que quiere; guarda; aplica | Marcar reescribe solo `[ ]`→`[x]` en el texto (módulo puro) y guarda con `If-Match`. «Aplicar» pide primero el plan (`dryRun`) y lo muestra (fichero, id, texto); «Escribir en las fuentes» confirma con `dryRun: false` y enseña los ficheros escritos y sus copias `.bak`; un 422 muestra las líneas (huella cambiada, sin marcas) |
| **Salidas** | `GET /output`, `GET /output/{name}` | Lista los CV y revisiones generados; abre o descarga | El PDF en el visor; el Markdown como texto |

Navegación por pestañas (hash), con el estado de la sesión y un aviso persistente si el artefacto está obsoleto. Los ids de logros para `only` salen de `GET /profile`.

### 4.7 Estado y datos

Runas de Svelte 5 por página; un almacén global mínimo (sesión, `/status`, trabajos abiertos con sus flujos SSE). Ningún dato del usuario se cachea entre páginas: al volver a una pantalla se vuelve a pedir. Las escrituras siguen el patrón leer → editar → `PUT` con `If-Match` → releer.

### 4.8 Presentación y accesibilidad

Tipografía del sistema, tokens de color y espacio, claro/oscuro por `prefers-color-scheme` (con conmutador), foco visible, `aria-live` para progreso y avisos, `<dialog>` nativo para confirmaciones, contraste AA, todo operable con teclado. Iconografía mínima en SVG en línea.

## 5. Pruebas y verificación (C12, C13)

| Nivel | Herramienta | Qué cubre | Umbral |
|---|---|---|---|
| Unitarias | Vitest (jsdom) | `gui/src/lib/**`: cliente de la API (errores, 401, `If-Match`), parser SSE, sesión, enrutador, marcas de revisión, formulario → petición, mensajes | **100 %** (líneas, ramas, funciones), como el resto del producto |
| Componentes | `@testing-library/svelte` | Cada pantalla con un `fetch` doble: qué se pide y qué se muestra ante respuestas de éxito y de error; diálogos de conflicto, consentimiento y confirmación | Cobertura medida, sin umbral en el MVP (decisión 6) |
| Extremo a extremo | Playwright (Chromium) | Contra `node dist/index.js serve` real sobre un espacio de trabajo temporal (`cv init`) y un **doble local del proveedor de IA** (servidor `node:http` compatible con OpenAI que devuelve propuestas fijas): sesión por fragmento, estado, editar/guardar/conflicto, validar, generar Markdown y PDF (el visor carga), analizar oferta, trabajo de mejora con progreso, revisión → marcar → plan → aplicar, apagar | Todos los escenarios en verde en CI (trabajo `gui`) y **contra el ejecutable** en el trabajo `package-linux-x64` de la release |
| Contrato | Compilador | Los cuerpos que la GUI envía son los tipos del servidor | `gui:check` falla si el contrato cambia |
| Servidor | Vitest + arnés | Servicio de la SPA: lista cerrada, 404 fuera de ella, cabeceras, CSP, `--api-only`; el escenario `serve` del arnés determinista gana las peticiones de la SPA (`/`, un asset, una ruta inexistente) | 100 % y byte a byte, como hoy |

La CI gana el trabajo `gui` (`npm ci --prefix gui`, `gui:check`, `gui:build`, `gui:e2e` con Chromium de Playwright en caché); `verify` no cambia. `docker` sigue igual (la imagen lleva la GUI porque `npm run package` la construye).

## 6. Documentación (C15)

Guía «La interfaz web» (arrancar con `--open`, sesión, cada pantalla, qué escribe y qué no, el consentimiento de coste) con **capturas generadas por Playwright** (`gui:screenshots`, sobre el espacio de trabajo de ejemplo; versionadas y regeneradas en cada entrega para que no mientan); referencia de `cv serve` regenerada; nota de diseño (esta); README (una línea y una captura); CHANGELOG. El tutorial de la GUI es el propio escenario E2E: los tutoriales ejecutables siguen siendo de terminal.

## 7. Seguridad: modelo de amenazas, en lo que añade la GUI

| Amenaza | Respuesta |
|---|---|
| Robo del token por XSS | CSP sin código en línea ni orígenes externos; nada del usuario como HTML; token en `sessionStorage`, no en cookies ni URL |
| Token en historial, capturas o referidos | Se retira del fragmento al cargar; `Referrer-Policy: no-referrer` |
| *Clickjacking* | `frame-ancestors 'none'` y `X-Frame-Options: DENY` |
| CSRF desde otra pestaña | `Origin` obligatoriamente propio en el servidor (ya) |
| Rutas del sistema de ficheros | La GUI solo maneja identificadores relativos; el servidor los sanea (`unsafe-path`); los assets se sirven por lista cerrada |
| Escrituras no deseadas | Botones explícitos, `If-Match`, plan antes de aplicar, copias `.bak` visibles (C9) |
| Coste remoto sin querer | 403 sin `--allow-remote`; 409 con estimación y confirmación explícita (C11) |
| PDF malicioso | Solo PDF generados por el producto, en el visor del navegador bajo `blob:` |

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Svelte 5 (runas) es reciente para el equipo. | Lógica en TypeScript puro; los componentes son finos; el *spike* ya usa runas. |
| Playwright en CI (descarga de Chromium, tiempos). | Caché del navegador por versión; Chromium solo; escenarios deterministas con el doble del proveedor; presupuesto ≤ 3 minutos. |
| Tamaño del editor. | Carga diferida (188 KB gzip solo al abrir un fichero); presupuesto inicial ≤ 30 KB gzip vigilado en `gui:build`. |
| Deriva entre GUI y API. | Tipos importados del servidor; E2E contra el servidor real; referencia generada. |
| Segunda cadena de dependencias (46 paquetes). | Solo de desarrollo; nada viaja en el producto; Dependabot; lockfile propio. |
| Ficheros grandes en el editor. | CodeMirror maneja miles de líneas; las fuentes de un CV son pequeñas. |
| Conflictos de edición (dos pestañas). | `If-Match` y diálogo explícito; nunca se pisa en silencio. |

## 9. Plan de ejecución

**T-7.5a — Editor y generación (versión 1.2.0)**
- **S1**: paquete `gui/`, sesión, cliente de la API y SSE (puros, 100 %), enrutador, estilo base; pantallas Estado y Fuentes (editor diferido, guardado con `If-Match`, conflictos, validación); servicio de la SPA en `cv serve` (lista cerrada, CSP, cabeceras) con sus pruebas y el arnés.
- **S2**: pantallas Generar (oferta por texto, fichero o PDF; análisis; informe; visor de PDF) y Salidas; temas.
- **S3**: empaquetado (`ASSET_ROOTS`, `package.ts`, `Dockerfile`, `.dockerignore`), E2E con Playwright en CI y contra el ejecutable, guía con capturas, README, CHANGELOG `[1.2.0]`.

**T-7.5b — Co-piloto y revisiones (versión 1.3.0)**
- **S4**: pantalla Co-piloto (trabajos, `sending`, progreso SSE, cancelación, consentimiento remoto, etiquetas).
- **S5**: pantalla Revisiones (antes/después, veredictos, marcas con `PUT`, plan y aplicación, borrado).
- **S6**: E2E del co-piloto con el doble del proveedor, guía y capturas, CHANGELOG `[1.3.0]`.

Cada entrega deja typecheck, cobertura, arnés, `docs:check` y E2E en verde, y se somete a la aprobación del Director.

## 10. Decisiones que se piden al Director

1. **Tecnología**: Svelte 5 + Vite 8 + TypeScript (recomendada: 12,6 KB gzip, componentes finos, sin runtime pesado) frente a Solid o Vue.
2. **Editor**: CodeMirror 6 con carga diferida (recomendado) frente a un `<textarea>` sin resaltado.
3. **Visor de PDF**: el del navegador sobre `blob:` (recomendado, sin dependencias) frente a pdf.js embebido.
4. **Distribución**: la SPA viaja en el ejecutable y en la imagen y solo la sirve `cv serve` en el mismo origen; sin despliegue aparte (recomendado; la API no tiene CORS por diseño).
5. **SSE sobre `fetch` con `Authorization`** (recomendado); el token nunca va en la URL ni en cookies.
6. **Cobertura**: `gui/src/lib/**` al 100 % + componentes probados sin umbral + E2E obligatorio en CI (recomendado) frente a exigir el 100 % también a los componentes.
7. **Nada del usuario como HTML** en el MVP (recomendado): Markdown como texto y PDF en el visor; una vista previa HTML segura quedaría para después.
8. **Dos entregas y dos versiones**: T-7.5a → 1.2.0 (editor y generación), T-7.5b → 1.3.0 (co-piloto y revisiones) (recomendado), frente a una sola 1.2.0 al final.
9. **Capturas generadas** por Playwright y versionadas como documentación de la GUI (recomendado) frente a capturas manuales.
10. **Fuera de alcance** confirmado: WYSIWYG, reordenación, multiusuario/despliegue remoto, i18n, borrado de fuentes, edición de temas, entidad «oferta».

## 11. Estado de la implementación

- **T-7.5a · S1 (2026-08-30)**: entregado. **Servidor**: `src/serve/contract.ts` (esquemas zod de cada cuerpo, tipos de petición por `z.infer` y tipos de respuesta de las 27 rutas, comprobados con `satisfies` en cada manejador; `statusPayload` y `analysisPayload` pasan a estar tipados), `src/serve/static.ts` (la SPA por lista cerrada desde `AssetStore`: `/` → `gui/dist/index.html`, `/assets/<hash>` inmutables, tipos por extensión, sin `gui/dist` no hay interfaz) e integración en `server.ts` (solo GET/HEAD, CSP de §4.4 en el HTML, `X-Frame-Options: DENY` global, página mínima cuando la GUI no viene en la compilación). **GUI** (`gui/`, Vite 8.2 + Svelte 5.57 + TypeScript 5.9 estricto, lockfile propio, Dependabot): `lib/` (cliente tipado de la API con `ApiError`/`NetworkError`, parser SSE sobre `fetch`, sesión por fragmento → `sessionStorage`, enrutador por hash, explicación de errores, problemas de validación, árbol de fuentes, vista del estado, formato) al **100 %** de cobertura; componentes (Nav, Notice, Issues, Dialog, SessionGate, Tree, Editor con CodeMirror en importación diferida, Pending) y pantallas **Estado** (indicadores, validar, compilar, apagar con confirmación, problemas con enlace al fichero) y **Fuentes** (árbol, edición, guardado con `If-Match`, diálogo de conflicto con recargar/sobrescribir, validación tras guardar, nuevo fichero) con pruebas de Testing Library; `App` con la sesión (token retirado de la URL) y el 401 que devuelve a la puerta. Raíz: `gui:build`/`gui:check`/`gui:dev`, trabajo `gui` en la CI con presupuesto del paquete inicial (≤ 30 KB gzip), CHANGELOG. **Medido**: paquete inicial 62 KB → **23,4 KB gzip**; CodeMirror en un *chunk* de 180 KB gzip que solo se carga al abrir un fichero. **Verificación**: `svelte-check` 0 errores; 30 pruebas de la GUI (lógica al 100 %); raíz 700+ pruebas al 100 %, arnés determinista 78/78; `cv serve` real con `gui/dist` comprobado con `curl` (CSP, `no-store`/`immutable`, 404 fuera de la lista, `--api-only`) y **en Chrome**: el token desaparece de la URL, Estado muestra el espacio de trabajo real, Fuentes abre `profile.md` con CodeMirror, una edición guardada llega al disco con `If-Match` (fichero 0600) y la validación posterior se muestra; sin errores de consola (CSP respetada). **Ajuste** respecto a la propuesta: `style-src` admite `'unsafe-inline'` por los estilos que inyecta CodeMirror (§4.4). Pendiente en T-7.5a: S2 (Generar, Salidas, temas) y S3 (empaquetado en el ejecutable y la imagen, E2E con Playwright en CI, guía con capturas, 1.2.0). **S1 aprobado por el Director el 2026-08-30**.
- **T-7.5a · S2 (2026-08-30)**: entregado. **Cliente de la API** ampliado (`generate`, `analyze`, `extractOffer` con el PDF como cuerpo `application/pdf`, `themes`, `createTheme`, `outputs`, `output` como bytes con su tipo) sobre una capa `raw` común. **Lógica pura** (100 %): `generate/form.ts` (el formulario → los cuerpos de `/generate` y `/analyze-offer`, con la validación que la API exigiría: oferta por texto, PDF extraído o fichero del espacio de trabajo; motor y tema solo cuando aplican; límites enteros; nombre de fichero sin directorios), `generate/report.ts` (el informe de decisiones —selección, oferta, recortes, tema— y la vista de adecuación con el mismo vocabulario que `src/cli/explain.ts`, a partir de las estructuras del contrato), `outputs.ts` (tipo por extensión y orden). **Pantallas**: **Generar** (especialidad, oferta, formato, motor —Typst propuesto si es utilizable—, tema, límites, locale, nombre, compacto, recompilar; «Analizar oferta» con demostrados/no demostrados/carencias/mejores evidencias; «Generar CV» con el Markdown en texto y descarga, o el **PDF en el visor del navegador** sobre `blob:`; informe de decisiones plegable; avisos; creación de temas a partir de otro), **Salidas** (lista por tipo con tamaño, vista de texto o visor de PDF, descarga) y `PdfViewer`; ambas pantallas se cargan como *chunks* diferidos para no engordar el arranque. **Medido**: arranque 66,6 KB → **25,0 KB gzip** (Generar 6,4 KB y Salidas 1,7 KB aparte; CodeMirror 180 KB solo al abrir un fichero). **Verificación**: `svelte-check` 0 errores; **45 pruebas** de la GUI (lógica al 100 %; componentes de Generar y Salidas con dobles de la API, incluida la subida de un PDF y el visor con `URL.createObjectURL` simulado); **en Chrome contra `cv serve` real con Typst**: análisis de una oferta del espacio de trabajo (8 requisitos, 63 % de adecuación, evidencias reales), generación del PDF con Typst (`output/cv-ada-ejemplo-backend-nexo.pdf`, 41 KB, 1 página, 0600), visor y descarga sobre `blob:`, informe con Selección (9 de 16 ítems), Oferta, Recortes y Tema, y Salidas con el mismo PDF en el visor; sin errores de consola. Observación: las capturas de pantalla por CDP se bloquean cuando el visor de PDF de Chrome está en pantalla (limitación del capturador, no de la aplicación; el DOM se verificó por su árbol de accesibilidad); para las capturas de la guía (S3) se cubrirá el visor o se usará una imagen del PDF renderizado. **S2 aprobado por el Director el 2026-08-30**.
- **T-7.5a · S3 (2026-08-30)**: entregado. **Empaquetado**: `gui/dist` es un prefijo de assets (`ASSET_ROOTS`); `npm run package` gana el paso 3/8 «Interfaz web» (construye la GUI con sus dependencias instaladas, o se detiene con un mensaje claro) y su prueba de humo del binario arranca `cv serve --port 0`, comprueba que `GET /` devuelve el HTML de la SPA y que la API responde con el token; el `Dockerfile` instala las dependencias de `gui/` en la etapa `build`; `docker-smoke.sh` gana dos comprobaciones (`cv serve` dentro del contenedor sirve la interfaz en `/` y la API responde con el token; el puerto publicado coincide con el del contenedor porque `Host` solo admite el propio); el escenario `serve` del arnés deja `--api-only` y pide `/` (HTML normalizado con CSP y `no-store`), el módulo con hash (`immutable`), `/index.html` y un asset inexistente (404). **E2E**: `gui/e2e/` con Playwright (Chromium; un trabajador, orden serial): el arranque global crea un espacio de trabajo (`cv init`, `cv build`, una oferta) y lanza `cv serve` real —`dist/index.js` o el ejecutable de `CV_BINARY`—; seis escenarios: sesión por fragmento (token retirado de la URL y en `sessionStorage`; sin token, la puerta y el token pegado), Estado (espacio real, validar, compilar), Fuentes (CodeMirror, escritura que llega al disco con `If-Match`), Generar (análisis de una oferta del espacio de trabajo, Markdown con informe, PDF en el visor `blob:`), Salidas y Apagar; `npm run gui:screenshots` genera las capturas de la guía con el mismo arnés (tema claro, 1280×800) y se versionan en `website/src/public/gui/`. **CI**: `verify` construye la GUI para el arnés; el trabajo `gui` ejecuta la E2E contra `dist/` (Chromium en caché por versión); la release ejecuta la E2E **contra el ejecutable empaquetado** tras el arnés. **Documentación**: guía «La interfaz web» (arranque, sesión, las cuatro pantallas con sus capturas, qué escribe y qué no, seguridad), README, `cv serve` descrito como servidor de la interfaz y la API, CHANGELOG `[1.2.0]`, versión **1.2.0** (`package.json`, `compose.yml`, ejemplos). **Verificación en esta máquina**: `npm run package` 1.2.0 con la GUI dentro (33 assets; humo con `cv serve` en verde; tar.gz 23,5 MB); arnés determinista 78/78 con `dist/` y **78/78 contra el ejecutable** (las peticiones de la interfaz incluidas); **E2E 6/6 contra `dist/` y 6/6 contra el ejecutable**; `gui:check` (0 errores, 45 pruebas, lógica al 100 %); raíz 709 pruebas al 100 %; `docs:check` con la guía nueva (enlaces e imágenes) y los siete tutoriales; imagen Docker 1.2.0 construida en local en sus dos variantes (Debian 407 MB y distroless 331 MB en disco) con el humo **15/15 en la variante Debian y 15/15 en distroless con `--user`**, incluidas las dos comprobaciones nuevas (`cv serve` dentro del contenedor sirve la interfaz en `/` y la API responde con el token). Ajuste: `@types/node` de `gui/` alineado con la raíz (26.4.0), porque el grafo de tipos del contrato llega hasta `src/renderers/typst/engine.ts`. **Publicación: v1.2.0 (2026-08-30, run `33279488656`)**, seis trabajos en verde en seis minutos (verify con la GUI en el arnés, empaquetado con la **E2E contra el ejecutable**, imágenes amd64 y arm64 con la interfaz dentro y su humo, release de GitHub, publicación en GHCR). **Verificación externa desde esta máquina**: tar.gz (46,3 MiB) con la huella de `SHA256SUMS.txt` correcta; el binario descargado imprime 1.2.0 y `cv serve` desde él sirve la interfaz en `/` (HTML con el módulo) y la API con el token; `ghcr.io/nunzi00/chameleon-cv:1.2.0` (= `1.2`, `1`, `latest`; `1.2.0-distroless` = `latest-distroless`; la 1.1.1 sigue) sirve la interfaz desde el contenedor; atestación del índice verificada con `cosign` (identidad `release.yml@refs/tags/v1.2.0`) y atestación del tar.gz presente en la API. **T-7.5a APROBADA por el Director el 2026-08-30** («la ejecución es impecable»); luz verde para T-7.5b ese mismo día.
- **T-7.5b · S4 (2026-08-30)**: entregado. **Cliente**: `jobs`, `job`, `startJob` (202; 403 `remote-disabled` y 409 `consent-required` llegan como `ApiError` con sus detalles), `cancelJob` y `jobEvents` (el parser SSE de S1 sobre `fetch` con `Accept: text/event-stream` y `AbortSignal`). **Lógica pura** (100 %): `copilot/form.ts` (formulario → cuerpos de `/jobs/improve|summarize|suggest-tags` con los rangos de la API: propuestas 1–3, longitud 40–1000 / 100–5000, logros 1–500, párrafos 1–3, etiquetas 1–20, ids de `only`, oferta por texto o fichero, nombre de la revisión sin directorios), `copilot/jobs.ts` (eventos SSE → estado del trabajo, lista, resultado por tarea —revisión escrita o etiquetas— y «qué sale y a dónde»), `copilot/consent.ts` (403 y 409 con estimación y `estimateId`), `copilot/profile.ts` (ids de logros para «solo estos»). **Pantalla Co-piloto**: indicador del proveedor, formulario por tarea con los ids del perfil como sugerencias, «Lanzar», panel `sending`, lista de trabajos con progreso en directo y cancelación, resultado (enlace a Revisiones o etiquetas copiables), diálogo de **consentimiento de coste** que reenvía con `consent.estimateId` (C11); recupera y sigue los trabajos vivos de la sesión al entrar; *chunk* diferido (6,2 KB gzip). **Pruebas**: unitarias al 100 %, componentes con dobles (flujo 409 → confirmar → 202, 403, cancelar, fallo, etiquetas), y **E2E con un doble local del proveedor** (`gui/e2e/llm-stub.ts`, compatible con OpenAI, propuestas fijas): un `improve` real de dos logros seguido por SSE hasta «terminado» con la revisión escrita en `output/`. **Hallazgo y corrección en el servidor**: el resultado de `improve`/`summarize` devolvía `review.path` como ruta absoluta del sistema, contra la regla transversal de §5 de la API; ahora es `output/<nombre>` (prueba ajustada). Raíz 709 pruebas al 100 %, arnés 78/78. Pendiente: S5 (Revisiones) y S6 (E2E completa, guía, capturas, 1.3.0).
- **T-7.5b · S5 (2026-08-30)**: entregado. **Cliente**: `reviews`, `review`, `writeReview` (PUT con `If-Match`), `deleteReview`, `applyReview` (`{}` = plan; `{ dryRun: false }` = escritura). **Lógica pura** (`lib/reviews/marks.ts`, 100 %): `toggleMark` reescribe solo `[ ]`↔`[x]` en la línea `- [ ] Propuesta N:` de la sección `## <id> · …` (byte a byte el resto; sin cambio si no existe o ya está así) y `countMarks`. **Pantalla Revisiones**: lista (tarea, ítems, marcadas, «no interpretable»), detalle con antes/después por ítem —original, impacto, fuente `fichero:línea` o aviso «sin fuente»; propuestas aceptadas con casilla, rechazadas tachadas con «rechazada (C2)»—, «Guardar marcas» (solo con cambios; deshabilita aplicar hasta guardar), «Plan de aplicación» (422 con líneas cuando no hay nada aplicable o el original cambió), «Escribir en las fuentes» tras confirmación (muestra ficheros, copias `.bak` e ids; recuerda recompilar en Estado), «Eliminar» con confirmación; una revisión no interpretable se muestra en crudo. Chunk diferido de 3,9 KB gzip; `Pending` retirado (no quedan rutas pendientes). **Pruebas**: 2 de componente (flujo completo marcar→guardar→plan→escribir; 422, borrado con confirmación, revisión rota, 401) y E2E «Revisiones abre la revisión del co-piloto, guarda una marca, muestra el plan y aplica a las fuentes con copia .bak» (comprueba en disco el texto aplicado y el `.bak`): 8/8.
- **T-7.5b · S6 (2026-08-30)**: entregado; **T-7.5b cerrada**. Capturas automatizadas de Co-piloto (un improve real contra el doble del proveedor, terminado, con el enlace a la revisión) y Revisiones (marca guardada y plan de aplicación) en `gui/e2e/screenshots.spec.ts`; secciones «Co-piloto» y «Revisiones» de la guía «La interfaz web» y la lista de «qué escribe la interfaz» completada (Lanzar, Guardar marcas, Escribir en las fuentes, Eliminar); CHANGELOG `[1.3.0]`; versión 1.3.0 en `package.json`, `compose.yml`, README, guía Docker y goldens del arnés; referencia y portal regenerados. Verificación previa al etiquetado: raíz (tipos, cobertura 100 %, arnés determinista), GUI (svelte-check, 65 pruebas al 100 % de `lib`, E2E 8/8), ejecutable SEA con la GUI dentro y E2E contra él. Fuera del MVP (§2) y candidatas a hitos posteriores: edición del CSV como tabla, plantillas/temas editables, alta de proveedores desde la GUI.
