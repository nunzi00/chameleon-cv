# Chameleon CV

[![CI](https://github.com/lucasnunzi/chameleon-cv/actions/workflows/ci.yml/badge.svg)](https://github.com/lucasnunzi/chameleon-cv/actions/workflows/ci.yml)

Generador de CVs dinámicos y personalizados a partir de tus propias fuentes (Markdown y CSV). Mantienes **un solo conjunto de datos** —experiencias, proyectos, logros, habilidades— y generas un CV distinto para cada especialidad con un comando. Todo se procesa en local: sin red, sin telemetría.

```
data/sources/ (tú editas)  ──cv build──►  data/dist/profile.json  ──cv generate-cv──►  output/cv-<nombre>-<especialidad>.md | .pdf
```

## Qué hace

- **Un perfil, muchos CV.** Escribes tus fuentes una vez (Markdown y CSV, validadas con rigor) y cada especialidad —`backend`, `engineering-manager`…— genera su propia versión con un comando.
- **Adaptación a una oferta** (texto, entrada estándar o PDF): el CV se afina con una puntuación transparente y se recorta a lo mejor; `analyze-offer` dice qué demuestras y qué te falta.
- **Salida** en Markdown (plantillas Handlebars) o PDF: pdfkit sin dependencias, o Typst con temas de calidad editorial (`default`, `classic` o los tuyos).
- **Co-piloto de IA** que sugiere y nunca decide: reescrituras, resúmenes y etiquetas verificados por código, local por defecto y con consentimiento explícito para cualquier proveedor remoto.
- **Distribución cuidada**: ejecutable autónomo para linux-x64 con `sha256` y atestación de procedencia, o directamente desde el repositorio. Licencia MIT.

## Requisitos

- **Ejecutable autónomo**: Linux x86-64 con glibc ≥ 2.28; no necesita Node. El motor Typst es opcional (`cv typst install`).
- **Desde el repositorio**: Node.js **≥ 22.12** (el proyecto usa `require(esm)` nativo) y npm; para empaquetar el ejecutable, Node ≥ 26.

## Instalación

**Ejecutable autónomo** (recomendado): un único fichero que lleva dentro el runtime, los temas, las fuentes, las plantillas y los prompts. Descarga de [la página de *Releases*](https://github.com/lucasnunzi/chameleon-cv/releases) el archivo `chameleon-cv-<versión>-linux-x64.tar.gz` y su `.sha256`, verifica y extrae:

```bash
sha256sum -c chameleon-cv-<versión>-linux-x64.tar.gz.sha256      # «OK»: el archivo es exactamente el publicado
tar -xzf chameleon-cv-<versión>-linux-x64.tar.gz && cd chameleon-cv-<versión>-linux-x64
./cv --version                                  # funciona desde cualquier directorio: copia `cv` a tu PATH si quieres
gh attestation verify chameleon-cv-<versión>-linux-x64.tar.gz --owner lucasnunzi   # opcional: procedencia SLSA firmada
```

El archivo incluye `LICENSE`, `CHANGELOG.md`, `THIRD-PARTY-NOTICES.md` (licencias de Node.js y de los paquetes embebidos) y `LICENSE-SourceSans3.md`. Los assets que necesitan ser ficheros reales (temas y fuentes para Typst, dataset de `cv init`) se materializan en la caché de usuario (`~/.cache/chameleon-cv/assets/<versión>/`), con su SHA-256 comprobado en cada uso. El mismo archivo se construye en local con `npm install && npm run package` (Node ≥ 26; queda en `build/release/`).

**Desde el repositorio** (desarrollo):

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
| `cv generate-cv` | Genera el CV en Markdown o PDF (pdfkit o Typst) a partir del artefacto. | `--build` (recompila antes) · `-s, --specialty <id>` · `-f, --from-job-offer <file>` (texto o PDF; `-` = stdin, solo texto) · `--format <md\|pdf>` · `--engine <pdfkit\|typst>` · `--typst-path <file>` · `--typst-any-version` · `-n, --top-n <n>` · `--max-skills <n>` · `--max-projects <n>` · `--max-certifications <n>` · `--compact` · `-p, --profile <file>` · `-o, --output <file>` · `-t, --template <file>` · `-l, --locale <locale>` · `--explain` · `--stdout` · `-d, --data <dir>` (solo para el aviso de artefacto obsoleto) · `--theme <nombre>` (tema de Typst: `themes/<nombre>/`, por defecto `default`) |
| `cv analyze-offer <offer>` | Analiza una oferta contra el perfil sin generar nada: adecuación, evidencias y carencias. | `--build` (recompila antes) · `-s, --specialty <id>` · `-p, --profile <file>` · `--explain` (auditoría por ítem) · `--json` (para scripts) · `<offer>` puede ser `-` (stdin) |
| `cv typst install` | Descarga el release oficial de Typst 0.15.1 para tu plataforma, verifica su SHA-256 contra `src/typst/releases.json` y lo instala en la caché de usuario. Única operación de red de `cv`. | `--force` (reinstala) |
| `cv improve` | Co-piloto: propone reescrituras con más impacto para los logros seleccionados y las verifica (canon C2); escribe un fichero de revisión, nunca tus fuentes. | `-s` · `-f` · `-n/--max-*/--compact` · `--only <ids>` · `--proposals <1-3>` · `--max-length <n>` · `--max-items <n>` · `--redact-companies` · `-l` · `-o` · `--no-cache` · `--show-prompt` · `--show-payload` · `--dry-run` · `-p` · `-d` · `--provider <openai\|anthropic>` · `--model <name>` · `--yes` · `--build` |
| `cv improve apply <revisión>` | Aplica a tus fuentes las propuestas marcadas `[x]` en una revisión de `improve` o `summarize`: solo lo marcado, cambio mínimo, copia `<fichero>.bak` previa y huella comprobada (si el original cambió, no escribe nada). La única orden que escribe en `data/sources/`. | `-d` · `--dry-run` · `--delete-review` |
| `cv summarize` | Co-piloto: propone el resumen profesional a partir del perfil filtrado (especialidad, oferta, límites) y lo verifica (canon C2); fichero de revisión, nunca tus fuentes. | `-s` · `-f` · `-n/--max-*/--compact` · `--paragraphs <1-3>` · `--proposals <1-3>` · `--max-length <n>` · `--redact-companies` · `-l` · `-o` · `--no-cache` · `--show-prompt` · `--show-payload` · `--dry-run` · `-p` · `-d` · `--provider <openai\|anthropic>` · `--model <name>` · `--yes` · `--build` |
| `cv suggest tags [texto]` | Co-piloto: propone, solo del diccionario cerrado (las tags de tus especialidades), las etiquetas de un texto («-» = stdin) o de los logros del perfil, con la evidencia de cada una calculada por código; imprime por stdout la línea lista para pegar (`#tag1 #tag2`), nunca toca tus fuentes. | `-s <esp>` (acota el diccionario) · `--only <ids>` · `--untagged` · `--max-tags <1-10>` · `--max-items <n>` · `--redact-companies` · `-l` · `--explain` · `--no-cache` · `--show-prompt` · `--show-payload` · `--dry-run` · `-p` · `-d` · `--provider` · `--model` · `--yes` · `--build` |
| `cv llm cache clear` | Vacía la caché local de respuestas del co-piloto. | — |
| `cv llm status` | Proveedor y modelo de IA locales que se usarían (`CHAMELEON_LLM_*`), si responden, de dónde saldría cada clave remota (nunca su valor) y la lista blanca de hosts. Sin `--provider` nunca envía datos; con `--provider openai|anthropic` comprueba también ese proveedor remoto. | `--provider <openai\|anthropic>` (accede a la red) · `--model <name>` |
| `cv typst status` | Qué binario de Typst se usaría (`--typst-path`, `CHAMELEON_TYPST`, caché, `PATH`), su versión y si es utilizable (código 0). | — |
| `cv theme list` | Temas de Typst disponibles: nombre, origen (distribuido o `themes/` del proyecto), descripción, validez y cuál es el tema por defecto (`cv.toml` o `default`). | — |
| `cv theme path <nombre>` | Ruta absoluta del directorio del tema (para copiarlo o editarlo); si existe pero no es utilizable, la imprime con un aviso. | — |
| `cv theme create <nombre>` | Crea `themes/<nombre>/` en tu proyecto a partir de un tema existente (`theme.toml` con el nuevo nombre y `template.typ`, más `fonts/` si lo tiene); nunca sobrescribe. | `--from <tema>` (por defecto `default`) |

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

Al generar, Typst se ejecuta como proceso hijo **contenido**: stdin/stdout sin ficheros intermedios (tus datos nunca pasan por argumentos ni por disco), `--root` limitado al directorio de la plantilla, entorno vacío con interruptor de red (ningún paquete `@preview` se descarga jamás), solo las fuentes de `templates/fonts` (y las del tema), 20 s y 32 MiB de límite. Sin binario, código 2 y la instrucción; una plantilla que no compila, código 1 con el diagnóstico de Typst.

### Temas y personalización

El aspecto lo decide un **tema**: un directorio `themes/<nombre>/` con `theme.toml` —las variables de diseño: colores, tipografías, tamaños, espaciados y página, **validadas** antes de arrancar Typst— y `template.typ`, la maquetación, que recibe la vista estructurada y esas variables. El tema `default` distribuido es el diseño de referencia; `--theme <nombre>` elige otro, buscándolo primero en `themes/` de tu proyecto y después entre los distribuidos.

Se distribuyen dos temas: **`default`** (Source Sans 3, jerarquía sobria con versalitas y fechas alineadas) y **`classic`** (serif Libertinus, cabecera centrada bajo un doble filete, secciones en mayúsculas y cuerpo justificado: aire académico o tradicional). Ambos maquetan exactamente el mismo contenido; la suite lo comprueba extrayendo el texto de los PDF.

```bash
cv theme list                                                        # qué temas hay, de dónde salen y cuál es el de por defecto
cv theme create mio --from classic                                   # 1. themes/mio/ en tu proyecto a partir de un tema existente
$EDITOR themes/mio/theme.toml                                         # 2. colores, fuentes, tamaños, márgenes o papel, sin tocar código
cv generate-cv -s backend --format pdf --engine typst --theme mio    # 3. genera con tu tema
cv theme path classic                                                # dónde vive un tema, para mirarlo o copiar sus ficheros
```

Un extracto de [`themes/default/theme.toml`](themes/default/theme.toml) (el fichero completo está comentado):

```toml
[colors]
primary = "#1b1b1b"      # nombre y títulos de entrada
secondary = "#5c5c5c"    # metadatos, fechas y etiquetas de sección
accent = "#1f4e79"       # enlaces

[fonts]
body = "Source Sans 3"   # Source Sans 3 (templates/fonts), las embebidas en Typst o .ttf/.otf en themes/mio/fonts/

[sizes]                  # en puntos
name = 24
body = 10

[page]
paper = "a4"             # a4, a5, a3, us-letter, us-legal

[page.margins]           # en milímetros
top = 17
```

Una clave desconocida, un color que no sea `#rrggbb` o un tamaño fuera de rango se rechazan con la ruta del error (`colors.primary: …`) antes de arrancar Typst.

**`cv.toml`, el centro de configuración del proyecto.** Un fichero opcional en la raíz del proyecto cuya sección `[theme]` elige el tema por defecto (`name`; `--theme` prevalece) y **anula** valores del `theme.toml` del tema en uso —con su mismo vocabulario y su misma validación— solo para esa ejecución, sin bifurcar el tema. `--explain` dice qué tema se usa y qué anula.

```toml
[theme]
name = "classic"          # tema por defecto del proyecto

[theme.colors]
primary = "#7a1f1f"       # anula solo esta clave del theme.toml de classic

[theme.fonts]
body = "Source Sans 3"
```
 Para cambiar la **maquetación**, edita `template.typ` del tema: debe exportar `cv(d, theme)`, que recibe la vista estructurada (nombre, contacto, resumen, experiencias, proyectos, skills, logros, formación, certificaciones e idiomas, con el Markdown en línea ya descompuesto) y el tema ya validado; `-t plantilla.typ` sigue sirviendo para una plantilla suelta, que recibe el mismo `theme`. El contrato completo, las reglas del contenedor (qué puede leer e importar una plantilla) y un ejemplo mínimo están en [`docs/plantillas-typst.md`](docs/plantillas-typst.md).

## Co-piloto de IA

El co-piloto **sugiere** y nunca decide ni escribe en tus fuentes: la doctrina completa (cánones C1–C14) está en [`docs/llm-integration.md`](docs/llm-integration.md). Es **local por defecto** y solo habla con un servidor de modelos en tu propia máquina (loopback); los proveedores remotos (`openai`, `anthropic`) exigen `--provider` explícito en cada orden, muestran el coste estimado y piden confirmación antes de enviar nada (véase [Proveedores remotos](#proveedores-remotos-opcional)).

```bash
cv llm status                                   # proveedor y modelo locales que se usarían y si responden (nunca envía datos)
cv improve -s backend --top-n 3                 # propone reescrituras con más impacto para los logros de esa versión del CV
cv improve -f oferta.pdf --compact              # … para los que sobreviven a la adaptación, usando los términos de la oferta
cv improve --only exp-acme-1 --show-payload --dry-run   # muestra exactamente qué saldría (seudonimizado) sin enviar nada
cv improve --show-prompt                        # imprime el prompt versionado (prompts/improve.v1.md)
cv summarize -s backend                         # propone el resumen profesional («summary») a partir del perfil filtrado por esa especialidad
cv summarize -f oferta.pdf --paragraphs 3       # … orientado a una oferta, con el perfil adaptado a ella
cv suggest tags "Migré la plataforma a Kubernetes sin parada"   # etiquetas para un texto, solo del diccionario cerrado (las tags de tus especialidades)
cv suggest tags --untagged --explain            # … para los logros del perfil sin etiquetas, con la evidencia de cada una
cv improve apply output/revision-improve-2026-08-29.md   # aplica lo marcado [x] en la revisión: copia .bak previa y huella comprobada; nunca sin tu marca
cv improve apply output/revision-summarize-2026-08-29-backend.md --dry-run   # el plan, sin escribir nada
cv improve -s backend --provider openai        # remoto explícito: muestra el coste estimado y pide confirmación antes de enviar
cv summarize -s backend --provider anthropic --yes   # … --yes acepta el aviso por adelantado (scripts); --model elige el modelo
cv llm status --provider openai                 # comprueba ese proveedor remoto (clave, lista blanca, modelos); sin --provider no accede a la red
cv llm cache clear                              # vacía la caché local de respuestas
```

`cv improve` escribe un **fichero de revisión** (`output/revision-improve-<fecha>[-<esp>][-<oferta>].md`, permisos 0600) con, por logro, el original, cada propuesta y su **verificación**: el código comprueba —sin confiar en el modelo— que ninguna propuesta añade cifras, entidades o contexto que no estuvieran en el original ni omite cifras o entidades que sí estaban (canon C2, integridad semántica); las que fallan aparecen tachadas con el motivo (`VIOLATION_C2_FACT_OMITTED (40)`, `VIOLATION_C2_ENTITY_ADDED (Kubernetes)`…). Marca con `[x]` lo que quieras adoptar y cópialo a tus fuentes. Antes de enviar, la orden dice qué sale y a dónde: solo el texto del logro y su contexto inmediato, con tu nombre sustituido por `[NOMBRE]` (y las empresas por `[EMPRESA-n]` con `--redact-companies`); nunca email, teléfono, ubicación ni enlaces. Las respuestas válidas se guardan en tu caché de usuario (ficheros 0600) para que repetir sea gratis e idéntico (`--no-cache` para saltarla).

`cv summarize` hace lo mismo con el **resumen profesional**: envía una representación textual y seudonimizada del perfil **ya filtrado** (con los años de experiencia calculados por código, para que el modelo no tenga que inventarlos) y escribe `output/revision-summarize-<fecha>[-<esp>][-<oferta>].md` con dos o tres propuestas verificadas: se rechaza toda cifra o entidad que no esté en el perfil y toda propuesta que no mencione ninguno de los hechos clave (las etiquetas de la especialidad y los términos de la oferta que el perfil demuestra); cada propuesta indica qué hechos clave menciona y cuáles no. Copia la que prefieras al `summary` de `profile.md` o de la especialidad.

`cv suggest tags` cierra el ciclo con el motor determinista: el selector y el *scoring* dependen de las etiquetas, y este comando propone —**solo del diccionario cerrado** formado por las tags de tus especialidades— las que un texto («-» = stdin) o los logros del perfil (`--only <ids>`, `--untagged`, `-s` para acotar el diccionario a una especialidad) demuestran. El modelo recibe el diccionario como enumeración del esquema de salida y, además, el código verifica cada etiqueta devuelta: lo que no está en el diccionario se rechaza (`VIOLATION_CLOSED_DICTIONARY`), `pin` está reservada, no hay duplicados ni más de `--max-tags`, y cada etiqueta aceptada lleva su **evidencia calculada por código** (`literal` en el texto, en el `contexto` del puesto —rol, tecnologías, tags del contenedor— o `inferida` por el modelo; `--explain` la muestra junto a la justificación). La salida por stdout es la línea lista para pegar al final de la viñeta del logro (`#php #kubernetes`), precedida de `<id>:` cuando se etiquetan logros del perfil; el resto va por stderr y nunca se toca ninguna fuente.

**Cerrar el ciclo: `cv improve apply <revisión>`.** Marca con `[x]` en el fichero de revisión (de `improve` o de `summarize`) las propuestas que quieras adoptar —puedes retocar su texto— y aplícalas. Es la única orden que escribe en `data/sources/`, y lo hace con cuatro garantías: **solo lo marcado** (una propuesta por ítem); **cambio mínimo**, sustituye únicamente el texto del logro (los `#hashtags`, los metadatos y el resto del fichero quedan byte a byte iguales) o el resumen (cuerpo de `profile.md` o de `specialties/<id>.md`); **copia de seguridad previa**, `<fichero>.bak` (y `.bak.1`, `.bak.2`… si ya existía: nunca se sobrescribe una copia; el compilador las ignora); y **comprobación por huella**: la revisión registra el fichero, la línea y el `sha256` de cada original (`Fuente: experience/acme.md:15 · sha256 …`), y si el original ya no está tal cual —lo editaste a mano, o la revisión es de otro momento— no se escribe nada y te lo dice. `--dry-run` muestra el plan, `--delete-review` elimina la revisión aplicada, y después recompila con `cv build`.

Configuración solo por variables `CHAMELEON_LLM_PROVIDER` (`ollama` por defecto, o `openai-compatible`: llama.cpp `llama-server`, LM Studio…), `CHAMELEON_LLM_BASE_URL` (por defecto `http://127.0.0.1:11434` u `:8080`; cualquier dirección que no sea local se rechaza) y `CHAMELEON_LLM_MODEL` (por defecto `qwen2.5:7b-instruct`). Con un modelo de 7B en CPU cuenta con 20–40 s por logro: usa `--only`, `--top-n` y `--max-items` para acotar el lote.

### Proveedores remotos (opcional)

Para usar la API de OpenAI (`--provider openai`, modelo por defecto `gpt-4o-mini`) o de Anthropic (`--provider anthropic`, `claude-sonnet-4-5`) se aplican, por diseño, cuatro reglas:

- **Solo explícito, en cada orden.** El remoto no puede ser el proveedor por defecto (`CHAMELEON_LLM_PROVIDER=openai` se rechaza): cada `improve` o `summarize` que quiera salir de tu máquina lo dice con `--provider openai|anthropic`; sin él, todo sigue siendo local. `--model <nombre>` elige el modelo.
- **Claves nunca interactivas ni en texto plano inseguro.** Se leen, en este orden, de la variable `CHAMELEON_OPENAI_API_KEY` / `CHAMELEON_ANTHROPIC_API_KEY` o del fichero `~/.config/chameleon-cv/keys.json` (`` si está definida; `%APPDATA%\chameleon-cv\keys.json` en Windows) con permisos **0600** y forma `{"openai": "sk-…", "anthropic": "sk-ant-…"}`. Un fichero legible por otros usuarios se rechaza con la orden `chmod 600` que lo arregla; el programa nunca pregunta la clave, nunca la imprime, nunca la guarda y no lee `OPENAI_API_KEY` ni variables de otras herramientas.
- **Lista blanca de hosts.** Solo `https` y solo hacia `api.openai.com` y `api.anthropic.com`; una pasarela propia exige declarar su host en `CHAMELEON_LLM_ALLOWED_HOSTS` (separados por comas) y la URL base en `CHAMELEON_OPENAI_BASE_URL` / `CHAMELEON_ANTHROPIC_BASE_URL`. Sin redirecciones: lo que no esté en la lista se rechaza en código antes de abrir la conexión.
- **Conciencia de coste.** Antes de la primera petición la orden muestra cuántas peticiones saldrán, una estimación de tokens de entrada (4 caracteres ≈ 1 token) y el máximo de salida, avisa de que puede incurrir en costes y pide confirmación (`s/N`); sin terminal interactiva se cancela salvo que pases `--yes`. Lo que sale es exactamente lo mismo que con un proveedor local: el fragmento seudonimizado que enseña `--show-payload`.

`cv llm status` dice de dónde saldría cada clave (`ninguna`, `definida en CHAMELEON_…`, `fichero de claves`, `permisos abiertos`) sin mostrar su valor, y con `--provider <remoto>` verifica clave, lista blanca y modelos disponibles.

## Seguridad y privacidad

- Todo se procesa en local; la herramienta no abre conexiones de red ni envía telemetría.
- `data/dist/profile.json` y los CV de `output/` (Markdown y PDF) contienen datos personales: se escriben con permisos `0600` (solo tu usuario) y ambos directorios están en `.gitignore`. Si versionas tu espacio de trabajo, recuerda que `data/sources/` contiene tus datos personales: mantenlo en un repositorio privado o exclúyelo también.
- `cv improve apply` es la única orden que escribe en `data/sources/`: solo con tu marca `[x]`, tras crear `<fichero>.bak` (0600) y comprobar por huella que el original no cambió; una revisión manipulada no puede apuntar fuera del directorio de fuentes.
- Solo se leen ficheros `.md`/`.csv` dentro del dataset; los enlaces simbólicos que apuntan fuera son un error; YAML sin tipado implícito ni alias; toda entrada pasa por un esquema estricto (longitudes, caracteres de control, URLs solo `http(s)`).
- Las ofertas en PDF se procesan en un *worker* aislado con límites (10 MiB, 50 páginas, 20 s, 512 MB), sin cargar fuentes ni renderizar; el PDF generado no contiene código ni acciones automáticas y se produce sin red ni binarios externos.
- El artefacto se **re-valida** cada vez que se lee: no se confía en un fichero de disco aunque lo hayamos escrito nosotros.

## Desarrollo

```bash
npm run typecheck    # TypeScript estricto (src y tests)
npm test             # suite (Vitest)
npm run coverage     # cobertura: umbral 100 % en toda la lógica de src/
npm run dev          # ts-node con recarga
npm run build && npm run test:acceptance:deterministic   # aceptación: el binario compilado sobre el banco de pruebas, coincidencia perfecta con lo esperado
npm run test:acceptance:ai                                # aceptación de IA con un modelo local (Ollama por defecto): valida el proceso, no el texto
npm run package                                           # ejecutable autónomo, prueba de humo y tar.gz reproducible con .sha256 y THIRD-PARTY-NOTICES.md (build/release/)
npm run release:notes -- 1.0.0                            # notas de la release de esa versión, extraídas de CHANGELOG.md (las usa el flujo de release)
```

Las pruebas de aceptación —qué prueban, cómo se ejecutan, cómo se regeneran deliberadamente los artefactos esperados y qué requiere la de IA— están en [`docs/acceptance-testing.md`](docs/acceptance-testing.md). La integración continua (`.github/workflows/ci.yml`, en cada push y pull request) ejecuta typecheck, cobertura al 100 % con Typst real y el arnés determinista; el release (`release.yml`, con un tag `vX.Y.Z`) exige que `CHANGELOG.md` tenga la sección de la versión, empaqueta linux-x64, acepta el binario con el arnés y publica el `tar.gz`, su `.sha256`, `SHA256SUMS.txt` y una atestación de procedencia con esas notas; `npm run package` produce el mismo ejecutable en local ([`docs/packaging-and-release.md`](docs/packaging-and-release.md)).

Documentación de diseño: [`docs/arquitectura.md`](docs/arquitectura.md) (ecosistema de datos y capa de inteligencia), [`docs/formato-dataset.md`](docs/formato-dataset.md), [`docs/formato-csv.md`](docs/formato-csv.md), [`docs/selector-engine.md`](docs/selector-engine.md), [`docs/scoring.md`](docs/scoring.md), [`docs/trimming-cli.md`](docs/trimming-cli.md), [`docs/pdf-integration.md`](docs/pdf-integration.md), [`docs/typst-integration.md`](docs/typst-integration.md), [`docs/plantillas-typst.md`](docs/plantillas-typst.md), [`docs/llm-integration.md`](docs/llm-integration.md), [`docs/acceptance-testing.md`](docs/acceptance-testing.md) y [`docs/packaging-and-release.md`](docs/packaging-and-release.md). Plan de trabajo: [`ROADMAP.md`](ROADMAP.md).

## Licencia

Chameleon CV es software libre bajo la [licencia MIT](LICENSE). Las fuentes Source Sans 3 de `templates/fonts/` se distribuyen bajo la SIL Open Font License 1.1 ([`templates/fonts/LICENSE-SourceSans3.md`](templates/fonts/LICENSE-SourceSans3.md)). El ejecutable autónomo incorpora Node.js y paquetes npm de terceros: sus licencias y avisos van en el `THIRD-PARTY-NOTICES.md` de cada archivo de release. Typst se descarga aparte, solo a petición, desde su release oficial (Apache-2.0). Historial de versiones: [`CHANGELOG.md`](CHANGELOG.md).
