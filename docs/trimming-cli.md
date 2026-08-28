# Recorte «N mejores» y CLI de adaptación por oferta

| | |
|---|---|
| **Tareas** | T-2.3 · [GENERATOR] Solo los «N mejores» por sección · T-2.4 · [CLI] `--from-job-offer` y `cv analyze-offer` |
| **Estado** | **APROBADO** por el Director de Ingeniería el 2026-08-28 (v1; los seis puntos de §8 ratificados y canonizados). T-2.3 en `src/core/scoring/trim.ts` y `summary.ts`; T-2.4 en `src/cli/`. |
| **Autor** | Claude (Director Técnico) |
| **Decide** | Qué se recorta y con qué ranking, qué pasa con los ítems universales, cómo interactúan `--top-n`, `--from-job-offer` y `--specialty`, y qué produce `cv analyze-offer`. |
| **Base** | `docs/scoring.md` (contrato `ScoredSelection`/`MatchReport`, doctrina «reordenación limitada») y `docs/selector-engine.md`. |

## 1. Objetivo y alcance

Cerrar el ciclo de adaptación por oferta de cara al usuario: `cv generate-cv --from-job-offer oferta.txt` produce un CV afinado y recortado a lo mejor; `cv analyze-offer oferta.txt` dice, antes de generar nada, cuánto encaja el perfil y dónde flojea.

Dentro del alcance: la política de recorte (T-2.3), su algoritmo e invariantes, la sintaxis y semántica de la CLI (T-2.4), el informe de `analyze-offer` y los ejemplos. Fuera del alcance: PDF de entrada (T-2.5) y salida (T-2.6), y la extracción por LLM (Hito 3).

## 2. Principios

1. **El recorte vive en el núcleo, no en la plantilla.** La plantilla sigue sin lógica (doctrina del modelo de vista, `docs/selector-engine.md` §5.1): el renderer recibe un perfil ya recortado. El roadmap hablaba de «que la plantilla renderice solo los N mejores»; el efecto es el mismo y la plantilla no aprende a decidir.
2. **Un solo ranking.** Puntuación descendente y, a igual puntuación, orden de documento. Sin oferta todos puntúan 0 y el ranking **es** el orden de documento: `--top-n` significa entonces «los N primeros tal como los escribiste».
3. **Los universales no tienen privilegio ni penalización.** Puntúan 0, van detrás de lo que demuestra la oferta y se recortan como cualquier otro ítem (§3.3).
4. **El usuario manda.** No hay recorte sin un límite explícito (o el preset `--compact`). Un CV nunca pierde contenido «por sorpresa».
5. **Un CV sigue siendo un CV.** Experiencias, formación e idiomas nunca se recortan por puntuación; lo que se adapta es qué logros, skills, proyectos y certificaciones aparecen.
6. **Explicable.** Cada recorte se puede listar (`--explain`): qué ítem, de qué sección, con qué puntuación.

## 3. T-2.3: política de recorte

### 3.1 Qué se recorta y qué no

| Sección | Recortable | Límite | Ranking |
|---|---|---|---|
| Logros dentro de cada experiencia y proyecto | sí | `--top-n` (por contenedor) | puntuación desc · orden de documento |
| Logros transversales (`achievements`) | sí | `--top-n` | ídem |
| Skills | sí | `--max-skills` (global, no por categoría) | ídem |
| Proyectos | sí | `--max-projects` | ídem (los supervivientes se muestran cronológicamente) |
| Certificaciones | sí | `--max-certifications` | ídem (cronológico en el CV) |
| Experiencias, formación, idiomas, datos personales | **no** | — | — |

`--max-skills` es global y no por categoría: la agrupación por categoría es presentación; lo que el usuario pide es «las 12 skills más relevantes para esta oferta». Si una categoría se queda vacía, desaparece del CV.

### 3.2 Algoritmo (`src/core/scoring/trim.ts`)

```ts
export interface SectionLimits {
  readonly achievementsPerContainer?: number;   // --top-n
  readonly achievements?: number;               // --top-n (transversales)
  readonly skills?: number;                     // --max-skills
  readonly projects?: number;                   // --max-projects
  readonly certifications?: number;             // --max-certifications
}

export interface RemovedItem {
  readonly section: 'experience' | 'projects' | 'achievements' | 'skills' | 'certifications';
  readonly id: string;
  readonly parentId?: string;                   // logros anidados
  readonly score: number;
}

export interface TrimResult {
  readonly profile: MasterProfile;              // mismo contrato; solo desaparecen ítems
  readonly removed: readonly RemovedItem[];     // en el orden en que se recortaron, con su puntuación
}

export function applyLimits(profile: MasterProfile, limits: SectionLimits, scoreOf: (id: string) => number): TrimResult;
```

`keepTop(items, n, scoreOf)`: se ordenan los índices por `(puntuación desc, índice asc)`, se conservan los `n` primeros y **los supervivientes mantienen el orden con el que llegaron** (para logros y skills, el orden por puntuación de T-2.2; para proyectos y certificaciones, el de documento). `undefined` = sin límite; `0` = la sección desaparece. `scoreOf` sale de `MatchReport.decisions`; sin oferta es `() => 0`.

Pipeline completo: `selección → (puntuación) → recorte → render`.

### 3.3 Regla de los ítems universales

Un ítem sin tags es **relevante para todo** (regla del selector) pero **no demuestra nada concreto** de la oferta: puntúa 0. Por tanto:

- Con oferta: va detrás de todo lo que puntúa; con `--top-n N`, un contenedor muestra primero sus N mejores logros puntuados y solo si sobran plazas entran los universales, en orden de documento. Es el primero en caer, nunca el único.
- Sin oferta: todos puntúan 0, manda el orden de documento; el usuario controla el recorte escribiendo primero lo más importante.
- Un ítem que **siempre** deba aparecer para una especialidad se fija con la tag `#<id-de-especialidad>` (ya soportado). Fijarlo para *cualquier* oferta (tag reservada `#pin`) queda en el *backlog* (B-3) hasta que haga falta.

### 3.4 Preset `--compact`

`--compact` ≡ `--top-n 4 --max-skills 12 --max-projects 4 --max-certifications 5`. Cualquier límite explícito prevalece sobre el preset. Es la vía rápida a «un CV de una página».

### 3.5 Invariantes (se verifican en los tests)

1. **Conserva el contrato**: el perfil recortado valida y es un subconjunto (por ids) del de entrada; nada se reescribe.
2. **Conserva el orden** de los supervivientes.
3. **Monótono en N**: subir un límite nunca elimina un ítem que sobrevivía; `undefined` no recorta nada; `0` vacía la sección.
4. **Determinista y puro**: mismos datos y límites, mismo resultado; la entrada no se muta.
5. **Explicable y completo**: `removed` contiene exactamente los ítems que faltan, con su puntuación; `|removed| = |entrada| − |salida|`.

### 3.6 Ejemplo (dataset de ejemplo, oferta de `docs/scoring.md` §6)

Con `--top-n 1 --max-skills 2`:

| Sección | Ranking (puntuación) | Se queda | Recortado |
|---|---|---|---|
| Logros de `exp-acme` | exp-acme-1 (2.25) · exp-acme-k8s (2.00) | exp-acme-1 | exp-acme-k8s (2.00) |
| Skills | Symfony (3.75) · Kubernetes (3.00) · PHP (2.50) · Liderazgo técnico (0.50) | Symfony, Kubernetes | PHP (2.50), Liderazgo técnico (0.50) |
| Logros transversales | ach-2 (0.50) | ach-2 | — |
| Certificaciones | sin límite | cert-1, cert-2 | — |

Si `exp-acme` tuviera además un logro sin tags, puntuaría 0, iría detrás de los dos anteriores y sería el primero en caer.

## 4. T-2.4: CLI

### 4.1 `cv generate-cv` ampliado

| Opción | Efecto |
|---|---|
| `--from-job-offer <fichero>` | Texto plano UTF-8 (`.txt`, `.md`; PDF en T-2.5). `-` lee la oferta de la entrada estándar (pegar desde un portal). Máximo 1 MiB; vacía = error. |
| `--top-n <n>` | Logros por experiencia/proyecto y logros transversales. |
| `--max-skills <n>` · `--max-projects <n>` · `--max-certifications <n>` | Límites por sección. |
| `--compact` | Preset de §3.4; los límites explícitos prevalecen. |
| `--explain` | Además del informe existente: bloque de adecuación (`docs/scoring.md` §5.4) y resumen de recortes. |

Los límites son enteros ≥ 0; otra cosa es error de uso (salida 2). Todas las opciones anteriores (`--specialty`, `--profile`, `--output`, `--template`, `--locale`, `--stdout`, `--data`) siguen igual.

### 4.2 Matriz de interacción

| `--from-job-offer` | `--specialty` | Selección | Ranking | Titular y resumen |
|---|---|---|---|---|
| no | no | ninguna: CV completo | orden de documento | los del perfil |
| no | sí | especialidad real | orden de documento | de la especialidad |
| sí | no | especialidad virtual `offer` (tags de la oferta) | puntuación de la oferta | los del perfil |
| sí | sí | especialidad real | puntuación de la oferta | de la especialidad |

Los límites (§3) se aplican en las cuatro filas sobre el resultado de la selección. Regla práctica para el usuario: **`--specialty` elige la versión del CV; `--from-job-offer` la afina; `--top-n` la condensa.**

### 4.3 Nombre del fichero de salida

`output/cv-<nombre>[-<especialidad>][-<oferta>].md`, donde `<oferta>` es el *slug* del nombre del fichero de la oferta sin extensión (`ofertas/acme-backend.txt` → `acme-backend`; con `-`, `oferta`). Ejemplo: `output/cv-ada-ejemplo-backend-acme-backend.md`. `--output` sigue mandando.

### 4.4 `--explain` con oferta y recortes

Tras el informe de selección se imprime el bloque de adecuación de `docs/scoring.md` §5.4 y, si hubo recortes:

```
Recortes (--top-n 1, --max-skills 2): 3 ítems fuera
  exp-acme: exp-acme-k8s (2.00)
  skills: skill-1 PHP (2.50), skill-5 Liderazgo técnico (0.50)
```

### 4.5 `cv analyze-offer <fichero> [--specialty <id>] [--profile <file>] [--explain] [--json]`

Inspección sin generación: lee el artefacto (con el mismo aviso de frescura), extrae, selecciona (virtual o real) y puntúa; **no escribe ficheros**. Tres formatos:

**Resumen legible (por defecto).** Está pensado para decidir si merece la pena aplicar y qué reforzar; no es la auditoría por ítem:

```
Oferta acme-backend.txt · 7 requisitos reconocidos · 5 años de experiencia exigidos
Adecuación: 6 de 7 requisitos demostrados (86 %) · imprescindibles: 4 de 4

Demostrados
  php           required ×2  1.25  ← exp-acme-1, skill-1, skill-2, cert-2
  symfony       required ×2  1.25  ← exp-acme, skill-2, cert-2
  kubernetes    required     1.00  ← exp-acme-k8s, skill-3, cert-1
  performance   required     1.00  ← exp-acme-1
  backend       unknown      0.75  ← skill-1, skill-2
  tech lead     desirable    0.50  ← exp-startup, skill-5, ach-2
No demostrados
  kafka         desirable    0.50   (si lo tienes, etiquétalo o añade un alias en skills.csv)
Carencias (la oferta lo pide y el perfil no lo tiene etiquetado)
  rendimiento · observabilidad · aws · gcp
Mejores evidencias
  1. exp-acme · ACME Corp — Senior Backend Engineer (7.75)
  2. skill-2 · Symfony (3.75)
  3. skill-3 · Kubernetes (3.00)
  4. skill-1 · PHP (2.50)
  5. cert-2 · Symfony Certified Developer (2.50)
```

**`--explain`.** Añade la auditoría por ítem (exactamente el bloque de `generate-cv --explain`), para depurar el etiquetado.

**`--json`.** Salida estructurada para *scripts* y para la capa LLM del Hito 3: `{ offer: { source, terms, experienceYears, gaps }, summary: { recognized, demonstrated, ratio, requiredDemonstrated, requiredTotal }, coverage, decisions, ranking }` — el `MatchReport` de T-2.2 más el resumen (`summarizeMatch(report)`, función pura del núcleo compartida por el texto y el JSON). En `--json` no se imprime nada más en stdout.

Salidas: 0 correcto · 1 datos (artefacto ausente o inválido, especialidad desconocida, oferta vacía) · 2 uso o entorno (fichero de oferta ilegible).

## 5. Módulos y tests

| Pieza | Ubicación | Notas |
|---|---|---|
| Recorte | `src/core/scoring/trim.ts` (`applyLimits`, `keepTop`, `COMPACT_LIMITS`) | Puro; 100 %. |
| Resumen de adecuación | `src/core/scoring/summary.ts` (`summarizeMatch`) | Puro; base del texto y del JSON. |
| Lectura de la oferta | `src/cli/offer.ts` (`readOfferText`: fichero o stdin, límite 1 MiB, vacío = error) | I/O mínima e inyectable (stdin como `() => Promise<string>` en el contexto). |
| CLI | `src/cli/commands/generate-cv.ts` (ampliado), `src/cli/commands/analyze-offer.ts`, `src/cli/explain.ts` (recortes), `src/cli/program.ts` | Opciones numéricas validadas por commander (`argParser`). |
| Tests | `applyLimits` (invariantes §3.5, `0`, `undefined`, universales), matriz §4.2, nombre de salida, `--compact` y precedencia, `analyze-offer` en texto (golden con el dataset de ejemplo), `--explain` y `--json` (validado contra un esquema), stdin, errores. | Cobertura 100 %. |

## 6. Fuera de alcance y backlog

- **T-2.5**: la oferta en PDF pasa a texto y entra por la misma puerta (`readOfferText`).
- **B-3 (backlog)**: tag reservada `#pin` para fijar ítems en cualquier oferta (§3.3).
- **Hito 3**: `analyze-offer --json` es la salida que consumirá el «co-piloto».

## 7. Decisiones técnicas

| Decisión | Elección | Motivo |
|---|---|---|
| Recorte en el núcleo | `trim.ts` sobre `MasterProfile` + `scoreOf` | Plantilla sin lógica; mismo contrato antes y después. |
| Un solo ranking | puntuación desc · orden de documento | Sin oferta degrada a «los N primeros»; sin reglas especiales. |
| Universales | puntúan 0, sin privilegio | Coherente con `docs/scoring.md` §5.2 y con el control del usuario por orden de documento y `#<especialidad>`. |
| Límites explícitos + preset | `--top-n`, `--max-*`, `--compact` | Descubribles en `--help`; el preset da la vía rápida sin ocultar el comportamiento. |
| `analyze-offer` | resumen legible por defecto, `--explain` y `--json` | Inspección ≠ auditoría ≠ integración; cada público tiene su formato sin duplicar lógica (`summarizeMatch`). |
| Oferta por stdin (`-`) | sí | Pegar una oferta desde un portal es el caso real más frecuente; coste mínimo. |

## 8. Puntos de decisión (todos aprobados el 2026-08-28)

1. **Secciones recortables** (logros por contenedor y transversales, skills, proyectos, certificaciones) y **nunca** experiencias, formación e idiomas (§3.1). Recomendación: aprobar.
2. **Regla de los universales**: puntúan 0, detrás de lo puntuado, se recortan como los demás; `#<especialidad>` para fijar; `#pin` al backlog (§3.3). Recomendación: aprobar.
3. **Sintaxis**: `--top-n` para logros, `--max-skills` / `--max-projects` / `--max-certifications`, y preset `--compact` = 4 / 12 / 4 / 5 (§3.4, §4.1). Recomendación: aprobar (valores del preset ajustables sin tocar código).
4. **Matriz de interacción** y sufijo de oferta en el nombre de salida (§4.2, §4.3). Recomendación: aprobar.
5. **`cv analyze-offer`**: resumen legible por defecto, `--explain` para la auditoría por ítem y `--json` para máquinas; oferta por stdin con `-` (§4.5). Recomendación: aprobar.
6. **Recorte en el núcleo, no en la plantilla** (§2.1). Recomendación: aprobar.

Con la aprobación se marca el documento como APROBADO y se implementan T-2.3 y T-2.4 (en ese orden, cada una con su cobertura al 100 %).
