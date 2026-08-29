# Registro de cambios

Todos los cambios notables de Chameleon CV se documentan aquí. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones, el [Versionado Semántico](https://semver.org/lang/es/). La sección de cada versión es la fuente de las notas de su release en GitHub: el flujo de release la extrae con `npm run release:notes -- <versión>` y se detiene si no existe, no lleva fecha o está vacía.

## [Unreleased]

### Añadido

- Portal de documentación (`website/`, VitePress) publicado en GitHub Pages: guía de usuario, referencia de comandos generada desde la ayuda de la CLI, tutoriales ejecutables verificados en la integración continua, sección para desarrolladores (arquitectura y cánones C1–C14, contribuir, pruebas, extender, empaquetado) y notas de diseño sincronizadas desde `docs/`. `CONTRIBUTING.md`. README reducido a puerta de entrada.
- Canon C14, «El núcleo es el producto».

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
