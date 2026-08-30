# Chameleon CV

[![CI](https://github.com/nunzi00/chameleon-cv/actions/workflows/ci.yml/badge.svg)](https://github.com/nunzi00/chameleon-cv/actions/workflows/ci.yml) [![Docs](https://github.com/nunzi00/chameleon-cv/actions/workflows/pages.yml/badge.svg)](https://nunzi00.github.io/chameleon-cv/)

Generador de CVs dinámicos y personalizados a partir de tus propias fuentes (Markdown y CSV). Mantienes **un solo conjunto de datos** —experiencias, proyectos, logros, habilidades— y generas un CV distinto para cada especialidad o para cada oferta de empleo con un comando. Todo se procesa en local: sin red, sin telemetría.

```
data/sources/ (tú editas)  ──cv build──►  data/dist/profile.json  ──cv generate-cv──►  output/cv-<nombre>-<especialidad>.md | .pdf
```

**Documentación completa: [nunzi00.github.io/chameleon-cv](https://nunzi00.github.io/chameleon-cv/)** — guía de usuario, referencia de cada comando, tutoriales paso a paso y sección para desarrolladores. Este README es la puerta de entrada.

## Qué hace

- **Un perfil, muchos CV.** Escribes tus fuentes una vez (Markdown y CSV, validadas con rigor) y cada especialidad —`backend`, `engineering-manager`…— genera su propia versión con un comando.
- **Adaptación a una oferta** (texto, entrada estándar o PDF): el CV se afina con una puntuación transparente y se recorta a lo mejor; `analyze-offer` dice qué demuestras y qué te falta.
- **Salida** en Markdown (plantillas Handlebars) o PDF: pdfkit sin dependencias, o Typst con temas de calidad editorial (`default`, `classic` o los tuyos).
- **Co-piloto de IA** que sugiere y nunca decide: reescrituras, resúmenes y etiquetas verificados por código, local por defecto y con consentimiento explícito para cualquier proveedor remoto.
- **Interfaz web local** (`cv serve --open`): las mismas tareas sin terminal —fuentes, validación, generación con visor de PDF, análisis de ofertas—, servida desde el propio ejecutable solo en `127.0.0.1`, con token de sesión y sin nada externo.
- **Distribución cuidada**: ejecutable autónomo para linux-x64 con `sha256` y atestación de procedencia, imagen Docker con Compose (incluido un modelo de IA local opcional), o directamente desde el repositorio. Licencia MIT.

## Requisitos

- **Ejecutable autónomo**: Linux x86-64 con glibc ≥ 2.28, `libstdc++` y `libatomic` (presentes en cualquier distribución de escritorio; en una imagen mínima de contenedor hay que instalarlas); no necesita Node. El motor Typst es opcional (`cv typst install`).
- **Desde el repositorio**: Node.js **≥ 22.12** (el proyecto usa `require(esm)` nativo) y npm; para empaquetar el ejecutable, Node ≥ 26.
- **Docker**: Docker Engine ≥ 24 con Compose v2 (o Docker Desktop); no necesita nada más.

## Instalación

**Ejecutable autónomo** (recomendado): un único fichero que lleva dentro el runtime, los temas, las fuentes, las plantillas y los prompts. Descarga de [la página de *Releases*](https://github.com/nunzi00/chameleon-cv/releases) el archivo `chameleon-cv-<versión>-linux-x64.tar.gz` y su `.sha256`, verifica y extrae:

```bash
sha256sum -c chameleon-cv-<versión>-linux-x64.tar.gz.sha256      # «OK»: el archivo es exactamente el publicado
tar -xzf chameleon-cv-<versión>-linux-x64.tar.gz && cd chameleon-cv-<versión>-linux-x64
./cv --version                                  # funciona desde cualquier directorio: copia `cv` a tu PATH si quieres
gh attestation verify chameleon-cv-<versión>-linux-x64.tar.gz --owner nunzi00   # opcional: procedencia SLSA firmada
```

El archivo incluye `LICENSE`, `CHANGELOG.md`, `THIRD-PARTY-NOTICES.md` (licencias de Node.js y de los paquetes embebidos) y `LICENSE-SourceSans3.md`. Los assets que necesitan ser ficheros reales (temas y fuentes para Typst, dataset de `cv init`) se materializan en la caché de usuario (`~/.cache/chameleon-cv/assets/<versión>/`), con su SHA-256 comprobado en cada uso. El mismo archivo se construye en local con `npm install && npm run package` (Node ≥ 26; queda en `build/release/`).

**Docker** (todo en un contenedor, con la IA local opcional): la imagen se publica en `ghcr.io/nunzi00/chameleon-cv` (linux/amd64 y linux/arm64, con SBOM y atestación de procedencia) en cada release; el contenedor corre sin red, sin privilegios y con el sistema de ficheros de solo lectura; tus datos quedan en `./my-profile`.

```bash
docker run --rm -v "$PWD/my-profile:/work" ghcr.io/nunzi00/chameleon-cv:1.7.0 --help   # sin clonar nada
mkdir -p my-profile && docker compose pull && docker compose run --rm chameleon-cv init  # o con Compose (docker compose build la construye en local con tu UID/GID)
docker compose run --rm chameleon-cv build && docker compose run --rm chameleon-cv generate-cv -s backend --format pdf --engine typst
docker compose -f compose.yml -f compose.ai.yml run --rm chameleon-cv llm status   # IA local con Ollama (≈ 8 GB la primera vez)
```

Guía completa: [Chameleon CV en Docker](https://nunzi00.github.io/chameleon-cv/guide/docker).

**Desde el repositorio** (desarrollo):

```bash
npm install
npm run build        # compila a dist/
npm link             # opcional: deja el comando `cv` disponible en tu PATH
```

Sin `npm link`, cualquier comando se ejecuta como `npm run cv -- <comando> [opciones]` (vía `ts-node`) o `node dist/index.js <comando>`.

## Inicio rápido

```bash
cv init                                   # 1. data/sources/ con un dataset de ejemplo y un .gitignore; nunca sobrescribe nada
cv build                                  # 2. valida y compila: data/dist/profile.json (todos los errores a la vez, con fichero y línea)
cv generate-cv -s backend                 # 3. output/cv-<nombre>-backend.md
cv generate-cv -s backend --format pdf    #    … o en PDF; --engine typst --theme classic para calidad editorial
cv analyze-offer oferta.txt               # 4. ¿encajo? qué demuestro, qué no y qué me falta
cv generate-cv -f oferta.pdf --compact    # 5. CV afinado a la oferta, preset de una página
```

La regla de selección cabe en una frase: **sin etiquetas, siempre; con etiquetas, solo si alguna coincide** con el vocabulario de la especialidad. `--explain` cuenta cada decisión. Sigue el [inicio rápido](https://nunzi00.github.io/chameleon-cv/guide/quickstart) o el tutorial [Tu perfil desde cero](https://nunzi00.github.io/chameleon-cv/tutorials/profile-from-scratch).

## Comandos

| Comando | Qué hace | Opciones |
|---|---|---|
| `cv init [dir]` | Crea un espacio de trabajo: `data/sources/` con el dataset de ejemplo (permisos 0600) y un `.gitignore` con `data/dist/` y `output/`. Si algún destino existe, lista los conflictos y no escribe nada. | `--template <dir>` (dataset de ejemplo alternativo) |
| `cv validate` | Comprueba las fuentes sin escribir nada. | `-d, --data <dir>` (por defecto `data/sources`) |
| `cv export` | Exporta el perfil canónico (el JSON de `data/dist/profile.json`) desde las fuentes, sin necesitar `cv build`: por la salida estándar o a un fichero. | `-d, --data <dir>` · `-o, --output <file>` |
| `cv import <file>` | Regenera las fuentes Markdown/CSV a partir de un perfil canónico (la inversa de `cv build`), comprobando antes que `cv build` las leería igual; solo en un directorio vacío o con `--replace` (copia `.bak`). | `-d, --data <dir>` · `--replace` · `--dry-run` |
| `cv build` (alias `build-profile`) | Compila las fuentes y escribe el artefacto canónico: la puerta de calidad del perfil. Silencioso en éxito. | `-d, --data <dir>` · `-o, --out <file>` (por defecto `data/dist/profile.json`) · `--check` (no escribe; falla si las fuentes tienen problemas o el artefacto falta o no está al día) · `-v, --verbose` |
| `cv generate-cv` | Genera el CV en Markdown o PDF (pdfkit o Typst) a partir del artefacto. | `--build` (recompila antes) · `-s, --specialty <id>` · `-f, --from-job-offer <file>` (texto o PDF; `-` = stdin, solo texto) · `--format <md\|pdf>` · `--engine <pdfkit\|typst>` · `--typst-path <file>` · `--typst-any-version` · `-n, --top-n <n>` · `--max-skills <n>` · `--max-projects <n>` · `--max-certifications <n>` · `--compact` · `-p, --profile <file>` · `-o, --output <file>` · `-t, --template <file>` · `-l, --locale <locale>` · `--explain` · `--stdout` · `-d, --data <dir>` (solo para el aviso de artefacto obsoleto) · `--theme <nombre>` (tema de Typst: `themes/<nombre>/`, por defecto `default`) |
| `cv analyze-offer <offer>` | Analiza una oferta contra el perfil sin generar nada: adecuación, evidencias y carencias. | `--build` (recompila antes) · `-s, --specialty <id>` · `-p, --profile <file>` · `--explain` (auditoría por ítem) · `--json` (para scripts) · `<offer>` puede ser `-` (stdin) |
| `cv typst install` | Descarga el release oficial de Typst 0.15.1 para tu plataforma, verifica su SHA-256 contra `src/typst/releases.json` y lo instala en la caché de usuario. Única operación de red de `cv`. | `--force` (reinstala) |
| `cv typst status` | Qué binario de Typst se usaría (`--typst-path`, `CHAMELEON_TYPST`, caché, `PATH`), su versión y si es utilizable (código 0). | — |
| `cv improve` | Co-piloto: propone reescrituras con más impacto para los logros seleccionados y las verifica (canon C2); escribe un fichero de revisión, nunca tus fuentes. | `-s` · `-f` · `-n/--max-*/--compact` · `--only <ids>` · `--proposals <1-3>` · `--max-length <n>` · `--max-items <n>` · `--redact-companies` · `-l` · `-o` · `--no-cache` · `--show-prompt` · `--show-payload` · `--dry-run` · `-p` · `-d` · `--provider <openai\|anthropic>` · `--model <name>` · `--yes` · `--build` |
| `cv improve apply <revisión>` | Aplica a tus fuentes las propuestas marcadas `[x]` en una revisión de `improve` o `summarize`: solo lo marcado, cambio mínimo, copia `<fichero>.bak` previa y huella comprobada (si el original cambió, no escribe nada). La única orden que escribe en `data/sources/`. | `-d` · `--dry-run` · `--delete-review` |
| `cv summarize` | Co-piloto: propone el resumen profesional a partir del perfil filtrado (especialidad, oferta, límites) y lo verifica (canon C2); fichero de revisión, nunca tus fuentes. | `-s` · `-f` · `-n/--max-*/--compact` · `--paragraphs <1-3>` · `--proposals <1-3>` · `--max-length <n>` · `--redact-companies` · `-l` · `-o` · `--no-cache` · `--show-prompt` · `--show-payload` · `--dry-run` · `-p` · `-d` · `--provider <openai\|anthropic>` · `--model <name>` · `--yes` · `--build` |
| `cv suggest tags [texto]` | Co-piloto: propone, solo del diccionario cerrado (las tags de tus especialidades), las etiquetas de un texto («-» = stdin) o de los logros del perfil, con la evidencia de cada una calculada por código; imprime por stdout la línea lista para pegar (`#tag1 #tag2`), nunca toca tus fuentes. | `-s <esp>` (acota el diccionario) · `--only <ids>` · `--untagged` · `--max-tags <1-10>` · `--max-items <n>` · `--redact-companies` · `-l` · `--explain` · `--no-cache` · `--show-prompt` · `--show-payload` · `--dry-run` · `-p` · `-d` · `--provider` · `--model` · `--yes` · `--build` |
| `cv llm status` | Proveedor y modelo de IA locales que se usarían (`CHAMELEON_LLM_*`), si responden, de dónde saldría cada clave remota (nunca su valor) y la lista blanca de hosts. Sin `--provider` nunca envía datos; con `--provider openai|anthropic` comprueba también ese proveedor remoto. | `--provider <openai\|anthropic>` (accede a la red) · `--model <name>` |
| `cv llm up` / `cv llm down` | Arranca el Ollama local (binario `ollama` o contenedor Docker con imagen fijada) con el modelo configurado, descargándolo si falta, y lo para; solo toca lo que arrancó cv (T-8.8) |
| `cv llm key set|remove|list <proveedor>` | Claves de los proveedores remotos en tu fichero de claves (`0600`): `set` la pide sin eco o la lee de la entrada estándar, nunca como argumento; `list` solo dice de dónde sale cada una. | — |
| `cv llm cache clear` | Vacía la caché local de respuestas del co-piloto. | — |
| `cv theme list` | Temas de Typst disponibles: nombre, origen (distribuido o `themes/` del proyecto), descripción, validez y cuál es el tema por defecto (`cv.toml` o `default`). | — |
| `cv theme path <nombre>` | Ruta absoluta del directorio del tema (para copiarlo o editarlo); si existe pero no es utilizable, la imprime con un aviso. | — |
| `cv theme create <nombre>` | Crea `themes/<nombre>/` en tu proyecto a partir de un tema existente (`theme.toml` con el nuevo nombre y `template.typ`, más `fonts/` si lo tiene); nunca sobrescribe. | `--from <tema>` (por defecto `default`) |

Códigos de salida: `0` correcto · `1` datos inválidos (fuentes, artefacto o especialidad desconocida) · `2` uso incorrecto o fallo del entorno (permisos, disco, plantilla ilegible). Referencia completa, generada desde la propia CLI: [Referencia de comandos](https://nunzi00.github.io/chameleon-cv/reference/).

## Documentación

| | |
|---|---|
| [Formato de las fuentes](https://nunzi00.github.io/chameleon-cv/guide/sources) | `profile.md`, especialidades, experiencias con logros etiquetados, `skills.csv`, `certifications.csv`; reglas y errores. |
| [Conceptos](https://nunzi00.github.io/chameleon-cv/guide/concepts) | Fuentes, artefacto y CV; especialidades, etiquetas y la regla de selección; `#pin`; idioma. |
| [Adaptar el CV a una oferta](https://nunzi00.github.io/chameleon-cv/guide/offers) | El perfil como diccionario, puntuación transparente por secciones, recorte «N mejores», `analyze-offer`, ofertas en PDF. |
| [Typst y temas](https://nunzi00.github.io/chameleon-cv/guide/typst-themes) | Instalación verificada, proceso contenido, temas `default` y `classic`, `cv theme`, `cv.toml`, plantillas propias. |
| [Co-piloto de IA](https://nunzi00.github.io/chameleon-cv/guide/copilot) | Modelo local, `improve`, `summarize`, `suggest tags`, `improve apply`, proveedores remotos con consentimiento. |
| [Seguridad y privacidad](https://nunzi00.github.io/chameleon-cv/guide/security) | Qué sale y qué no, permisos, entrada contenida, cadena de suministro. |
| [Tutoriales](https://nunzi00.github.io/chameleon-cv/tutorials/) | Tu perfil desde cero · Un CV para tres ofertas · Tu propio tema · El co-piloto con Ollama. Se ejecutan en la integración continua. |
| [Desarrolladores](https://nunzi00.github.io/chameleon-cv/developers/architecture) | Arquitectura y cánones C1–C15, [contribuir](CONTRIBUTING.md), pruebas, extender, empaquetado y release, [notas de diseño](docs/). |

## Seguridad y privacidad

- Todo se procesa en local; la herramienta no abre conexiones de red ni envía telemetría. La única operación de red del producto es `cv typst install`, verificada por SHA-256; los proveedores remotos del co-piloto exigen `--provider` explícito, lista blanca de hosts y confirmación del coste.
- `data/dist/profile.json` y los CV de `output/` contienen datos personales: se escriben con permisos `0600` y ambos directorios están en `.gitignore`. Si versionas tu espacio de trabajo, recuerda que `data/sources/` contiene tus datos: mantenlo en un repositorio privado o exclúyelo también.
- `cv improve apply` es la única orden que escribe en `data/sources/`: solo con tu marca `[x]`, tras crear `<fichero>.bak` (0600) y comprobar por huella que el original no cambió.
- Solo se leen ficheros `.md`/`.csv` dentro del dataset; toda entrada pasa por un esquema estricto; las ofertas en PDF se procesan en un *worker* aislado con límites; Typst corre contenido y sin red; el artefacto se **re-valida** cada vez que se lee.

Vulnerabilidades: avisos de seguridad privados del repositorio (*Security → Report a vulnerability*), nunca un *issue* público.

## Desarrollo

```bash
npm run typecheck    # TypeScript estricto (src, tests y scripts)
npm test             # suite (Vitest)
npm run coverage     # cobertura: umbral 100 % en toda la lógica de src/
npm run dev          # ts-node con recarga
npm run build && npm run test:acceptance:deterministic   # aceptación: el binario compilado sobre el banco de pruebas, coincidencia perfecta con lo esperado
npm run test:acceptance:ai                                # aceptación de IA con un modelo local (Ollama por defecto): valida el proceso, no el texto
npm run docs:check                                        # portal: referencia generada desde la CLI, sincronización, build sin enlaces muertos y tutoriales ejecutados
npm run package                                           # ejecutable autónomo, prueba de humo y tar.gz reproducible con .sha256 y THIRD-PARTY-NOTICES.md (build/release/)
npm run docker:build && npm run docker:smoke              # imagen Docker (chameleon-cv:local) y su prueba de humo: volumen, usuario sin privilegios, Typst, endurecida, red compartida
npm run release:notes -- 1.6.1                            # notas de la release de esa versión, extraídas de CHANGELOG.md (las usa el flujo de release)
```

Cómo contribuir: [`CONTRIBUTING.md`](CONTRIBUTING.md). Pruebas de aceptación: [`docs/acceptance-testing.md`](docs/acceptance-testing.md). Integración continua (`.github/workflows/ci.yml`), release por tag (`release.yml`: empaqueta linux-x64, acepta el binario, publica `tar.gz`, `.sha256`, `SHA256SUMS.txt`, atestación y las notas de `CHANGELOG.md`) y portal (`pages.yml`): [`docs/packaging-and-release.md`](docs/packaging-and-release.md) y [`docs/docs-portal.md`](docs/docs-portal.md). Plan de trabajo: [`ROADMAP.md`](ROADMAP.md).

## Licencia

Chameleon CV es software libre bajo la [licencia MIT](LICENSE). Las fuentes Source Sans 3 de `templates/fonts/` se distribuyen bajo la SIL Open Font License 1.1 ([`templates/fonts/LICENSE-SourceSans3.md`](templates/fonts/LICENSE-SourceSans3.md)). El ejecutable autónomo incorpora Node.js y paquetes npm de terceros: sus licencias y avisos van en el `THIRD-PARTY-NOTICES.md` de cada archivo de release. Typst se descarga aparte, solo a petición, desde su release oficial (Apache-2.0). Historial de versiones: [`CHANGELOG.md`](CHANGELOG.md).
