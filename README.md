# Chameleon CV

Generador de CVs dinámicos y personalizados a partir de tus propias fuentes (Markdown y CSV). Mantienes **un solo conjunto de datos** —experiencias, proyectos, logros, habilidades— y generas un CV distinto para cada especialidad con un comando. Todo se procesa en local: sin red, sin telemetría.

```
data/sources/ (tú editas)  ──cv build-profile──►  data/dist/profile.json  ──cv generate-cv──►  output/cv-<nombre>-<especialidad>.md
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

1. **Escribe tus fuentes** en `data/sources/` (formato en la sección siguiente). Para empezar, copia el dataset de ejemplo: `cp -r tests/fixtures/dataset/* data/sources/`.
2. **Comprueba** que todo es válido:
   ```bash
   cv validate
   ```
   Si hay problemas, los verás **todos** a la vez, con fichero y línea: `experience/acme.md:4: start: Fecha inválida: …`.
3. **Compila** el artefacto canónico (`data/dist/profile.json`, validado, permisos 0600). Silencioso si todo va bien:
   ```bash
   cv build-profile
   ```
4. **Genera** el CV:
   ```bash
   cv generate-cv --specialty backend            # output/cv-<nombre>-backend.md
   cv generate-cv                                # CV completo, sin selección
   cv generate-cv -s backend --explain           # además, explica en stderr qué se incluyó y por qué
   cv generate-cv -s backend --stdout            # imprime el Markdown en lugar de escribir un fichero
   ```

Si editas las fuentes y olvidas recompilar, `generate-cv` te avisa: `Aviso: experience/acme.md es más reciente que el artefacto; ejecuta «cv build-profile»`.

## Comandos

| Comando | Qué hace | Opciones |
|---|---|---|
| `cv validate` | Comprueba las fuentes sin escribir nada. | `-d, --data <dir>` (por defecto `data/sources`) |
| `cv build-profile` | Compila las fuentes y escribe el artefacto canónico. Silencioso en éxito. | `-d, --data <dir>` · `-o, --out <file>` (por defecto `data/dist/profile.json`) · `-v, --verbose` |
| `cv generate-cv` | Genera el CV en Markdown a partir del artefacto. | `-s, --specialty <id>` · `-f, --from-job-offer <file>` (`-` = stdin) · `-n, --top-n <n>` · `--max-skills <n>` · `--max-projects <n>` · `--max-certifications <n>` · `--compact` · `-p, --profile <file>` · `-o, --output <file>` · `-t, --template <file>` · `-l, --locale <locale>` · `--explain` · `--stdout` · `-d, --data <dir>` (solo para el aviso de artefacto obsoleto) |
| `cv analyze-offer <offer>` | Analiza una oferta contra el perfil sin generar nada: adecuación, evidencias y carencias. | `-s, --specialty <id>` · `-p, --profile <file>` · `--explain` (auditoría por ítem) · `--json` (para scripts) · `<offer>` puede ser `-` (stdin) |

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

## Adaptar el CV a una oferta de empleo

Guarda el texto de la oferta en un fichero (o pégalo por la entrada estándar) y:

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

El CV se renderiza con Handlebars a partir de un modelo de vista ya formateado (fechas según el idioma, periodos, skills agrupadas por categoría, línea de contacto). La plantilla base es [`templates/cv.md.hbs`](templates/cv.md.hbs); cópiala, adáptala y pásala con `--template mi-plantilla.hbs`. Las etiquetas de sección (`labels.experience`, `labels.present`…) salen del idioma (`meta.locale` del perfil o `--locale`): hay tablas en castellano e inglés.

## Seguridad y privacidad

- Todo se procesa en local; la herramienta no abre conexiones de red ni envía telemetría.
- `data/dist/profile.json` y los CV de `output/` contienen datos personales: se escriben con permisos `0600` (solo tu usuario) y ambos directorios están en `.gitignore`. Si algún día este repositorio tuviera remoto, excluye también `data/sources/`.
- Solo se leen ficheros `.md`/`.csv` dentro del dataset; los enlaces simbólicos que apuntan fuera son un error; YAML sin tipado implícito ni alias; toda entrada pasa por un esquema estricto (longitudes, caracteres de control, URLs solo `http(s)`).
- El artefacto se **re-valida** cada vez que se lee: no se confía en un fichero de disco aunque lo hayamos escrito nosotros.

## Desarrollo

```bash
npm run typecheck    # TypeScript estricto (src y tests)
npm test             # suite (Vitest)
npm run coverage     # cobertura: umbral 100 % en src/core, src/parsers, src/renderers, src/artifact, src/cli y src/shared
npm run dev          # ts-node con recarga
```

Documentación de diseño: [`docs/arquitectura.md`](docs/arquitectura.md) (ecosistema de datos y capa de inteligencia), [`docs/formato-dataset.md`](docs/formato-dataset.md), [`docs/formato-csv.md`](docs/formato-csv.md), [`docs/selector-engine.md`](docs/selector-engine.md). Plan de trabajo: [`ROADMAP.md`](ROADMAP.md).
