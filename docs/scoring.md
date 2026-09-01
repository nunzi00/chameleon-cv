# Extracción de palabras clave y puntuación contra ofertas

| | |
|---|---|
| **Tareas** | T-2.1 · [NLP] Extracción de palabras clave de ofertas · T-2.2 · [CORE] Lógica de *scoring* y selección |
| **Estado** | **APROBADO** por el Director de Ingeniería el 2026-08-28 (v1; los seis puntos de §10 ratificados; es doctrina del proyecto). T-2.1 implementada en `src/core/keywords/`; T-2.2 en `src/core/scoring/`. |
| **Autor** | Claude (Director Técnico) |
| **Decide** | El contrato `JobRequirements`, cómo se extraen los requisitos de una oferta de forma determinista, cómo se puntúan los ítems del perfil y cómo encaja todo con el `SelectorEngine` existente. |
| **Base** | `docs/selector-engine.md` (regla de tags, contrato `Selection`, invariantes) y `docs/arquitectura.md` §3 (la capa LLM producirá el mismo `JobRequirements`). |

## 1. Objetivo y alcance

Pasar de «adaptar por especialidad» a «adaptar por oferta»: dado el texto de una oferta, saber **qué pide**, **qué del perfil lo demuestra** y **en qué orden mostrarlo**, sin modelos externos y con la misma explicabilidad que la selección por tags.

Dentro del alcance: el contrato `JobRequirements`, el extractor determinista (T-2.1), el vocabulario del perfil, el algoritmo de puntuación y su integración con el selector (T-2.2), el informe de adecuación y los ejemplos. Fuera del alcance (se cita solo para dejar los ganchos): el recorte a «N mejores» (T-2.3), el comando `--from-job-offer` (T-2.4), la entrada PDF (T-2.5) y la extracción por LLM (Hito 3, mismo contrato).

## 2. Principio rector: el perfil es el diccionario

Una oferta solo puede favorecer lo que el candidato puede demostrar. Por eso el extractor busca en la oferta **el vocabulario del propio perfil** —tags, nombres de skills y sus alias— en lugar de un diccionario externo. Consecuencias:

- **Precisión**: cada término encontrado se corresponde con ítems concretos del perfil; no hay falsos positivos «genéricos».
- **Sin mantenimiento**: el usuario ya etiqueta su contenido y ya declara alias (`k8s`, `tech lead`) en `skills.csv`; ese mismo dato hace de sinónimos del extractor.
- **Determinismo**: mismo perfil + misma oferta = mismo resultado, explicable línea a línea.

Un pequeño **diccionario incorporado** de tecnologías y prácticas habituales (extensible en el futuro) se usa **solo para detectar carencias**: términos que la oferta pide y que no aparecen en el vocabulario del perfil. Nunca puntúa.

## 3. Contratos (`src/core/keywords/` y `src/core/scoring/`)

```ts
/** Vocabulario del perfil: término normalizado → tags a las que da evidencia. */
export type Vocabulary = ReadonlyMap<string, ReadonlySet<string>>;

export type Emphasis = 'required' | 'desirable' | 'unknown';

export interface RequirementTerm {
  /** Término tal como está en el vocabulario (normalizado: minúsculas, sin acentos). */
  readonly term: string;
  /** Tags del perfil a las que da evidencia. */
  readonly tags: readonly string[];
  readonly occurrences: number;
  /** Énfasis más fuerte entre las líneas donde aparece. */
  readonly emphasis: Emphasis;
  /** Peso final del término (§4.5). */
  readonly weight: number;
  /** Hasta dos líneas originales donde aparece, para `--explain`. */
  readonly contexts: readonly string[];
}

export interface JobRequirements {
  /** Términos del vocabulario hallados, de mayor a menor peso (empate: orden de aparición). */
  readonly terms: readonly RequirementTerm[];
  /** Peso por tag: máximo de los pesos de los términos que la evidencian (§4.5). */
  readonly tagWeights: Readonly<Record<string, number>>;
  /** Mínimo de años exigido, si la oferta lo dice (§4.4). */
  readonly experienceYears?: number;
  /** Términos del diccionario presentes en la oferta y ausentes del vocabulario: carencias. */
  readonly gaps: readonly string[];
}

/** Esquema zod del contrato: lo cumple el extractor determinista y lo cumplirá la salida del LLM (Hito 3). */
export const JobRequirementsSchema: z.ZodType<JobRequirements>;

export function buildVocabulary(profile: MasterProfile): Vocabulary;
export function extractJobRequirements(offerText: string, vocabulary: Vocabulary, options?: ExtractionOptions): JobRequirements;

export interface ScoredDecision extends ItemDecision {
  readonly score: number;
  /** Términos de la oferta que aportan puntuación al ítem (evidencia). */
  readonly matchedTerms: readonly string[];
}

export interface MatchReport {
  readonly requirements: JobRequirements;
  readonly decisions: readonly ScoredDecision[];
  /** Término → ids de los ítems incluidos que lo evidencian (vacío = pedido y no demostrado). */
  readonly coverage: Readonly<Record<string, readonly string[]>>;
}

export interface ScoredSelection {
  readonly selection: Selection;
  /** `selection.profile` con logros y skills reordenados por puntuación (§5.3). */
  readonly profile: MasterProfile;
  readonly report: MatchReport;
}

export function scoreSelection(selection: Selection, requirements: JobRequirements, options?: ScoringOptions): ScoredSelection;
export function offerSpecialty(profile: MasterProfile, requirements: JobRequirements): Specialty;   // especialidad virtual (§5.1)
```

## 4. T-2.1: extracción de requisitos

### 4.1 Entrada

Texto plano UTF-8 de la oferta (`.txt` o `.md`; T-2.5 aportará el texto de un PDF y el Hito 3 el de una URL). Normalización: NFC, finales de línea `\n`, BOM fuera. El análisis es **por líneas**: cada línea conserva su texto original (para los contextos) y una versión normalizada para buscar (minúsculas, sin diacríticos, espacios colapsados).

### 4.2 Vocabulario del perfil (`buildVocabulary`)

| Fuente | Término | Tags a las que da evidencia |
|---|---|---|
| Tag de cualquier ítem (experiencias, logros, proyectos, formación, skills, certificaciones, especialidades) | la propia tag | `{tag}` |
| Nombre de una skill | nombre normalizado | tags de la skill |
| Alias de una skill | alias normalizado | tags de la skill |

Se unen los conjuntos cuando un término procede de varias fuentes (`php` → `{php, backend}`). Los términos sin tags (skill sin etiquetar) no entran: no hay nada que puntuar con ellos. `technologies` no se usa: son nombres de presentación (`PHP 8.3`); la evidencia de una tecnología se declara con tags o alias.

### 4.3 Énfasis por secciones

Una línea de tipo **encabezado** —corta (≤ 60 caracteres) y, además, terminada en «:» o de tres palabras como mucho— que contiene uno de estos patrones abre una sección que dura hasta el siguiente encabezado. Una línea normal que contiene un patrón («Experiencia con Kafka es un plus») toma ese énfasis **solo para sí misma** (precisión 2026-08-28, tras la implementación: evita que una frase suelta reclasifique todo lo que la sigue):

| Énfasis | Patrones (es/en, sin acentos, insensible a mayúsculas) | Peso base |
|---|---|---|
| `required` | `requisitos`, `imprescindible`, `se requiere`, `necesitamos`, `must have`, `requirements`, `required`, `what you need` | 1.0 |
| `desirable` | `deseable`, `valorable`, `se valorara`, `plus`, `bonus`, `nice to have`, `good to have` | 0.5 |
| `unknown` | antes de la primera sección o fuera de ellas | 0.75 |

El énfasis de un término es el **más fuerte** de las líneas en que aparece (`required` > `unknown` > `desirable`).

### 4.4 Años de experiencia

Patrones sobre la línea normalizada: `N+ años`, `N años`, `N-M años`, `N years`, `N+ yrs`, **solo en líneas que mencionan «experiencia»/«experience»** (precisión 2026-08-28: «empresa con 20 años» no es un requisito) y con un máximo plausible de 40. De cada mención se toma el mínimo (`3-5` → 3). `experienceYears` = el **mayor** de los mínimos hallados (si la oferta pide 5 años en una cosa y 2 en otra, exige 5). Es informativo: no puntúa en esta versión.

### 4.5 Matching y pesos

1. Los términos del vocabulario se ordenan de **más largo a más corto**.
2. Para cada línea normalizada y cada término: se buscan apariciones con **límites propios** (el carácter anterior y posterior no puede ser alfanumérico), porque `\b` no funciona con `c++`, `c#`, `.net` o `node.js`. Cada aparición se enmascara con espacios antes de seguir, de modo que un término más corto no vuelva a contar dentro de uno más largo (`google cloud platform` ⊃ `google cloud`).
3. Por término: apariciones acumuladas, énfasis máximo, hasta dos contextos (líneas originales, recortadas a 160 caracteres).
4. **Peso del término** = `pesoBase(énfasis) × (1 + 0.25 × min(apariciones − 1, 3))`. Repetir un requisito lo refuerza, con techo (máx. ×1.75).
5. **Peso por tag** = máximo de los pesos de los términos que la evidencian (`kubernetes` y `k8s` no suman doble).
6. **Carencias**: términos del diccionario incorporado hallados en la oferta (mismo matching) que no están en el vocabulario.

Todo es puro y determinista. Opciones (`ExtractionOptions`, con estos valores por defecto): `requiredWeight: 1`, `unknownWeight: 0.75`, `desirableWeight: 0.5`, `frequencyBoost: 0.25`, `maxBoostedOccurrences: 3`, `contextsPerTerm: 2`.

## 5. T-2.2: puntuación e integración con el `SelectorEngine`

### 5.1 La oferta induce una especialidad virtual

La regla de tags sigue siendo el **filtro previo**; el *scoring* **ordena** (y en T-2.3 recortará) dentro de lo relevante. Para reutilizar el selector sin cambiarlo, una oferta se convierte en una especialidad virtual:

```
offerSpecialty(profile, requirements) = {
  id: 'offer',
  title: profile.personal.headline ?? profile.personal.fullName,
  tags: claves de requirements.tagWeights
}
```

- **Sin `--specialty`**: `selectForSpecialty(profile, 'offer')` sobre un perfil cuyo único `specialties` es la virtual. Se conservan los ítems universales y los que coinciden con alguna tag de la oferta; los etiquetados sin coincidencia quedan fuera.
- **Con `--specialty backend`**: la selección se hace por la especialidad real (titular, resumen y filtro habituales) y la oferta solo puntúa y ordena. El usuario elige la «versión» del CV; la oferta la afina.

Ninguna de las dos vías toca el `SelectorEngine`: se reutiliza tal cual, con sus seis invariantes intactos.

### 5.2 Fórmula

```
score(ítem plano)     = Σ_{tag ∈ ítem.tags} tagWeights[tag]                       (0 si no hay coincidencias)
score(contenedor)     = score propio + Σ score(logros conservados)
matchedTerms(ítem)    = términos de la oferta cuyas tags intersecan las del ítem
```

Aditiva, sin factores ocultos: la explicación de una puntuación es la lista de sus términos y pesos. Los ítems universales (sin tags) puntúan 0: se conservan por la regla del selector, pero van detrás de lo que sí demuestra la oferta.

### 5.3 Qué se reordena y qué no

| Sección | Orden en el CV | Uso de la puntuación |
|---|---|---|
| Experiencias, formación | Cronológico (lo impone el renderer) | Solo informe y, en T-2.3, recortes de sus logros |
| Logros (dentro de cada contenedor y transversales) | **Por puntuación descendente**; empate: orden de documento | Reordenación (el renderer respeta el orden de documento de los logros) |
| Skills | **Por puntuación descendente** dentro de cada categoría | Reordenación |
| Proyectos, certificaciones | Cronológico | Informe y recortes en T-2.3 |

Un CV no deja de ser cronológico por adaptarse a una oferta: lo que cambia es **qué viñetas y skills aparecen primero**.

Precisión (2026-08-28, T-2.9): los ítems con la tag reservada `pin` van **antes** que los puntuados («anclados primero, luego por puntuación, luego orden de documento»); `pin` no puntúa ni entra en el vocabulario (`buildVocabulary` la excluye), así que anclar no altera la adecuación medida ni el informe.

### 5.4 Informe de adecuación

`MatchReport` amplía el informe del selector: cada decisión lleva `score` y `matchedTerms`; `coverage` dice, por cada término pedido, qué ítems incluidos lo demuestran (lista vacía = pedido y no demostrado); `requirements.gaps` lista lo que la oferta pide y el perfil ni siquiera tiene etiquetado. Con `--explain`:

```
Oferta: 7 requisitos reconocidos, 5 años exigidos · carencias: rendimiento, observabilidad, aws, gcp
  php (required ×2, 1.25) · symfony (required ×2, 1.25) · kubernetes (required, 1.00) · performance (required, 1.00) · backend (unknown, 0.75) · kafka (desirable, 0.50) · tech lead (desirable, 0.50)
+ experience exp-acme: matched (php, symfony, kubernetes) · 7.75 [php, symfony, kubernetes]
    + exp-acme-1: matched (performance, php) · 2.25 [php, symfony, performance]
    + exp-acme-k8s: matched (kubernetes, devops) · 2.00 [kubernetes]
    - exp-acme-3: no-match
+ experience exp-startup: matched (liderazgo) · 0.50 [tech lead]
…
No demostrado: kafka
```

Entre paréntesis, las tags que coincidieron con el vocabulario de selección; entre corchetes, los términos de la oferta que aportan puntuación (un término da evidencia a todas las tags de su skill: `symfony` evidencia `php` porque la skill Symfony está etiquetada con `php`).

```
```

### 5.5 Invariantes (se verifican en los tests)

1. **Puras y deterministas**: extractor y *scoring* no mutan sus entradas.
2. **Conservan el contrato**: `scoreSelection(...).profile` valida con `validateMasterProfile` y contiene exactamente los mismos ítems que `selection.profile` (solo cambia el orden de logros y skills).
3. **Monotonía de la extracción**: añadir menciones de un término nunca baja su peso; añadir un alias a una skill nunca reduce la puntuación de ningún ítem.
4. **Monotonía de la puntuación**: añadir a un ítem una tag pedida por la oferta nunca baja su puntuación.
5. **Reordenación estable**: los empates conservan el orden de documento.
6. **Explicable**: `score(ítem) = Σ tagWeights[tag]` sobre `matchedTerms`, comprobable a mano desde el informe.

## 6. Ejemplo completo (dataset de ejemplo de `tests/fixtures/dataset/`)

Oferta (`offer.txt`):

```
Senior Backend Engineer (PHP/Symfony)

Buscamos una persona con experiencia construyendo APIs de alto rendimiento.

Requisitos:
- 5+ años de experiencia con PHP y Symfony.
- Experiencia con Kubernetes y despliegues en producción.
- Mentalidad de performance y observabilidad.

Deseable:
- Kafka o sistemas de mensajería.
- Experiencia liderando equipos (tech lead).
- AWS o GCP.
```

Vocabulario relevante del perfil: tags `php, symfony, kubernetes, kafka, performance, liderazgo, devops, backend, platform…`; skills `PHP [php, backend]`, `Symfony [symfony, php, backend]`, `Kubernetes [kubernetes, devops, platform]` (alias `k8s`), `Liderazgo técnico [liderazgo]` (alias `tech lead`, `team lead`).

Términos extraídos:

| Término | Apariciones | Énfasis | Peso | Tags evidenciadas |
|---|---|---|---|---|
| `php` | 2 (título + requisitos) | required | 1.25 | php, backend |
| `symfony` | 2 | required | 1.25 | symfony, php, backend |
| `kubernetes` | 1 | required | 1.00 | kubernetes, devops, platform |
| `performance` | 1 | required | 1.00 | performance |
| `backend` | 1 (título) | unknown | 0.75 | backend |
| `kafka` | 1 | desirable | 0.50 | kafka |
| `tech lead` | 1 | desirable | 0.50 | liderazgo |

`experienceYears = 5`. Carencias (diccionario, en orden de aparición): `rendimiento`, `observabilidad`, `aws`, `gcp` (`rendimiento` porque el perfil etiqueta `performance`, no su sinónimo en castellano: un alias lo resolvería). Pesos por tag: php 1.25 · backend 1.25 (máximo entre `php`/`symfony` a 1.25 y `backend` a 0.75) · symfony 1.25 · kubernetes 1.00 · devops 1.00 · platform 1.00 · performance 1.00 · kafka 0.50 · liderazgo 0.50.

Selección por la especialidad virtual (tags de la oferta) y puntuación:

| Ítem | Decisión | Puntuación |
|---|---|---|
| `exp-acme` [php, symfony, kubernetes] | matched | 3.50 propio + 2.25 + 2.00 = **7.75** |
| · `exp-acme-1` [performance, php] | matched | 2.25 |
| · `exp-acme-k8s` [kubernetes, devops] | matched | 2.00 |
| · `exp-acme-3` [testing, arquitectura] | **excluido** (no-match) | — |
| `exp-startup` [node.js, typescript, liderazgo] | matched (`liderazgo`) | 0.50 |
| `proj-chameleon` [typescript, cli] | **excluido** | — |
| `edu-universidad` (sin tags) | universal | 0 |
| Skills: `Symfony` 3.75 · `Kubernetes` 3.00 · `PHP` 2.50 · `Liderazgo técnico` 0.50 · `C++` excluida | | |
| Certificaciones: `Symfony Certified` 2.50 · `CKA` 2.00 | | |
| Logros transversales: `ach-2` [liderazgo, comunidad] 0.50 · `ach-1` excluido | | |

Efecto en el CV: en ACME, el logro de latencia (2.25) precede al de Kubernetes (2.00); en habilidades, dentro de cada categoría, primero lo más pedido. La cobertura señala `kafka` como pedido y no demostrado, y las carencias `rendimiento`, `observabilidad`, `aws`, `gcp`.

## 7. Integración prevista en la CLI (T-2.4)

- `cv generate-cv --from-job-offer offer.txt [--specialty backend] [--explain]`: extrae, selecciona (virtual o real), puntúa, reordena y renderiza. `--explain` añade el bloque de §5.4.
- `cv analyze-offer offer.txt` (propuesto): solo el informe, sin generar CV. Barato con las piezas anteriores y útil para decidir si merece la pena aplicar.

## 8. Fuera de alcance y ganchos

- **T-2.3 «N mejores»**: recorte por sección usando `score` (p. ej. `--max-achievements 5`, `--max-skills 12`); los ítems universales cuentan como cualquier otro (puntúan 0). Se especificará sobre `MatchReport`.
- **T-2.5 PDF**: `pdf-parse` produce el texto plano de §4.1; nada más cambia.
- **Hito 3 (LLM)**: `extractJobRequirements` tendrá una implementación alternativa por modelo que devuelve el mismo `JobRequirements`, validado con `JobRequirementsSchema`; el *scoring* y el informe no cambian.
- **Sin `natural`** (sugerido en el roadmap): con el perfil como diccionario, regex y normalización bastan; `natural` aportaría *stemming* y tokenización que aquí no compensan su tamaño ni su indeterminismo entre versiones. Queda como opción si más adelante se quiere reconocer variantes morfológicas (`liderar` → `liderazgo`).

## 9. Decisiones técnicas

| Decisión | Elección | Motivo |
|---|---|---|
| Diccionario principal | El vocabulario del perfil (tags + nombres y alias de skills) | Precisión, cero mantenimiento, explicabilidad. |
| Diccionario incorporado | Solo para carencias; ~150 tecnologías y prácticas en `src/core/keywords/dictionary.ts` | Detectar lo que la oferta pide y el perfil no tiene, sin contaminar la puntuación. |
| Énfasis | Secciones por patrones es/en; pesos 1 / 0.75 / 0.5 | Barato, determinista, cubre la estructura habitual de las ofertas. |
| Pesos por tag | Máximo (no suma) entre términos sinónimos | Un sinónimo no debe contar doble. |
| Integración | Especialidad virtual + `selectForSpecialty` sin cambios | Reutiliza el selector y sus invariantes; un solo camino de selección. |
| Reordenación | Solo logros y skills; el resto cronológico | Un CV adaptado sigue siendo un CV. |
| Módulos | `src/core/keywords/` (vocabulary, sections, extractor, dictionary, schema) y `src/core/scoring/` (scorer, ranking, report) | Lógica pura; cobertura 100 %. |
| Tests | Fixture de oferta de §6 con tabla de términos esperada, invariantes (§5.5), golden del bloque `--explain` | Igual que el selector. |

## 10. Puntos de decisión (todos aprobados el 2026-08-28)

1. **El perfil como diccionario** (tags + nombres y alias de skills; `technologies` fuera) y el diccionario incorporado solo para carencias (§2, §4.2). Recomendación: aprobar.
2. **Énfasis por secciones y pesos** 1 / 0.75 / 0.5 con refuerzo por frecuencia hasta ×1.75 (§4.3, §4.5). Recomendación: aprobar (son opciones con valores por defecto, ajustables sin tocar código).
3. **Especialidad virtual** para la oferta y el reparto de papeles con `--specialty` (§5.1). Recomendación: aprobar.
4. **Fórmula aditiva** y **reordenación solo de logros y skills** (§5.2, §5.3). Recomendación: aprobar.
5. **`cv analyze-offer`** como comando adicional en T-2.4 (§7). Recomendación: aprobar.
6. **Sin `natural`** en esta fase (§8). Recomendación: aprobar.

Aprobados los seis puntos sin modificaciones. Precisiones registradas tras la implementación: encabezados de sección (§4.3), años solo en líneas de experiencia (§4.4) y el término `backend` del título en el ejemplo (§6).

## 11. El co-piloto como segunda fuente de `JobRequirements` (T-9.10, encargo del PO del 1-sep-2026)

Encargo: «cuando se facilita una oferta para generar el CV, ¿se puede meter un LLM para poder decidir?». La
respuesta acordada es **sí, pero leyendo la oferta, no decidiendo el CV**, y es exactamente el gancho que §8 dejó
anotado desde el primer día: `extractJobRequirements` gana una implementación alternativa por modelo que devuelve
el **mismo** `JobRequirements`; el *scoring*, la selección y el informe no cambian ni una línea.

### 11.1 Por qué el modelo no decide

Tres razones, y ninguna es de principios abstractos:

1. **Explicabilidad.** Hoy `--explain` dice, ítem a ítem, por qué entró: `universal`, `match`,
   `via-achievements`, `pinned`. Si decidiera el modelo, la respuesta sería «porque sí» — y un CV se defiende
   línea a línea en una entrevista.
2. **Reproducibilidad.** La misma oferta y el mismo perfil dan hoy el mismo CV. El arnés determinista lo
   comprueba con 202 pasos byte a byte; con un modelo decidiendo, ese arnés deja de existir.
3. **C2.** La IA propone y la persona decide. Qué va en tu CV es justo la línea que no se cruza.

### 11.2 El hueco que sí llena

El matcher es **literal**: si la oferta pide «arquitectura orientada a eventos» y tus skills dicen «Kafka», no hay
coincidencia salvo que exista un alias. Ahí el modelo aporta lo que el código no puede: **tender el puente
semántico** entre el lenguaje de la oferta y el tuyo.

### 11.3 Forma acordada (misma mecánica que `suggest tags` e `import map`)

- Al modelo se le envía el texto de la oferta y **tu vocabulario cerrado** (tags, nombres y alias de tus skills).
- Devuelve **solo tags que ya existen en tu perfil**, con su peso.
- **El código verifica** cada una contra ese vocabulario: lo que no esté, se rechaza y se cuenta en el informe.
  El modelo no puede inventarte una habilidad que no tienes; solo puede decir «esto que la oferta pide lo
  demuestra *esta* tag tuya».
- El resultado se valida con `JobRequirementsSchema` y entra por la misma puerta que la extracción determinista.
- **Opt-in por orden** (`--copilot`), con el consentimiento de coste y el egreso explícito del resto del
  co-piloto. Sin la opción, cero red y el comportamiento de hoy, intacto.
- `--explain` debe distinguir **qué término vino del modelo y cuál del matcher**: sin eso se pierde la mitad del
  valor de la explicación.

### 11.4 Antes de construirlo

**Medir el hueco**: cuántos requisitos de ofertas reales quedan hoy sin casar por falta de alias. Si son pocos,
un puñado de alias en `skills.csv` sale mucho más barato que un hito, y conviene saberlo antes de empezar.

### 11.5 Lo medido (1-sep-2026) y lo entregado

**La medida, primero.** Sobre tres ofertas reales del PO, de **12 términos distintos marcados como carencia solo
3 eran falsos**: `ci/cd` (la oferta usa barra, el perfil guion), `testing` (el perfil lo dice con `calidad`,
Vitest, pytest) y `jwt` (en la prosa, sin skill). Los otros nueve son carencias reales, que ningún modelo puede
inventar. Y una de las tres ofertas **no declara requisitos técnicos** —su stack vive tras un enlace—: allí un
LLM lee la misma nada. Los tres huecos falsos se cerraron el mismo día **sin modelo**: unificando los
separadores en el normalizador y añadiendo dos skills al perfil.

La recomendación técnica fue, por tanto, **no construirlo todavía**. El PO decidió construirlo igualmente, y
queda escrito para poder volver a medirlo cuando haya más ofertas.

**Lo entregado.** Tarea `offer map` (`prompts/offer-map.v1.md`, `src/llm/tasks/offer-map.ts`) con la misma
mecánica que `suggest tags` e `import map`: vocabulario cerrado —`tag` restringida por `enum` en el esquema que
viaja al proveedor— y **dos guardas verificadas por código, no por confianza**:

1. la etiqueta ha de estar en el vocabulario que se envió;
2. la `evidence` ha de aparecer **literalmente** en la oferta, comparada con el mismo normalizador que usa el
   emparejado.

Lo que no cumple ambas se descarta y **se cuenta por motivo** (`unknownTag`, `unverifiedEvidence`,
`alreadyKnown`, `duplicate`), para que el informe pueda decir cuántas propuestas se cayeron y por qué.

Tres decisiones sostienen que el modelo **añade y no manda**:

- **Egreso mínimo (C4)**: lo único del candidato que sale es la lista de etiquetas —sin nombres de skill, sin
  logros, sin nada más del perfil—. El texto de la oferta ya es público.
- **Peso de una evidencia única**: una etiqueta del co-piloto entra con el peso de su `emphasis` y **sin
  refuerzo por frecuencia**; el modelo aporta que el requisito existe, no cuántas veces lo repite la oferta. Y
  `Math.max` impide que rebaje lo que el emparejado literal ya puntuó más alto.
- **Origen visible**: `--explain` escribe `, co-piloto` en el término que puso el modelo. Sin eso se pierde la
  mitad del valor de la explicación: no sabrías qué parte de tu adecuación descansa en él.

**Una sola vía para los tres clientes (C14)**: el motor vive en `src/app/offer-map.ts` y lo consumen igual la CLI
(`--copilot`), la API (`POST /analyze-offer` con `copilot`) y la web (la casilla «Refinar la lectura con el
co-piloto» en Generar). La API es síncrona —es UNA petición al modelo, no un lote—, así que el consentimiento
sigue el patrón de `offers/fetch` y no el de la cola de trabajos: 403 `remote-disabled` sin `--allow-remote` y 409
`consent-required` con la estimación y un `estimateId` de un solo uso. La estimación no se conoce hasta después de
planificar, así que el 409 se arma desde el propio callback de consentimiento, que anota lo que costaría y aborta
antes de llamar al proveedor.

### 11.6 El límite que la verificación en vivo dejó a la vista

Ejecutado con Ollama sobre una oferta real: 5 propuestas, 3 verificadas y 2 descartadas por el código. Una de
las **verificadas** era un disparate —la frase estaba en la oferta, pero no sostenía la etiqueta `kafka`—.

Esto no es un defecto que se arregle: **el código puede comprobar que la evidencia existe; que la *sostenga* solo
puede juzgarlo una persona.** De ahí que el informe imprima siempre cada aportación con su frase entera
(`arquitectura (desirable) ← «sistemas de mensajería»`) en vez de resumir «3 etiquetas añadidas». Ver la
evidencia es lo que convierte al modelo en co-piloto y no en oráculo, que es C2 escrito en una línea de salida.
