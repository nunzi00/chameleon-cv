# Chameleon CV

Generador de CVs dinámicos y personalizados a partir de tus propias fuentes (Markdown y CSV). Mantienes **un solo conjunto de datos** —experiencias, proyectos, logros, habilidades— y generas un CV distinto para cada especialidad con un comando. Todo se procesa en local: sin red, sin telemetría.

```
data/sources/ (tú editas)  ──cv build──►  data/dist/profile.json  ──cv generate-cv──►  output/cv-<nombre>-<especialidad>.md | .pdf
```

## Requisitos

- Node.js **≥ 22.12** (el proyecto usa `require(esm)` nativo).
- npm.

## Instalación

```bash
npm install
npm run build        # compila a dist/
npm link             # opcional: deja el comando `cv` disponible en tu PATH
```

Sin `npm link`, cualquier comando se ejecuta como `npm run cv -- <comando> [opciones]` (vía `ts-node`) o `node dist/index.js <comando>`.

## Flujo de trabajo

1. **Arranca** un espacio de trabajo y **escribe tus fuentes** en `data/sources/` (formato en la sección siguiente):
   ```bash
   cv init                  # crea data/sources/ con un dataset de ejemplo y un .gitignore; nunca sobrescribe nada
   ```
2. **Compila** el artefacto canónico (`data/dist/profile.json`, validado, permisos 0600). Es la puerta de calidad del perfil —el `tsc` de tus datos—: estricta, silenciosa si todo va bien y, si hay problemas, los verás **todos** a la vez con fichero y línea (`experience/acme.md:4: start: Fecha inválida: …`):
   ```bash
   cv build                 # compila (alias: build-profile)
   cv build --check         # no escribe: falla si las fuentes tienen problemas o el artefacto no está al día (para CI)
   cv validate              # solo comprueba las fuentes
   ```
3. **Adapta** el CV a una oferta si quieres (sección «Adaptar el CV a una oferta de empleo»).
4. **Genera** el CV:
   ```bash
   cv generate-cv --specialty backend            # output/cv-<nombre>-backend.md
   cv generate-cv                                # CV completo, sin selección
   cv generate-cv -s backend --explain           # además, explica en stderr qué se incluyó y por qué
   cv generate-cv -s backend --stdout            # imprime el Markdown en lugar de escribir un fichero
   cv generate-cv -s backend --format pdf        # output/cv-<nombre>-backend.pdf (fuente embebida, sin dependencias externas)
   ```

Si editas las fuentes y olvidas recompilar, `generate-cv` te avisa: `Aviso: experience/acme.md es más reciente que el artefacto; ejecuta «cv build»`. Con `--build`, `generate-cv` y `analyze-offer` recompilan el artefacto antes de trabajar (equivale a un `cv build` previo).

## Comandos

| Comando | Qué hace | Opciones |
|---|---|---|
| `cv init [dir]` | Crea un espacio de trabajo: `data/sources/` con el dataset de ejemplo (permisos 0600) y un `.gitignore` con `data/dist/` y `output/`. Si algún destino existe, lista los conflictos y no escribe nada. | `--template <dir>` (dataset de ejemplo alternativo) |
| `cv validate` | Comprueba las fuentes sin escribir nada. | `-d, --data <dir>` (por defecto `data/sources`) |
| `cv build` (alias `build-profile`) | Compila las fuentes y escribe el artefacto canónico: la puerta de calidad del perfil. Silencioso en éxito. | `-d, --data <dir>` · `-o, --out <file>` (por defecto `data/dist/profile.json`) · `--check` (no escribe; falla si las fuentes tienen problemas o el artefacto falta o no está al día) · `-v, --verbose` |
| `cv generate-cv` | Genera el CV en Markdown o PDF (pdfkit o Typst) a partir del artefacto. | `--build` (recompila antes) · `-s, --specialty <id>` · `-f, --from-job-offer <file>` (texto o PDF; `-` = stdin, solo texto) · `--format <md\|pdf>` · `--engine <pdfkit\|typst>` · `--typst-path <file>` · `--typst-any-version` · `-n, --top-n <n>` · `--max-skills <n>` · `--max-projects <n>` · `--max-certifications <n>` · `--compact` · `-p, --profile <file>` · `-o, --output <file>` · `-t, --template <file>` · `-l, --locale <locale>` · `--explain` · `--stdout` · `-d, --data <dir>` (solo para el aviso de artefacto obsoleto) |
| `cv analyze-offer <offer>` | Analiza una oferta contra el perfil sin generar nada: adecuación, evidencias y carencias. | `--build` (recompila antes) · `-s, --specialty <id>` · `-p, --profile <file>` · `--explain` (auditoría por ítem) · `--json` (para scripts) · `<offer>` puede ser `-` (stdin) |
| `cv typst install` | Descarga el release oficial de Typst 0.15.1 para tu plataforma, verifica su SHA-256 contra `src/typst/releases.json` y lo instala en la caché de usuario. Única operación de red de `cv`. | `--force` (reinstala) |
| `cv llm status` | Proveedor y modelo de IA locales que se usarían (`CHAMELEON_LLM_*`), si responden y qué claves remotas hay definidas (solo nombres). Nunca envía datos. | — |
| `cv typst status` | Qué binario de Typst se usaría (`--typst-path`, `CHAMELEON_TYPST`, caché, `PATH`), su versión y si es utilizable (código 0). | — |

Códigos de salida: `0` correcto · `1` datos inválidos (fuentes, artefacto o especialidad desconocida) · `2` uso incorrecto o fallo del entorno (permisos, disco, plantilla ilegible).

## Formato de las fuentes

Un dataset es un directorio con esta forma (especificación completa en [`docs/formato-dataset.md`](docs/formato-dataset.md) y [`docs/formato-csv.md`](docs/formato-csv.md); ejemplo real en [`tests/fixtures/dataset/`](tests/fixtures/dataset/)):

```
data/sources/
├── profile.md            # datos personales, idiomas y resumen por defecto (obligatorio)
├── specialties/*.md      # una «versión» de tu CV por fichero: backend.md, engineering-manager.md…
├── experience/*.md       # una experiencia por fichero
├── projects/*.md         # un proyecto por fichero
├── education/*.md        # una formación por fichero
├── achievements.md       # logros transversales (premios, ponencias…)
├── skills.csv            # habilidades
└── certifications.csv    # certificaciones
```

Cada entidad es un fichero Markdown con **frontmatter YAML para los datos y cuerpo para el texto**:

```markdown
---
company: ACME Corp
role: Senior Backend Engineer
start: 2021-03
end: 2024-06                 # vacío o ausente = en curso
tags: [php, symfony]
technologies: [PHP 8.3, Symfony 6.4]
---

Resumen de la experiencia, en Markdown.

## Logros

- Reduje la latencia p95 un **40 %**. #performance #php
  - impact: -40 % p95
  - date: 2023-05
```

Reglas que conviene saber: las claves son las del esquema (en inglés); el `id` de cada entidad sale del nombre del fichero (`experience/acme.md` → `exp-acme`); una clave, sección o fichero desconocidos son un error (nada se ignora en silencio); las fechas son `YYYY`, `YYYY-MM` o `YYYY-MM-DD`.

## Especialidades y etiquetas: cómo se elige el contenido

Una especialidad (`specialties/backend.md`) define el **titular**, un **resumen** opcional y su **vocabulario** de tags:

```markdown
---
title: Senior Backend Engineer
tags: [php, symfony, kubernetes, kafka]
---

Resumen específico para este tipo de puesto.
```

La regla de selección cabe en una frase: **sin tags, siempre; con tags, solo si alguna coincide** con el vocabulario de la especialidad (o con su id: `#backend` fija un ítem a esa especialidad). Consecuencias prácticas:

- Un dataset sin etiquetar genera el CV completo para cualquier especialidad. Cada tag que añades es una restricción: el etiquetado es progresivo y nunca «rompe» un CV.
- **Etiqueta los logros, no las experiencias.** Una experiencia sin tags aparece en todos los CV (continuidad de la carrera); los logros etiquetados adaptan las viñetas a cada especialidad. Etiqueta una experiencia solo cuando *todo* el puesto sea irrelevante para alguna especialidad.
- Una experiencia o proyecto cuyas tags no coinciden entra igualmente si alguno de sus logros coincide de forma explícita (solo con los logros relevantes).
- `--explain` muestra cada decisión: `+ experience exp-acme: universal`, `    - exp-acme-3: no-match`, `+ projects proj-platform: via-achievements`.

Detalles y ejemplos en [`docs/selector-engine.md`](docs/selector-engine.md).

## Anclar lo imprescindible: `#pin`

La etiqueta reservada `#pin` fija un ítem por encima de cualquier algoritmo: aparece en **toda** especialidad u oferta, va **primero** en su sección y **nunca se recorta** (`--top-n`, `--max-*`, `--compact`). Sirve para logros, experiencias, proyectos, skills y certificaciones; en Markdown va al final de la viñeta o en `tags` del frontmatter, y en CSV en la columna `tags`:

```markdown
- Lideré la migración a Kubernetes sin ventana de parada. #kubernetes #pin
```

Anclar no cambia la adecuación medida: `pin` no puntúa ni forma parte del vocabulario de las ofertas, y `--explain` lo muestra como razón `pinned`. Un anclado consume plaza del límite; si hay más anclados que plazas, sobreviven todos ellos. Una especialidad no puede llamarse `pin` ni usar esa etiqueta.

## Adaptar el CV a una oferta de empleo

Guarda la oferta en un fichero de texto **o en PDF** (el texto se extrae en un proceso aislado, con límites de 10 MiB y 50 páginas), o pégala por la entrada estándar, y:

```bash
cv analyze-offer ofertas/acme-backend.txt          # ¿encajo? qué demuestro, qué no y qué me falta
cv generate-cv -f ofertas/acme-backend.txt         # CV afinado: output/cv-<nombre>-acme-backend.md
cv generate-cv -f ofertas/acme-backend.txt -s backend --top-n 4 --max-skills 12
cv generate-cv -f - --compact < oferta.txt         # oferta por stdin, preset de una página
```

Cómo funciona, en tres frases: **`--specialty` elige la versión del CV, `--from-job-offer` la afina y los límites la condensan.**

- **El perfil es el diccionario.** La oferta se lee buscando tu propio vocabulario: tags, nombres y alias de tus skills (`k8s`, `tech lead`). Lo que la oferta pide y tu perfil ni siquiera tiene etiquetado sale como *carencia*. Si tienes algo y no se reconoce, etiquétalo o añade un alias en `skills.csv`.
- **Puntuación transparente.** Cada requisito pesa según dónde aparece (`Requisitos` 1.0 · resto 0.75 · `Deseable` 0.5, con refuerzo por repetición) y cada ítem suma los pesos de sus tags. Los logros dentro de cada experiencia y las skills se reordenan por puntuación; experiencias, formación, proyectos y certificaciones siguen cronológicos.
- **Recorte «N mejores».** `--top-n` limita los logros por experiencia/proyecto y los transversales; `--max-skills`, `--max-projects` y `--max-certifications`, el resto. `--compact` equivale a `--top-n 4 --max-skills 12 --max-projects 4 --max-certifications 5`. Los ítems sin tags puntúan 0: van detrás y son los primeros en caer. Sin oferta, todos puntúan 0 y `--top-n` conserva los N primeros tal como los escribiste.
- `--explain` cuenta cada decisión: qué entró y por qué, qué puntuó cuánto y qué se recortó. `cv analyze-offer --json` da lo mismo en JSON para scripts.

Especificación: [`docs/scoring.md`](docs/scoring.md) y [`docs/trimming-cli.md`](docs/trimming-cli.md).

## Plantillas propias

El CV se renderiza con Handlebars a partir de un modelo de vista ya formateado (fechas según el idioma, periodos, skills agrupadas por categoría, línea de contacto). La plantilla base es [`templates/cv.md.hbs`](templates/cv.md.hbs); cópiala, adáptala y pásala con `--template mi-plantilla.hbs`. La plantilla solo aplica al Markdown: el PDF (`--format pdf`) se maqueta con código a partir del mismo modelo de vista, con la fuente Source Sans 3 (licencia OFL, en `templates/fonts/`) embebida, y no admite `--stdout` ni `--template`. Las etiquetas de sección (`labels.experience`, `labels.present`…) salen del idioma (`meta.locale` del perfil o `--locale`): hay tablas en castellano e inglés.

## Motor PDF de calidad editorial: Typst (opcional)

`--format pdf` usa `pdfkit` por defecto: cero dependencias y un resultado correcto. Para un CV de **calidad de publicación**, `--engine typst` maqueta el mismo contenido con [Typst](https://typst.app) (0.15.1): jerarquía tipográfica cuidada (versalitas en las secciones, fechas alineadas a la derecha, tabla de skills, pie «nombre · n / total» solo si hay varias páginas), kerning y silabación profesionales, PDF etiquetado (accesible) y determinista, con la misma fuente Source Sans 3 embebida. Ambos motores parten de la **misma vista estructurada** del perfil: cambia la maquetación, nunca el contenido (la suite lo comprueba extrayendo el texto de los dos PDF).

### Cómo

```bash
cv typst install                                            # 1. descarga el release oficial para tu plataforma y lo verifica (una sola vez)
cv typst status                                             # 2. qué binario se usaría, su versión y de dónde sale (código 0 si es utilizable)
cv generate-cv -s backend --format pdf --engine typst       # 3. output/cv-<nombre>-backend.pdf con el diseño de referencia
cv generate-cv -f oferta.pdf --compact --format pdf --engine typst   # todo lo demás (ofertas, recortes, #pin, --explain) funciona igual
```

`cv typst install` es la **única operación de red** de `cv`, y solo ocurre cuando tú la pides: descarga por https con límite de tamaño, calcula el SHA-256 en streaming y lo compara con el manifiesto `src/typst/releases.json` (hashes fijados al versionar; un fichero alterado se elimina sin instalarse), extrae con el `tar` del sistema en un directorio temporal, comprueba `--version` y solo entonces coloca el binario en tu caché de usuario (`~/.cache/chameleon-cv/typst/0.15.1/typst`, permisos 0700; `~/Library/Caches` en macOS, `%LOCALAPPDATA%` en Windows). También sirve un Typst 0.15.1 ya instalado en el `PATH`, la variable `CHAMELEON_TYPST` o `--typst-path` (`--typst-any-version` acepta otra versión bajo tu responsabilidad).

Al generar, Typst se ejecuta como proceso hijo **contenido**: stdin/stdout sin ficheros intermedios (tus datos nunca pasan por argumentos ni por disco), `--root` limitado al directorio de la plantilla, entorno vacío con interruptor de red (ningún paquete `@preview` se descarga jamás), solo las fuentes de `templates/fonts`, 20 s y 32 MiB de límite. Sin binario, código 2 y la instrucción; una plantilla que no compila, código 1 con el diagnóstico de Typst.

### Personalización

El diseño de referencia es [`templates/typst/cv.typ`](templates/typst/cv.typ). Para adaptarlo o sustituirlo, copia ese fichero a tu directorio, edítalo y pásalo con `-t`:

```bash
cp templates/typst/cv.typ plantillas/mi-plantilla.typ
cv generate-cv -s backend --format pdf --engine typst -t plantillas/mi-plantilla.typ
```

Tu plantilla solo tiene que exportar una función `cv(d)` que reciba la vista estructurada (nombre, contacto, resumen, experiencias, proyectos, skills, logros, formación, certificaciones e idiomas, con el Markdown en línea ya descompuesto en negritas, cursivas, código y enlaces). El contrato completo, las reglas del contenedor (qué puede leer e importar una plantilla) y un ejemplo mínimo están en [`docs/plantillas-typst.md`](docs/plantillas-typst.md).

## Co-piloto de IA (en construcción)

El Hito 4 añade un co-piloto que **sugiere** (reescribir logros, resumir, proponer etiquetas) y nunca decide ni escribe en tus fuentes; doctrina en [`docs/llm-integration.md`](docs/llm-integration.md). En esta versión solo está la base: proveedor local abstracto (Ollama nativo o cualquier servidor compatible con la API de OpenAI **en loopback**), seudonimización y el diagnóstico:

```bash
cv llm status   # proveedor y modelo locales que se usarían y si responden; código 0 si es utilizable. Nunca envía datos.
```

Configuración solo por variables `CHAMELEON_LLM_PROVIDER` (`ollama` por defecto, o `openai-compatible`), `CHAMELEON_LLM_BASE_URL` (por defecto `http://127.0.0.1:11434` u `:8080`; cualquier dirección que no sea local se rechaza) y `CHAMELEON_LLM_MODEL` (por defecto `qwen2.5:7b-instruct`). Los proveedores remotos exigirán `--provider` explícito en cada orden (T-4.5); las claves solo se leerán de `CHAMELEON_OPENAI_API_KEY`/`CHAMELEON_ANTHROPIC_API_KEY` o de un fichero 0600.

## Seguridad y privacidad

- Todo se procesa en local; la herramienta no abre conexiones de red ni envía telemetría.
- `data/dist/profile.json` y los CV de `output/` (Markdown y PDF) contienen datos personales: se escriben con permisos `0600` (solo tu usuario) y ambos directorios están en `.gitignore`. Si algún día este repositorio tuviera remoto, excluye también `data/sources/`.
- Solo se leen ficheros `.md`/`.csv` dentro del dataset; los enlaces simbólicos que apuntan fuera son un error; YAML sin tipado implícito ni alias; toda entrada pasa por un esquema estricto (longitudes, caracteres de control, URLs solo `http(s)`).
- Las ofertas en PDF se procesan en un *worker* aislado con límites (10 MiB, 50 páginas, 20 s, 512 MB), sin cargar fuentes ni renderizar; el PDF generado no contiene código ni acciones automáticas y se produce sin red ni binarios externos.
- El artefacto se **re-valida** cada vez que se lee: no se confía en un fichero de disco aunque lo hayamos escrito nosotros.

## Desarrollo

```bash
npm run typecheck    # TypeScript estricto (src y tests)
npm test             # suite (Vitest)
npm run coverage     # cobertura: umbral 100 % en src/core, src/parsers, src/renderers, src/artifact, src/cli y src/shared
npm run dev          # ts-node con recarga
```

Documentación de diseño: [`docs/arquitectura.md`](docs/arquitectura.md) (ecosistema de datos y capa de inteligencia), [`docs/formato-dataset.md`](docs/formato-dataset.md), [`docs/formato-csv.md`](docs/formato-csv.md), [`docs/selector-engine.md`](docs/selector-engine.md), [`docs/scoring.md`](docs/scoring.md), [`docs/trimming-cli.md`](docs/trimming-cli.md), [`docs/pdf-integration.md`](docs/pdf-integration.md), [`docs/typst-integration.md`](docs/typst-integration.md) y [`docs/plantillas-typst.md`](docs/plantillas-typst.md). Plan de trabajo: [`ROADMAP.md`](ROADMAP.md).
