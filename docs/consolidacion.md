# Hito 2.5: consolidación y calidad de vida

| | |
|---|---|
| **Tareas** | T-2.7 · [CLI] `cv build` unificado (ref. B-1) · T-2.8 · [CLI] `cv init` (ref. B-2) · T-2.9 · [CORE] tag reservada `#pin` (ref. B-3) |
| **Estado** | **EN EJECUCIÓN** por orden del Director de Ingeniería del 2026-08-28 («Ejecute»). Las decisiones de diseño de §2–§4 las toma el Director Técnico en ejecución y quedan registradas aquí para su revisión; ninguna altera las doctrinas aprobadas (`selector-engine.md`, `scoring.md`, `trimming-cli.md`, `pdf-integration.md`). |
| **Autor** | Claude (Director Técnico) |
| **Decide** | Qué unifica `cv build` y cómo se comporta como puerta de calidad; qué crea `cv init` y cómo evita pisar nada; qué significa exactamente anclar un ítem con `#pin` en selección, orden y recorte. |
| **Base** | `ROADMAP.md` (backlog B-1..B-3), `docs/arquitectura.md` §2.3–2.4, `docs/trimming-cli.md` §3.3. |

## 1. Objetivo y alcance

La lógica central del producto está terminada (Hito 2 declarado completo). Esta fase no añade capacidades de adaptación: consolida el flujo (una sola puerta de calidad), reduce la fricción inicial (arranque guiado) y da al usuario un control explícito sobre los algoritmos (anclaje). Cada tarea se entrega con cobertura del 100 %, verificación con el binario compilado y commit atómico.

## 2. T-2.7: `cv build`, la puerta de calidad (ref. B-1)

El backlog registró B-1 como `generate-cv --build` (atajo del flujo `build-profile → generate-cv`). El Director de Ingeniería lo reformula como **comando `build` unificado**: «el `tsc` de nuestro perfil de datos: rápido, estricto y el primer paso de cualquier CI». Se entregan ambas caras:

### 2.1 `cv build [-d <dir>] [-o <file>] [--check] [-v]`

- **Qué hace**: lee las fuentes, valida (estricto: cualquier problema es un error y se informan todos con `fichero:línea`) y escribe el artefacto canónico de forma atómica con permisos 0600. Es exactamente la hidratación de `docs/arquitectura.md` §2.3, ahora con nombre de compilador.
- **Silencioso si todo va bien**, como `tsc`; `-v` imprime una línea de resumen. Códigos: 0 correcto; 1 fuentes inválidas (o artefacto ausente/obsoleto con `--check`); 2 fallo del entorno (no se pudo escribir).
- **`--check` = `tsc --noEmit`**: no escribe nada. Falla (1) si las fuentes tienen problemas, si el artefacto no existe o si **no está al día**. «Al día» es una comparación **semántica**: se serializa el perfil compilado y se compara byte a byte con el artefacto en disco (la serialización es determinista); nunca por fechas, que dependen del reloj y de `git checkout`. Es la puerta de CI: `cv build --check` garantiza que lo versionado y lo generado coinciden.
- **Rapidez**: una sola pasada por las fuentes, sin pasos nuevos; la validación ya es lineal en el tamaño del dataset.
- **Compatibilidad**: `build-profile` se conserva como **alias** de `build` (misma implementación); la documentación y los mensajes pasan a decir `cv build`. `cv validate` se mantiene como comprobación ligera de solo fuentes (no mira el artefacto).

### 2.2 `--build` en `generate-cv` y `analyze-offer` (la forma original de B-1)

Recompila el artefacto (con `-d` como fuentes y `-p` como destino) antes de leerlo; si la compilación falla, el comando termina con su código y no genera nada. Con `--build` no hay aviso de artefacto obsoleto: acaba de escribirse. Sin `--build` el comportamiento no cambia (aviso, nunca reconstrucción implícita: escribir el artefacto sigue siendo una acción explícita del usuario).

## 3. T-2.8: `cv init`, arranque guiado (ref. B-2)

### 3.1 `cv init [dir] [--template <dir>]`

- Inicializa un **espacio de trabajo** en `dir` (por defecto el directorio actual): crea `data/sources/` con el dataset de ejemplo distribuido en `templates/dataset/` (el perfil sintético «Ada Ejemplo», sin datos reales) y un `.gitignore` con `data/dist/` y `output/` si no existe ninguno.
- **Nunca pisa nada**: antes de escribir comprueba todos los destinos; si alguno existe, lista los conflictos, no escribe ni un fichero y termina con código 2. Si ya hay un `.gitignore`, se respeta y solo se avisa si le faltan las dos entradas. No hay `--force`: borrar es tarea del usuario.
- Los ficheros se escriben con permisos 0600 (contendrán datos personales en cuanto el usuario los edite). Al terminar imprime los **siguientes pasos** (`cv build`, `cv generate-cv -s backend`, `--format pdf`).
- `--template <dir>` permite arrancar desde otro dataset de ejemplo (y es la vía de test con el sistema de ficheros en memoria). Un test carga el dataset distribuido con el cargador real: la plantilla siempre compila.

### 3.2 Por qué `templates/dataset/` y no `tests/fixtures/dataset/`

La fixture de tests contiene ficheros que existen solo para probar el cargador (`.hidden/`, `notes.txt`). Lo distribuible es una copia limpia con un `README.md` orientado al usuario; ambas comparten contenido y un test lo mantiene compilable.

## 4. T-2.9: tag reservada `#pin`, anclaje explícito (ref. B-3)

`docs/trimming-cli.md` §3.3 fijaba: `#<id-de-especialidad>` ancla un ítem a una especialidad (ya soportado); `#pin` lo ancla a *cualquier* oferta. Definición completa:

### 4.1 Sintaxis

`#pin` al final de una viñeta de logro, `pin` en la lista `tags` del frontmatter o en la columna `tags` de un CSV. Es una tag normal para el parser; el núcleo la reconoce como **reservada** (`PIN_TAG`).

### 4.2 Semántica (una sola regla por capa)

1. **Selección** (`SelectorEngine`): un ítem anclado es **relevante para toda especialidad** —real o virtual de una oferta— con razón `pinned`; un logro anclado **arrastra** su contenedor como si fuera una coincidencia explícita (regla «via-achievements» de `selector-engine.md` §2.2). Las tags restantes del ítem siguen contando para `matchedTags`.
2. **Orden**: «anclados primero, luego por puntuación, luego orden de documento». Se aplica donde ya se reordena (logros y skills con oferta, `scoring.md` §5.3) y al ranking del recorte. Sin oferta, los anclados van al principio de su sección en orden de documento.
3. **Recorte** (`applyLimits`): un anclado **nunca se recorta**. Consume plaza del límite (el límite es un presupuesto de página); si hay más anclados que plazas, sobreviven todos los anclados y ningún otro. Los cinco invariantes de `trimming-cli.md` §3.5 se mantienen (solo desaparecen ítems; conservación de orden; determinismo).
4. **Puntuación**: `pin` no puntúa ni entra en el vocabulario de la oferta (`buildVocabulary` la excluye): anclar cambia presencia y posición, nunca la adecuación medida. El informe de adecuación no se altera.
5. **Esquema**: `pin` no puede ser id ni tag de una especialidad (error de validación «reservada»); en el resto de entidades es válida.
6. **Explicabilidad**: `--explain` muestra `pinned` como razón de selección; el informe de recortes no cambia (un anclado no aparece nunca entre los recortados).

### 4.3 Invariantes que se verifican

Monotonía (añadir `#pin` solo añade ítems), idempotencia, conservación del contrato y del orden entre iguales, «anclado ⇒ presente» en cualquier combinación de `--specialty`, `--from-job-offer` y límites, y «`pin` ∉ vocabulario».

## 5. Fuera de alcance

B-4 (motor Typst) permanece en el backlog por decisión del Director de Ingeniería. No se añade `--force` a `cv init`, ni reconstrucción implícita del artefacto sin `--build`.
