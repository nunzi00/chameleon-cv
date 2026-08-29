# Registro de cambios

Todos los cambios notables de Chameleon CV se documentan aquí. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones, el [Versionado Semántico](https://semver.org/lang/es/). La sección de cada versión es la fuente de las notas de su release en GitHub: el flujo de release la extrae con `npm run release:notes -- <versión>` y se detiene si no existe, no lleva fecha o está vacía.

## [Unreleased]

### Añadido

- Interfaz web (T-7.5a, en curso): `cv serve` sirve en `/` la aplicación de `gui/` (Svelte 5 + Vite) que viaja como assets, por lista cerrada y con CSP estricta; sesión por el fragmento de la URL guardada en la pestaña; pantallas **Estado** (artefacto, Typst, co-piloto, temas; validar, compilar y apagar) y **Fuentes** (explorador, editor CodeMirror cargado bajo demanda, guardado con `If-Match` y diálogo de conflicto, validación tras guardar, creación de ficheros). Contrato tipado de la API (`src/serve/contract.ts`) compartido con la GUI.

## [1.1.1] - 2026-08-29

El núcleo como producto y la imagen Docker publicada: la API local (`cv serve`) completa —incluidos los trabajos del co-piloto—, el portal de documentación, el ecosistema Docker y la primera imagen oficial en GitHub Container Registry. Hito 7 (T-7.1 a T-7.4) del [ROADMAP](ROADMAP.md). La versión 1.1.0 no llegó a publicarse: sus cambios se distribuyen aquí.

### Añadido

- Portal de documentación (`website/`, VitePress) publicado en GitHub Pages: guía de usuario, referencia de comandos generada desde la ayuda de la CLI, tutoriales ejecutables verificados en la integración continua, sección para desarrolladores (arquitectura y cánones C1–C15, contribuir, pruebas, extender, empaquetado) y notas de diseño sincronizadas desde `docs/`. `CONTRIBUTING.md`. README reducido a puerta de entrada.
- Cánones C14, «El núcleo es el producto», y C15, «La documentación es código verificable».
- `cv serve`: servidor local de la API (`/api/v1`) sobre el espacio de trabajo —solo `127.0.0.1`, token de sesión, `Host`/`Origin` comprobados, sin CORS— con estado, fuentes (huellas e `If-Match`), validar, compilar, perfil, generar, salida, análisis de ofertas, extracción de PDF y temas; la CLI y el servidor comparten la capa de casos de uso `src/app/`.
- El co-piloto en la API como **trabajos**: `POST /jobs/improve`, `/jobs/summarize` y `/jobs/suggest-tags` (202 con `Location` y qué saldrá hacia dónde), estado y eventos en directo (`GET /jobs/{id}/events`, Server-Sent Events), cancelación (`DELETE /jobs/{id}`: la petición en curso al modelo se aborta), consentimiento de coste en dos pasos para proveedores remotos (`cv serve --allow-remote` y `409 consent-required` con estimación y `estimateId` de un solo uso), y revisiones (`GET /reviews`, `GET`/`PUT` con `If-Match`/`DELETE /reviews/{name}`, `POST /reviews/{name}/apply` con plan por defecto).
- Referencia de la API generada desde el propio servidor (`/reference/api`), guía «La API local (cv serve)» y tutorial 6 «La API desde la terminal», ejecutable en la integración continua.
- `compose.serve.yml` y `compose.serve-ai.yml`: `cv serve` desde Docker con el puerto publicado solo en el loopback del anfitrión.
- Ecosistema Docker: `Dockerfile` multi-etapa (runtime sin Node; variante distroless), `compose.yml` sin red y endurecido, `compose.ai.yml` con Ollama en loopback compartido (`network_mode: service:ollama`) y `compose.gpu.yml`; prueba de humo de la imagen (`npm run docker:smoke`), trabajo `docker` en la integración continua, guía «Chameleon CV en Docker» y tutorial 5.
- Imagen Docker publicada en GitHub Container Registry (`ghcr.io/nunzi00/chameleon-cv`) desde el flujo de release, con etiquetas `X.Y.Z`, `X.Y`, `X` y `latest` (sin alias en prereleases), variante `-distroless`, `linux/amd64` y `linux/arm64` construidas en runners nativos, SBOM y procedencia de BuildKit en el registro y atestación de procedencia de GitHub sobre cada índice (`gh attestation verify oci://…`); la imagen solo se publica tras pasar la prueba de humo en cada arquitectura. `workflow_dispatch` para ensayar sin publicar o (re)publicar la imagen de una release existente. Análisis semanal e informativo de la imagen publicada con Trivy (Code scanning).
- `compose.yml` descarga por defecto la versión exacta publicada (`CHAMELEON_CV_IMAGE` la cambia); una prueba de la suite exige que coincida con `package.json`. Prueba de humo con `--user` (variante distroless) y trabajo `docker` de la CI en `amd64` y `arm64` con las dos variantes.

### Cambiado

- `cv improve`, `cv summarize`, `cv suggest tags` y `cv improve apply` son clientes de los casos de uso de `src/app/` (planificar sin red → proveedor y consentimiento → ejecutar con progreso y cancelación), con la misma salida byte a byte. Toda petición al modelo admite una señal de cancelación (`AbortSignal`), combinada con el tiempo máximo.
- Los flujos de integración continua y de release generan las notas con `npm run --silent`, para que la cabecera de npm no se cuele en la release.

### Corregido

- El arnés de aceptación compara los PDF de forma canónica (flujos descomprimidos): una compilación de Node con zlib-ng produce bytes distintos pero documentos idénticos, y la integración continua en GitHub lo señalaba como diferencia.
- Los flujos de CI y release invocaban un script `lint` inexistente.
- El flujo de documentación ya no intenta activar GitHub Pages con el token de la acción (no tiene permiso): Pages se activa una vez desde los ajustes del repositorio.

## [1.0.0] - 2026-08-29

Primera versión estable. Chameleon CV genera CV dinámicos a partir de un único conjunto de fuentes (Markdown y CSV): una versión por especialidad o adaptada a una oferta de empleo, en Markdown o PDF, con un co-piloto de IA que sugiere y nunca decide. Todo se procesa en local y sin telemetría. Se distribuye como ejecutable autónomo para linux-x64 (plataforma de referencia) y desde el repositorio. Resume el trabajo de los Hitos 1 a 6 del [ROADMAP](ROADMAP.md), del 2026-08-28 al 2026-08-29.

### Añadido

**Perfil y fuentes (Hito 1)**

- Esquema `MasterProfile` con validación estricta en tiempo de ejecución (zod): datos personales, especialidades, experiencias, proyectos, formación, logros, skills, certificaciones e idiomas.
- Fuentes en Markdown (frontmatter YAML para los datos y cuerpo para el texto; logros como viñetas con `impact`, `date` y etiquetas `#tag`) y en CSV (`skills.csv` con alias y categorías, `certifications.csv`). Ninguna clave, sección o fichero desconocido se ignora en silencio.
- `cv validate` y `cv build`: el artefacto canónico `data/dist/profile.json`, validado y escrito de forma atómica con permisos 0600; todos los errores a la vez, con fichero y línea.
- `SelectorEngine`: selección por especialidad con una sola regla —sin etiquetas, siempre; con etiquetas, solo si alguna coincide— y entrada de experiencias y proyectos a través de sus logros. `--explain` cuenta cada decisión.
- `cv generate-cv` en Markdown con Handlebars a partir de una vista ya formateada (fechas por idioma, periodos, skills por categoría), plantillas propias con `--template`, castellano e inglés.

**Adaptación a ofertas de empleo y PDF (Hitos 2 y 2.5)**

- Extractor determinista de palabras clave de una oferta con el vocabulario del propio perfil (tags, nombres y alias de skills) y puntuación transparente por secciones (`Requisitos` 1.0 · resto 0.75 · `Deseable` 0.5, con refuerzo por repetición).
- `cv analyze-offer` (adecuación, evidencias y carencias; `--explain`, `--json`) y `cv generate-cv --from-job-offer` (texto, entrada estándar o PDF).
- Recorte «N mejores»: `--top-n`, `--max-skills`, `--max-projects`, `--max-certifications` y el preset `--compact`.
- Lectura de ofertas en PDF en un *worker* aislado con límites (10 MiB, 50 páginas, 20 s, 512 MB) y salida `--format pdf` con pdfkit y la fuente Source Sans 3 embebida, sin dependencias externas.
- `cv build --check` como puerta de calidad para CI, `--build` en `generate-cv` y `analyze-offer`, `cv init` con un dataset de ejemplo y la etiqueta reservada `#pin`, que ancla un ítem en toda especialidad u oferta.

**Motor Typst de calidad editorial (Hito 3)**

- `--engine typst`: la misma vista estructurada que pdfkit, maquetada con Typst 0.15.1 en un proceso contenido (stdin/stdout sin ficheros intermedios, `--root` limitado, sin red, solo las fuentes del proyecto, 20 s y 32 MiB de límite); PDF etiquetado y determinista.
- `cv typst install`, la única operación de red del producto: descarga del release oficial verificada contra un manifiesto de SHA-256 fijado al versionar; `cv typst status`.
- Diseño tipográfico de referencia: jerarquía con versalitas, fechas alineadas, tabla de skills y pie de página solo cuando hay varias páginas.

**Co-piloto de IA (Hitos 4 y 4.5)**

- Doctrina canonizada (C1–C13, `docs/llm-integration.md`): la IA sugiere y el usuario decide; sin invención; local por defecto; minimización y seudonimización de lo que sale; prompts transparentes y versionados; salida validada; inmutabilidad de las fuentes.
- Proveedores locales (Ollama y servidores compatibles con OpenAI en loopback), `cv llm status` y caché local de respuestas (`cv llm cache clear`).
- `cv improve`: reescrituras con más impacto para los logros seleccionados, cada una verificada por código (integridad semántica: ninguna cifra ni entidad añadida u omitida) y recogidas en un fichero de revisión.
- `cv summarize`: propuestas de resumen profesional a partir del perfil filtrado, verificadas en modo síntesis e indicando los hechos clave que mencionan.
- `cv suggest tags`: etiquetas solo del diccionario cerrado de las especialidades, con la evidencia de cada una calculada por código.
- Proveedores remotos `openai` y `anthropic` solo con `--provider` explícito: claves desde variable o fichero 0600 (nunca interactivas), lista blanca de hosts sin redirecciones, aviso de coste y confirmación (`--yes` para scripts).
- `cv improve apply`: aplica a las fuentes lo marcado `[x]` en una revisión, con procedencia y huella SHA-256 del original, copia `.bak` previa y cambio mínimo; `--dry-run` y `--delete-review`. Es la única orden que escribe en `data/sources/`.

**Temas (Hito 5)**

- Sistema de temas para Typst: `themes/<nombre>/` con `theme.toml` (colores, tipografías, tamaños, espaciados y página, validados con la ruta de cada error) y `template.typ` (contrato `cv(d, theme)`); `--theme` busca primero en el proyecto y después entre los distribuidos.
- Temas distribuidos `default` y `classic`; `cv.toml` con `[theme]` para elegir el tema por defecto del proyecto y anular valores en cascada con la misma validación.
- `cv theme list | path | create --from`.

**Validación integral (Hito 5.5)**

- Banco de pruebas sintético (sin datos reales) con 260 artefactos esperados versionados; arnés determinista (`npm run test:acceptance:deterministic`: 77 pasos contra el binario, comparación byte a byte, omisiones visibles y autocomprobaciones) y arnés de IA (`npm run test:acceptance:ai`: 16 comprobaciones del proceso con un modelo local real). Guía en `docs/acceptance-testing.md`.

**Distribución (Hito 6)**

- Capa unificada de assets: los recursos viajan dentro del ejecutable (`node:sea`) y los que deben ser ficheros reales se materializan en la caché de usuario con su SHA-256 comprobado en cada uso.
- `npm run package`: ejecutable autónomo (Node SEA + esbuild) con prueba de humo y archivo `tar.gz` reproducible con su `.sha256`, que incluye la licencia, este registro y los avisos de licencias de terceros (`THIRD-PARTY-NOTICES.md`) generados a partir de lo que de verdad contiene el bundle.
- Integración continua y flujo de release en GitHub Actions (linux-x64): verificación completa, empaquetado, aceptación del binario, `SHA256SUMS.txt`, atestación de procedencia SLSA y notas de la release tomadas de este fichero.
- Licencia MIT.

[Unreleased]: https://github.com/nunzi00/chameleon-cv/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/nunzi00/chameleon-cv/releases/tag/v1.0.0
