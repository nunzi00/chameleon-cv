# Integración de Typst como motor PDF de calidad editorial

| | |
|---|---|
| **Tarea** | T-3.1 · [RESEARCH] Investigación y prueba de concepto de la integración con Typst (Hito 3, Representación Profesional) |
| **Estado** | **PROPUESTA** v1 (2026-08-28), pendiente de aprobación por el Director de Ingeniería. PoC reproducible en `docs/poc/typst/`. |
| **Autor** | Claude (Director Técnico) |
| **Decide** | Cómo se obtiene el compilador, cómo se le habla y cómo se le contiene, si su lenguaje cubre nuestro `CvView`, qué cuesta en tiempo y memoria, y con qué arquitectura (o si no) se integra. |
| **Base** | `docs/pdf-integration.md` (§3.3 registró Typst como B-4), `docs/consolidacion.md`, renderer `pdfkit` de T-2.6 (`src/renderers/pdf/`). |

## 0. Resumen ejecutivo

**Recomendación: integrar Typst como motor opcional (`--engine typst`) sobre el binario oficial, ejecutado como proceso hijo contenido; `pdfkit` sigue siendo el motor por defecto.** Todas las afirmaciones de esta nota se han verificado ejecutando Typst **0.15.1** (release oficial del 2026-07-17) en esta máquina con una plantilla real sobre nuestro `CvView`:

- **Calidad y corrección**: PDF 1.7, **determinista byte a byte** (con `--creation-timestamp`), fuente Source Sans 3 embebida (la nuestra, OFL), sin JavaScript, **PDF etiquetado de serie** (accesibilidad, `/StructTreeRoot`), y el texto que extrae nuestro T-2.5 del PDF de Typst **coincide línea por línea con el golden de `pdfkit`** (`tests/fixtures/golden/cv-backend.pdf.txt`): la prueba de aceptación de T-2.6 se reutiliza tal cual.
- **Rendimiento**: 8 ms de arranque; **~30 ms** por CV de una página y ~64 ms para uno de dos páginas (mediana de 5); **29 MB** de RSS máximo. `pdfkit` en proceso: 124–142 ms y un proceso Node de ~250 MB. Typst es más rápido y más ligero que lo que ya tenemos.
- **Contención**: `--root` impide salir del directorio de plantillas (verificado: «would escape the project root»); stdin → stdout sin ficheros intermedios; los datos personales viajan por stdin como literal de cadena (no por argumentos: nunca en `ps`); entorno vacío verificado. **Hallazgo relevante**: Typst **descarga paquetes `@preview`** de `packages.typst.org` si una plantilla los importa (verificado con caché vacía); se neutraliza con un interruptor de red verificado (`HTTPS_PROXY`/`HTTP_PROXY` apuntando a un puerto cerrado → «Connection refused» inmediato) además de no importar paquetes en nuestra plantilla.
- **Binario**: no existe paquete npm oficial (`@typst/typst` no existe; `typst` en npm es un envoltorio abandonado de 2023). Empaquetar el compilador (56 MB por plataforma, 9 plataformas) es inasumible en el repositorio. La vía «`npm install` y listo» sería un *binding* nativo de terceros de 52 MB por plataforma que corre **dentro** de nuestro proceso (sin aislamiento de SO). Propuesta: `pdfkit` por defecto sin dependencias nuevas; para Typst, **descarga explícita y verificada** del release oficial (`cv typst install`, SHA-256 fijados en el repositorio, nunca en `npm install`) o uso del binario del sistema.

## 1. Objetivo y alcance

Responder a las cinco preguntas del Director de Ingeniería con evidencia y proponer la arquitectura de T-3.2+. Fuera de alcance: el diseño tipográfico final (T-3.3), HTML/SVG, y la migración del motor por defecto.

## 2. Gestión del binario (pregunta 1)

### 2.1 Hechos (2026-08-28)

| Vía | Qué es | Tamaño | Estado | Aislamiento |
|---|---|---|---|---|
| **Release oficial** `typst/typst` | Binario estático (musl en Linux, verificado `statically linked`) para 9 plataformas: Linux x86_64/aarch64/armv7/riscv64, macOS x64/arm64, Windows x64/arm64 | 14–21 MB comprimido; **55,7 MB** en disco (x86_64 Linux) | **0.15.1**, 2026-07-17; releases frecuentes; **sin ficheros de checksum publicados** junto a los assets | Proceso separado: `--root`, entorno, tiempo y memoria bajo nuestro control |
| Gestor del sistema | `pacman -S typst`, `brew install typst`, `winget`, `cargo install typst-cli` | — | Versión la que toque en cada sistema | Igual que el release |
| `@myriaddreamin/typst-ts-node-compiler` | *Binding* napi de terceros (Myriad-Dreamin, Apache-2.0); meta-paquete + 11 paquetes por plataforma en `optionalDependencies` | **52 MB** desempaquetado (linux-x64-gnu) | 0.7.0, 2026-06-29; su rama principal apunta a typst 0.15 | **En proceso**: sin `--root` del SO, sin límite de memoria propio, un fallo del compilador tumba `cv` |
| `@myriaddreamin/typst-ts-web-compiler` | Compilador en WebAssembly | 28 MB | 0.7.0 | En proceso (WASM); más lento |
| `typst` (npm) | Envoltorio de typst.community | 27 KB | **0.10.0-8, dic-2023: abandonado** | — |
| `@typst/typst` | — | — | **No existe en el registro** | — |
| Empaquetar en el repo | Copiar binarios a `vendor/` | 9 × 56 MB | — | — |

### 2.2 Análisis

- «`npm install` es suficiente» solo lo cumple el *binding* de terceros. A cambio: 52 MB por plataforma, un compilador Rust ejecutándose dentro del proceso Node (contra nuestra doctrina de aislar lo que procesa datos y código ajeno, `pdf-integration.md` §2.2), dependencia de un mantenedor externo para seguir a Typst (pre-1.0, con cambios de API entre versiones) y sin posibilidad de aplicar `--root`, tiempo o memoria desde el SO.
- Empaquetar el binario oficial en el repositorio multiplica su tamaño por ~10 y obliga a mantener 9 artefactos; descargarlo en `npm install` (patrón esbuild/puppeteer) ejecuta red en la instalación, sin control del usuario: incompatible con «todo local, sin sorpresas».
- **Compilación cruzada**: no compilamos nada. Los binarios oficiales ya existen para las 9 plataformas; nuestra única responsabilidad es elegir el asset correcto (`process.platform` + `process.arch` → target) y verificar su integridad. Typst no publica checksums, de modo que **los fijamos nosotros** por versión y plataforma en el repositorio (`src/typst/releases.json`), calculados una vez y revisados en cada actualización de versión (commit atómico «chore(typst): pin 0.x.y»).

### 2.3 Propuesta

1. **`pdfkit` sigue siendo el motor por defecto** (cero dependencias nuevas, ya verificado). Typst es `--engine typst`.
2. **Localización del binario, en este orden**: `--typst-path <fichero>` → variable `CHAMELEON_TYPST` → binario instalado por nosotros en `~/.cache/chameleon-cv/typst/<versión>/typst` (o `%LOCALAPPDATA%`) → `typst` en `PATH`. Se comprueba `typst --version` (8 ms): se exige la **versión fijada** (0.15.1) salvo `--typst-any-version`, porque pre-1.0 el lenguaje cambia y nuestra plantilla está probada con una versión concreta.
3. **`cv typst install`** (nuevo comando, explícito): descarga el asset oficial de GitHub para la plataforma actual, verifica el SHA-256 fijado, lo desempaqueta en el directorio de caché con permisos 0700/0755 y comprueba `--version`. Es la **única** operación de red de toda la CLI, la lanza el usuario a propósito, y lo dice en pantalla. `cv typst status` muestra qué binario se usaría y por qué. Sin binario, `--engine typst` falla con código 2 y la instrucción exacta (`cv typst install`, o el gestor del sistema).

## 3. Interfaz y seguridad (pregunta 2)

### 3.1 Interfaz verificada: stdin → stdout, sin ficheros intermedios

```
typst compile - - --root <dir-plantilla> --font-path templates/fonts --ignore-system-fonts \
      --creation-timestamp <epoch> --diagnostic-format short
```

- `INPUT = -` lee el documento principal de stdin; `OUTPUT = -` escribe el PDF en stdout (ambos documentados en `typst compile --help` y verificados).
- El documento principal es **generado por nosotros** y mide dos líneas: `#import "/cv.typ": cv` y `#cv(json(bytes("<JSON escapado>")))`. El `CvView` viaja **como literal de cadena Typst** (solo escapes `\\`, `\"` y `\u{..}` para controles): los datos nunca son código, nunca están en `argv` (visible en `ps` para cualquier usuario de la máquina) y nunca tocan el disco. `--input key=value` existe pero pasa por `argv`: descartado para datos personales.
- Diagnósticos por stderr (`--diagnostic-format short` → `fichero:línea:col: mensaje`) con código de salida 1: se traducen a nuestro código 1 (plantilla o datos) o 2 (binario ausente, tiempo agotado, fallo de proceso).

### 3.2 Contención verificada (sondas ejecutadas con 0.15.1)

| Sonda | Resultado |
|---|---|
| `#read("/etc/passwd")` con `--root <dir>` | Error: la ruta absoluta se resuelve **dentro** del root (`<root>/etc/passwd`, «file not found») |
| `#read("../../etc/passwd")` | Error: «path would escape the project root» |
| `#read("/dentro.txt")` (dentro del root) | Lee (esperado): el root debe contener **solo** la plantilla y sus recursos |
| `#import "@preview/tablex:0.0.9"` con caché vacía y `env -i` | **Descarga** de `https://packages.typst.org/…` y compila: Typst tiene acceso a red **para paquetes** (nunca a URLs arbitrarias ni para enviar datos) |
| Mismo import con `HTTPS_PROXY=HTTP_PROXY=http://127.0.0.1:9` | Falla en el acto: «failed to download package … Connection refused» → **interruptor de red efectivo** |
| Compilación con `env -i` (sin `HOME`, `PATH`…) | Compila: el proceso hijo puede correr con entorno vacío |
| Ejecución de comandos/shell desde Typst | No existe (ninguna función del lenguaje ejecuta procesos; 0 menciones en la ayuda) |
| `--ignore-system-fonts --font-path templates/fonts` | Lista solo Source Sans 3 y las cuatro familias embebidas en el binario: salida reproducible en cualquier máquina |

### 3.3 Política de contención propuesta (canon para T-3.2)

1. `execFile` (sin shell) con `argv` fijo; `cwd` y `--root` = directorio que contiene **únicamente** la plantilla (`templates/typst/`); con `--template propio.typ`, root = su directorio (la plantilla del usuario es código de confianza *del usuario*, como ya lo es su `.hbs`).
2. **Entorno vacío** más el interruptor de red: `HTTP_PROXY`/`HTTPS_PROXY`/`ALL_PROXY = http://127.0.0.1:9`, `NO_PROXY` vacío, y `--package-path`/`--package-cache-path` apuntando a un directorio vacío: ningún paquete se resuelve ni se descarga. Nuestra plantilla no importa paquetes; una plantilla de usuario que lo intente falla en milisegundos con un mensaje claro.
3. `--ignore-system-fonts --font-path templates/fonts` (reproducible); `--creation-timestamp` = `meta.updatedAt` o la constante de T-2.6 (determinismo verificado).
4. `timeout` 20 s con `SIGKILL`, `maxBuffer` 32 MiB para stdout/stderr, stdin cerrado tras escribir; salida escrita por nosotros con 0600 (mismo `writeBinaryFile` de T-2.6).
5. Verificación del resultado como en T-2.6: cabecera `%PDF`, sin `/JavaScript`, `/Launch`, `/OpenAction`, `/AA`, `/EmbeddedFile`; `/FontFile2` presente.
6. Opcional, gratis: `--pdf-standard a-2b` (archivo) o `ua-1` (accesibilidad); el PDF ya sale etiquetado.

## 4. Lenguaje de plantillas (pregunta 3)

### 4.1 PoC: `docs/poc/typst/cv.typ` sobre `CvView`

La plantilla (110 líneas) recibe un diccionario JSON derivado de `CvView` y de `src/renderers/pdf/inline.ts` (el Markdown en línea llega ya descompuesto en *runs* con negrita/cursiva/código/enlace, y los párrafos y listas como *blocks*), es decir, **la misma vista que alimenta a Markdown y a pdfkit**. Cubre la totalidad del CV: cabecera, contacto con enlaces, resumen con párrafos y listas, experiencias y proyectos (título, periodo/ubicación, resumen, logros con impacto en cursiva, tecnologías), skills por categoría, logros transversales, formación, certificaciones con enlace e idiomas; secciones opcionales, campos ausentes (`.at("k", default: none)`), etiquetas por idioma (`labels`, ya resueltas por la vista) y `lang` para silabación.

Capacidades del lenguaje usadas y suficientes: funciones con parámetros, diccionarios y arrays, `if`/`for`, unión de contenido (`join`), `strong`/`emph`/`raw`/`link`, `list.item` (los contiguos forman una lista), reglas `set`/`show` (incluido `set strong(delta: 200)` para que la negrita use nuestra Semibold), `block` con `stroke` inferior como regla de sección, `v`, `linebreak`. Es estrictamente más programable que Handlebars (que exigía un modelo de vista sin lógica) y permite lo que pdfkit hace a mano: maquetación, paginación automática (verificada: 70 logros → 2 páginas), silabación por idioma, kerning y ligaduras, PDF etiquetado.

### 4.2 Resultado

`docs/poc/typst/cv-backend.json` + `cv.typ` → PDF de 40 KB y una página cuyo texto extraído (T-2.5) es **idéntico** al golden de pdfkit. Reproducción: `docs/poc/typst/README.md`.

Detalles a resolver en T-3.2/T-3.3 (no bloqueantes): un tabulador dentro del texto se pierde en la extracción (normalizar `\t` → espacio en la vista), evitar que un ítem se parta entre páginas (`block(breakable: false)`), y decidir tipografía final (columnas, iconos de contacto, sangrías). Los plurales y etiquetas ya vienen resueltos en `labels`; no hay lógica de negocio en la plantilla.

## 5. Rendimiento y recursos (pregunta 4)

Medidas en esta máquina (Linux x86_64, Typst 0.15.1, 5 repeticiones, proceso hijo con entorno vacío):

| Operación | Mín. | Mediana | Máx. |
|---|---|---|---|
| `typst --version` (coste de arranque del proceso) | 7 ms | 8 ms | 10 ms |
| `typst compile` CV backend (1 página, stdin→stdout) | 28 ms | **32 ms** | 35 ms |
| `typst compile` perfil completo en inglés (1 página) | 28 ms | 30 ms | 34 ms |
| `typst compile` CV largo (70 logros, 2 páginas) | 60 ms | 64 ms | 67 ms |
| `pdfkit` `renderPdfCv` backend (en proceso, T-2.6) | 122 ms | 124 ms | 180 ms |
| `pdfkit` `renderPdfCv` largo | 137 ms | 142 ms | 158 ms |

Memoria: **29 MB** de RSS máximo del proceso `typst` (CPU usuario 0,02 s); el proceso Node con pdfkit pasa de 175 a 249 MB al renderizar. Tamaños: PDF backend 40 KB (pdfkit: 28 KB; la diferencia es el etiquetado y una fuente con más glifos), largo 74 KB. Conclusión: el coste marginal de Typst es despreciable; el coste real es el binario en disco (56 MB) y su descarga inicial (17 MB).

## 6. Recomendación y arquitectura de integración (pregunta 5)

**Adelante, como motor opcional.** Ningún riesgo viola nuestros principios si se aplica la política de §3.3; los dos riesgos reales (acceso a red para paquetes y obtención del binario) quedan neutralizados por diseño y bajo control explícito del usuario.

### 6.1 Módulos

```
src/renderers/structured/view.ts   CvView → StructuredView (runs/blocks); compartida por pdfkit y Typst
src/renderers/typst/source.ts      literal de cadena Typst + documento principal (2 líneas); puro, 100 % testeable
src/renderers/typst/engine.ts      localización del binario, comprobación de versión, spawn contenido (execFile, env, proxy, timeout)
src/renderers/typst/renderer.ts    renderTypstCv(profile, options) → Promise<Buffer>; misma firma que renderPdfCv
src/typst/releases.json            versión fijada + SHA-256 por plataforma; src/typst/install.ts (descarga verificada)
src/cli/commands/typst.ts          cv typst install | status
templates/typst/cv.typ             plantilla base (evolución del PoC); templates/fonts se reutiliza
```

`pdfkit` (`src/renderers/pdf/`) no cambia salvo consumir `StructuredView` en lugar de calcular los runs sobre la marcha (refactor sin cambio de salida: el golden lo garantiza).

### 6.2 CLI

- `cv generate-cv --format pdf --engine pdfkit|typst` (por defecto `pdfkit`); `--template x.typ` solo con `--engine typst`; `--stdout` sigue sin admitir PDF. Sin binario: código 2 y la instrucción de instalación.
- `cv typst install [--version 0.15.1]`, `cv typst status`. Ninguna otra orden toca la red.

### 6.3 Tests y criterios de aceptación

1. **Round-trip**: el CV backend vía Typst debe extraer **exactamente** el golden de pdfkit (ya se cumple en el PoC). Determinismo byte a byte con `--creation-timestamp`.
2. **Contención**: tests con el binario real de que una plantilla con `#read("../x")` falla, que `#import "@preview/…"` falla sin tocar la red (proxy a puerto cerrado) y que el tiempo agotado mata el proceso; ejecutados en Vitest **solo si el binario está disponible** (`cv typst status`), fuera del umbral de cobertura como cableado de I/O (igual que `worker.mts`), con la lógica (localización, argumentos, entorno, traducción de errores) al 100 % mediante un *runner* inyectado.
3. **Presupuesto**: < 200 ms por CV de una página en esta máquina; PDF sin `/JavaScript` ni acciones; fuente embebida; `/StructTreeRoot` presente.
4. `cv typst install`: verificación SHA-256 obligatoria (un hash incorrecto aborta y borra el fichero), sin ejecución del binario hasta verificar; test con servidor HTTP local simulado.

### 6.4 Plan

| Tarea | Contenido |
|---|---|
| T-3.2 | `StructuredView` compartida + `source.ts` + `engine.ts` + `renderTypstCv` + `--engine` + tests (100 %) + round-trip |
| T-3.3 | `cv typst install/status` con `releases.json` fijado y verificación SHA-256 |
| T-3.4 | Diseño tipográfico de `templates/typst/cv.typ` (calidad editorial: jerarquía, columnas de contacto, `breakable: false`, `pdf-standard` opcional) y documentación de usuario |

### 6.5 Riesgos y mitigaciones

- **Typst pre-1.0 (0.15.1)**: el lenguaje cambia entre versiones → versión fijada y comprobada; actualizarla es un commit deliberado con la plantilla re-verificada por el round-trip.
- **Red**: solo `cv typst install`, explícita; en compilación, interruptor de proxy + caché de paquetes vacía.
- **Confianza en el binario**: descarga del release oficial de `typst/typst` con hash fijado por nosotros (Typst no publica checksums); alternativa siempre disponible: binario del sistema o `--typst-path`.
- **Disco**: 56 MB en caché de usuario, fuera del repositorio; `cv typst status` informa de dónde.
- **Plantillas de usuario**: código Typst con acceso de lectura a su propio directorio y sin red; equivalente al riesgo ya aceptado con `.hbs`.

## 7. Puntos de decisión

1. **Motor opcional**: Typst como `--engine typst`; `pdfkit` sigue por defecto. Recomendación: aprobar.
2. **Obtención del binario**: sin descarga en `npm install`; `cv typst install` explícito con SHA-256 fijados por nosotros, o binario del sistema/`--typst-path`. Se descarta el *binding* en proceso de terceros. Recomendación: aprobar.
3. **Política de contención** (§3.3: root mínimo, entorno vacío, interruptor de red por proxy, caché de paquetes vacía, fuentes propias, tiempo y buffer limitados, verificación del PDF): canon no negociable para T-3.2. Recomendación: aprobar.
4. **Datos por stdin como literal, nunca por `--input`** ni ficheros temporales. Recomendación: aprobar.
5. **Plantilla**: `templates/typst/cv.typ` a partir del PoC, `--template *.typ` permitido con root = su directorio. Recomendación: aprobar.
6. **Aceptación**: mismo round-trip golden que pdfkit + determinismo + presupuesto de 200 ms + tests de contención con binario real cuando esté disponible. Recomendación: aprobar.
