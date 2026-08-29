# Pruebas de aceptación: validación integral en dos niveles

| | |
|---|---|
| **Tarea** | T-5.5.4 · [DOCS] Documentación del proceso de validación (Hito 5.5) |
| **Estado** | Estándar de calidad vigente desde el 2026-08-29. |
| **Autor** | Claude (Director Técnico) |
| **Base** | `ROADMAP.md` (Hito 5.5, estrategia aprobada y canonizada por el Director de Ingeniería), `tests/acceptance/` (`bench/`, `cases.ts`, `runner.ts`, `compare.ts`, `ai-runner.ts`), cánones C9, C12 y C13 de `docs/llm-integration.md` §3. |

## 1. Propósito y alcance

Cada característica de `cv` tiene sus pruebas unitarias y de integración (suite de Vitest con umbral del 100 % de cobertura en la lógica de negocio). Lo que no existía era una **prueba de aceptación integral**: la que ejecuta el producto tal como lo ejecuta una persona —el binario compilado, un proyecto real, ficheros de verdad, códigos de salida de verdad— y responde a la pregunta «¿sigue haciendo exactamente lo que hacía?». El Hito 5.5 la añade en **dos niveles**, porque el producto tiene dos naturalezas:

| | Arnés determinista | Arnés de IA |
|---|---|---|
| **Orden** | `npm run test:acceptance:deterministic` | `npm run test:acceptance:ai` |
| **Qué prueba** | Todo lo que no depende de un modelo: `init`, `validate`, `build`, `generate-cv` (Markdown, pdfkit, Typst con temas y `cv.toml`, ofertas en texto y PDF, límites, `--explain`), `analyze-offer`, la vista previa seudonimizada del co-piloto (`--dry-run --show-payload`), `improve apply`, `theme`, `llm status`, `typst status` y los errores de uso. | Los tres comandos que hablan con un modelo: `improve`, `summarize`, `suggest tags`. |
| **Criterio** | **Coincidencia perfecta** con artefactos esperados: código de salida, stdout, stderr y cada fichero producido, byte a byte. | **Proceso, no resultado** (canon C12): el texto del modelo no se compara; se valida que el proceso cumplió todas sus reglas e invariantes. |
| **Red** | Ninguna (los pasos de estado apuntan a un puerto cerrado). | Solo un proveedor **local** (loopback); nunca remotos ni claves. |
| **Duración** | ≈ 30 s (con Typst). | ≈ 3–4 min con un modelo de 7B en CPU. |
| **Cuándo** | Antes de confirmar cambios en renderizadores, parsers o CLI; en cada release (trabajo `verify` del Hito 6, con `--require-typst`). | Antes de una release y al cambiar prompts, verificador o proveedores; ejecución manual o nocturna, nunca en un CI sin modelo local. |

Ambos parten del mismo **banco de pruebas** (§2) y nunca escriben en él: cada ejecución trabaja sobre una copia temporal que se elimina al terminar (canon C9). Ambos se prueban a sí mismos (canon C13, §3.4).

Lo que estas pruebas **no** sustituyen: la suite unitaria sigue siendo la que localiza un fallo en una función concreta y la que exige el 100 % de cobertura; los arneses dicen si el producto entero, de principio a fin, se comporta como se esperaba.

## 2. El banco de pruebas (`tests/acceptance/bench/`)

- **`workspace/`**: el proyecto de una usuaria **sintética** (Lucía Ferrer Montalbán, direcciones `example.org`; ninguna PII real). `data/sources/` con once años de trayectoria: 4 especialidades con resumen y tags (backend, platform, engineering-manager, data), 5 experiencias y 3 proyectos con 29 logros etiquetados —`impact`, ids explícitos, Markdown en línea, un `#pin`—, 16 skills con alias, 4 certificaciones, 2 formaciones y 3 idiomas; `offers/` con cuatro ofertas (tres en castellano, una en inglés, con carencias deliberadas) y dos de ellas también en PDF; `themes/bench/` (un tema propio derivado de `classic`); `cv.toml` (tema por defecto y anulaciones); `reviews/` (revisiones de `improve` y `summarize` marcadas `[x]` para `apply`). El perfil completo pagina (3 páginas con pdfkit, 2 con Typst); los CV por especialidad ocupan 1–2.
- **Ficheros derivados**: los PDF de las ofertas y las revisiones marcadas **se generan** desde las fuentes del banco con `npm run acceptance:bench` (`bench/generate.ts`: pdfkit con fecha fija y fuentes embebidas; revisiones con `Fuente:` y huella calculadas). Son reproducibles byte a byte y se versionan; el arnés determinista comprueba en cada ejecución que los versionados son exactamente los que producen los generadores.
- **`expected/<escenario>/`**: los artefactos esperados. Por paso, `NN-id.exit.txt`, `NN-id.stdout.txt` y `NN-id.stderr.txt`; en `files/`, los ficheros producidos con su ruta relativa (un `.gitignore` producido se guarda como `gitignore.expected` para que no oculte a sus vecinos). 260 ficheros, 1,4 MB, todos bajo control de versiones.
- **`cases.ts`**: el catálogo declarativo —seis escenarios independientes, 72 pasos— con argumentos, entrada estándar, entorno, código de salida esperado y ficheros producidos. Es la fuente de verdad de *qué* se prueba; el ejecutor solo lo recorre.

## 3. Arnés determinista

### 3.1 Requisitos y ejecución

```bash
npm run build                                  # el arnés exige dist/ al día con src/ (si no, se niega a ejecutar)
npm run test:acceptance:deterministic          # compara: código 0 si todo coincide, 1 si algo difiere, 2 si no se pudo ejecutar
npm run test:acceptance:deterministic -- core typst     # solo esos escenarios
npm run test:acceptance:deterministic -- --require-typst  # sin binario de Typst, fallo en lugar de omisión (para el release)
npm run test:acceptance:deterministic -- --keep           # conserva la copia temporal de cada escenario (imprime su ruta)
npm run test:acceptance:deterministic -- --binary build/sea/cv   # los mismos escenarios y artefactos esperados contra el ejecutable autónomo (T-6.2)
```

Typst es opcional: si hay binario (la caché de `cv typst install` o `CHAMELEON_TYPST`), el escenario `typst` se ejecuta; si no, se **omite de forma visible** en el resumen (`· typst: OMITIDO — …`) y sus artefactos no se tocan.

### 3.2 Cómo funciona

1. Copia `bench/workspace/` a un directorio temporal (o parte de uno vacío, para `init`).
2. Ejecuta cada paso con el **binario compilado** (`node dist/index.js …`) en un entorno mínimo y determinista: `PATH` vacío, `HOME` y los directorios XDG dentro de la copia (la caché y `keys.json` nunca son los del usuario), `TZ=UTC`, sin heredar nada del entorno; `CHAMELEON_TYPST` solo en el escenario `typst`.
3. Normaliza las rutas volátiles en stdout y stderr: la copia → `<WS>`, el directorio temporal → `<TMP>`, el repositorio → `<REPO>`, el binario de Typst → `<TYPST>` y el directorio de los temas distribuidos → `<BUILTIN_THEMES>` (el del repositorio con `dist/`; la caché materializada con el ejecutable), de modo que los artefactos esperados valen para ambos.
4. Compara con lo esperado: el código de salida (que además debe coincidir con el catálogo), stdout y stderr, y cada fichero declarado. Texto y JSON: byte a byte, y si difieren, un diff por líneas con contexto. PDF: byte a byte (pdfkit con fecha fija y Typst con `--creation-timestamp` son deterministas), y si difieren, páginas, tamaño y el diff del **texto extraído** de ambos. Árboles (`init`): ficheros que faltan, que sobran y contenido de cada uno.
5. Un código de salida distinto del esperado detiene el escenario (el estado ya no es el previsto); el resto de diferencias se acumulan y se informan todas.

### 3.3 Leer un fallo

```
✗ core: 2 de 35 pasos con diferencias (16.5 s)
  05-generate-backend-md · output/cv-backend.md:
      ## Experiencia
    - ### CAMBIO Staff Backend Engineer · Nexo Pagos
    + ### Staff Backend Engineer · Nexo Pagos
  16-generate-backend-pdfkit · output/cv-backend.pdfkit.pdf:
    43949 bytes esperados, 39034 obtenidos; esperado: 3 página(s); obtenido: 2 página(s)
    - Ingeniera de software · plataformas de pago y datos
    + Senior Backend Engineer
```

`-` es lo esperado, `+` lo obtenido. Ante un fallo hay dos preguntas, en este orden: ¿es una regresión (el producto cambió sin querer)? → corrige el producto; ¿es un cambio intencionado de la salida? → regenera (§3.5) y revisa el diff.

### 3.4 El arnés se prueba a sí mismo (canon C13)

Antes de los escenarios, dos comprobaciones de integridad del propio banco, que también son fallos: **`bench-generators`** (regenera en un temporal los PDF de ofertas y las revisiones y los compara con los versionados) y **`expected-versioned`** (`git ls-files --ignored`: ningún artefacto esperado puede estar excluido por un `.gitignore`; nació de descubrir que el `.gitignore` de la raíz había dejado 100 artefactos fuera del control de versiones). Además, `dist/` debe ser más reciente que cualquier fichero de `src/` (se prueba el código actual) y los comparadores tienen sus propias pruebas unitarias (`compare.test.ts`).

### 3.5 Regenerar los artefactos esperados (deliberadamente)

```bash
npm run build && npm run test:acceptance:deterministic -- --update   # (alias: npm run acceptance:update)
git diff --stat tests/acceptance/bench/expected                        # revisar QUÉ cambió y por qué
```

Solo cuando la salida cambia a propósito (nuevo diseño, nuevo mensaje, nueva orden). El diff es la revisión: cada línea que cambia en `expected/` es una decisión sobre el producto. Nunca se regenera en CI. Si se añade una orden o un flujo, se añade su paso a `cases.ts` y se regenera el escenario afectado (`-- --update core`).

## 4. Arnés de IA

### 4.1 Requisitos y ejecución

```bash
ollama serve && ollama pull qwen2.5:7b-instruct       # proveedor por defecto y modelo fijado
npm run build && npm run test:acceptance:ai            # código 0 si pasa, 1 si algo falla, 2 si no se puede ejecutar
# alternativa: cualquier servidor local compatible con OpenAI (llama-server, LM Studio)
CHAMELEON_LLM_PROVIDER=openai-compatible CHAMELEON_LLM_BASE_URL=http://127.0.0.1:8080 npm run test:acceptance:ai
npm run test:acceptance:ai -- --binary build/sea/cv      # contra el ejecutable autónomo (T-6.2)
```

**Precondición programática**: antes de nada comprueba, con la misma lógica de `cv llm status`, que el proveedor local configurado responde y sirve el modelo. Si no, imprime el estado y qué hacer (qué arrancar, qué modelo descargar) y termina con código 2. Al binario solo llegan `CHAMELEON_LLM_PROVIDER`, `CHAMELEON_LLM_BASE_URL` y `CHAMELEON_LLM_MODEL`; **nunca** una clave ni un proveedor remoto.

### 4.2 Qué ejecuta

Sobre una copia temporal del banco, tras `build`: `improve -s backend --top-n 1 --max-items 3`, `summarize -s backend`, `suggest tags --only …` (tres logros) y `suggest tags "texto" -s engineering-manager`, todos con `--no-cache` (cada ejecución es real) y `--show-payload` (la carga útil que sale hacia el modelo se inspecciona).

### 4.3 Qué valida (canon C12: el proceso, no el resultado)

| | Comprobación | Qué garantiza |
|---|---|---|
| (a) | Cada orden termina con código 0 y ningún logro falla (el modelo devolvió JSON válido para todos). | Integridad del proceso de extremo a extremo con un modelo real. |
| (b) | Los ficheros de revisión existen y cumplen el formato: se leen con `parseReview`; cabecera con procedencia (`- fuentes:`), un ítem por logro con `Fuente:` (fichero, línea y huella), y cada propuesta con su línea de verificación coherente con su estado (`✓ aceptada` en las aceptadas, `VIOLATION_*` en las tachadas). | Lo que `cv improve apply` necesita está siempre ahí; el usuario ve el motivo de cada rechazo. |
| (c) | **Sin invención, auditado desde fuera**: cada propuesta aceptada vuelve a superar el verificador semántico **ejecutado por el arnés**, de forma independiente, sobre fragmentos reconstruidos desde las fuentes del banco (política `strict` para `improve`, `synthesis` con los hechos clave de la especialidad para `summarize`); cada rechazada es rechazada también por esa verificación independiente. | El canon C2 no se confía al producto: se comprueba en cada ejecución. |
| (d) | Todas las etiquetas de `suggest tags` pertenecen al diccionario cerrado (las tags de las especialidades del banco, o de la especialidad pedida con `-s`), con su grafía exacta y sin `pin`. | El modelo recomienda; el diccionario del perfil es la autoridad. |
| (e) | Ninguna carga útil contiene PII del banco: nombre completo ni sus partes (van como `[NOMBRE]`), email, teléfono, enlaces. | Canon C4 medido sobre lo que realmente sale. |
| (f) | `data/sources` de la copia es idéntico al del banco al terminar. | Canon C9: la IA nunca escribe en las fuentes. |

**Lo que no valida**, a propósito: el texto de las propuestas, su calidad literaria, cuántas se aceptan. Un modelo distinto, o el mismo modelo en otro día, producirá frases distintas y otra tasa de aceptación; nada de eso es un fallo. Por eso la tasa de aceptación y los tiempos por orden se imprimen como **datos**, útiles para comparar modelos y prompts a lo largo del tiempo.

### 4.4 Resultado de referencia

Ejecución del 2026-08-29 con Qwen2.5-7B-Instruct (Q4_K_M) en `llama-server` (CPU) como proveedor `openai-compatible`: 16/16 comprobaciones en 3 min 34 s; `improve` 3 logros · 6 propuestas · 2 aceptadas (80 s), `summarize` 2/2 aceptadas (66 s), `suggest tags` 7 etiquetas, todas del diccionario (66 s). Sin modelo: código 2 con las instrucciones. Los ayudantes del arnés (detección de PII, lectura de la carga útil, estructura de la revisión, re-verificación) tienen pruebas unitarias (`ai.test.ts`).

## 5. Encaje en el trabajo diario y en el release

- **Al cambiar el producto**: `npm run coverage` (unitarias, 100 %) y `npm run test:acceptance:deterministic`. Si el cambio altera una salida a propósito, regenerar y revisar el diff (§3.5). Si añade una orden o un flujo, ampliar `cases.ts`.
- **Al cambiar prompts, verificador, seudonimización o proveedores**: además, `npm run test:acceptance:ai` con el modelo de referencia.
- **Antes de un release** (Hito 6): el trabajo `verify` ejecuta la suite unitaria y el arnés determinista con `--require-typst` (instalando Typst en el runner); el arnés de IA se ejecuta a mano con un modelo local antes de crear el tag, y su resultado de referencia se anota.
- **Al cambiar la versión de Typst** o de pdfkit cambian los bytes de los PDF esperados: regenerar deliberadamente y revisar que el texto extraído no cambia.

## 6. Cánones que lo sustentan

- **C9 — Inmutabilidad de la fuente de datos**: los arneses trabajan sobre copias y comprueban que las fuentes no cambian.
- **C12 — Validar el proceso, no el resultado**: la confianza en un sistema no determinista se construye verificando reglas, invariantes y restricciones de seguridad, no frases exactas.
- **C13 — La prueba debe probarse a sí misma**: los arneses vigilan su propia integridad (generadores, artefactos versionados, `dist/` al día, pruebas unitarias de los comparadores).

## 7. Referencia rápida

| Orden | Para qué |
|---|---|
| `npm run acceptance:bench` | Regenera los ficheros derivados del banco (PDF de ofertas, revisiones marcadas). |
| `npm run test:acceptance:deterministic` | Arnés determinista (compara). `-- --update` regenera; `-- <escenario…>` acota; `-- --require-typst`; `-- --keep`. |
| `npm run acceptance:update` | Alias de `test:acceptance:deterministic -- --update`. |
| `npm run test:acceptance:ai` | Arnés de IA (requiere un modelo local que responda). `-- --binary <ejecutable>` lo ejecuta contra el binario. |
| `npm run package` | Ejecutable autónomo para esta plataforma (`build/release/…tar.gz`), con prueba de humo (`docs/packaging-and-release.md`). |
