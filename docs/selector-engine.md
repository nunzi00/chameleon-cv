# SelectorEngine y plantilla del MarkdownRenderer

| | |
|---|---|
| **Tareas** | T-1.5 · [CORE] `SelectorEngine` (especificación) · T-1.7 · [GENERATOR] `MarkdownRenderer` (propuesta de plantilla) |
| **Estado** | **APROBADO** por el Director de Ingeniería el 2026-08-28 (v1, sin modificaciones; los seis invariantes de §2.5 son requisitos no negociables). T-1.5 implementada en `src/core/selection/`; T-1.7 pendiente. |
| **Autor** | Claude (Director Técnico) |
| **Decide** | Cómo se elige qué partes del `MasterProfile` van a un CV de una especialidad, con qué contrato, y con qué plantilla se renderiza. |

## 1. Objetivo y alcance

El `SelectorEngine` es la esencia del camaleón: un módulo de **lógica pura** que, dado un `MasterProfile` canónico y el id de una especialidad, devuelve el perfil reducido a lo relevante para ella y un informe que explica cada decisión. Sus consumidores son el `MarkdownRenderer` (T-1.7) y el comando `generate-cv` (T-1.8).

Dentro del alcance: la regla de selección, la herencia de tags, la firma y los tipos, el informe de selección, los invariantes y los ejemplos; y, para T-1.7, la arquitectura del renderer y la plantilla base. Fuera del alcance: el *scoring* contra ofertas y la selección de los «N mejores» (Hito 2), que se apoyarán en este mismo contrato (§4).

## 2. SelectorEngine

### 2.1 Conceptos

- **Vocabulario de la especialidad** `V(S) = S.tags ∪ { S.id }`. Todo está ya en minúsculas y sin duplicados (lo garantiza el esquema). Incluir el id permite «fijar» un ítem a una especialidad concreta con una sola tag (`#backend`).
- **Coincidencia explícita** de un ítem: `explicit(item) = item.tags ∩ V(S) ≠ ∅`.
- **Ítem universal**: un ítem **sin tags** (`tags = []`). Es relevante para todas las especialidades.
- **Relevante**: `relevant(item) = universal(item) ∨ explicit(item)`.

La regla se resume en una frase: **sin tags, siempre; con tags, solo si alguna coincide.** Consecuencia deseada: un dataset sin etiquetar produce el CV completo para cualquier especialidad, y cada tag que se añade es una restricción. El etiquetado es progresivo y nunca «rompe» un CV.

### 2.2 Algoritmo

Secciones **no filtradas**: `meta`, `personal`, `languages`. Sobre `personal` se aplican las sobrescrituras de la especialidad: `headline = S.title` (siempre; es obligatorio en `Specialty`) y `summary = S.summary` si la especialidad lo define.

Secciones **planas** (`skills`, `certifications`, `education`, `achievements` transversales): se conserva cada ítem con `relevant(item)`.

Secciones **contenedoras** (`experience`, `projects`), en dos pasos:

1. El contenedor se conserva si `relevant(contenedor)` **o** si alguno de sus logros tiene coincidencia **explícita** (`explicit(logro)`). Un logro universal no arrastra a su contenedor: es universal *dentro* de él, no una razón para incluirlo.
2. Dentro de un contenedor conservado, se conserva cada logro con `relevant(logro)`.

`specialties` del perfil resultante contiene únicamente la especialidad seleccionada. El orden de todos los ítems se conserva tal cual (el orden cronológico es cosa del renderer, §5.3).

Pseudocódigo:

```
V = set(S.tags) ∪ {S.id}
explicit(tags) = tags.some(t => V.has(t))
relevant(tags) = tags.length === 0 || explicit(tags)

for section in [skills, certifications, education, achievements]:
  keep item if relevant(item.tags)                              # reason: universal | matched | no-match

for section in [experience, projects]:
  own = relevant(item.tags)
  pulled = !own && item.achievements.some(a => explicit(a.tags))
  keep item if own || pulled                                    # reason: universal | matched | via-achievements | no-match
  if kept: item.achievements = item.achievements.filter(a => relevant(a.tags))

personal.headline = S.title; personal.summary = S.summary ?? personal.summary
specialties = [S]
```

### 2.3 Herencia de tags: la práctica recomendada

Con la regla anterior, un logro sin tags «hereda» de hecho el destino de su contenedor: aparece siempre que este aparezca. La práctica que se documentará para los usuarios es **etiquetar los logros, no las experiencias**: una experiencia sin tags aparece en todos los CV (continuidad de la carrera) y los logros etiquetados adaptan las viñetas a cada especialidad. Una experiencia solo se etiqueta cuando *todo* el puesto es irrelevante para alguna especialidad (p. ej. un trabajo de camarero en un CV de ingeniería).

### 2.4 Firma y tipos (`src/core/selection/`)

```ts
export type SelectionReason = 'universal' | 'matched' | 'via-achievements' | 'no-match';

export interface ItemDecision {
  readonly section: 'experience' | 'projects' | 'education' | 'skills' | 'certifications' | 'achievements';
  readonly id: string;
  /** Solo en logros anidados: id de la experiencia o proyecto que los contiene. */
  readonly parentId?: string;
  readonly included: boolean;
  readonly reason: SelectionReason;
  /** Tags del ítem que están en el vocabulario (vacío si universal o sin coincidencia). */
  readonly matchedTags: readonly string[];
}

export interface SelectionReport {
  readonly specialtyId: string;
  readonly vocabulary: readonly string[];
  readonly decisions: readonly ItemDecision[];
}

export interface Selection {
  readonly specialty: Specialty;
  /** MasterProfile reducido: mismo tipo y mismo contrato que la entrada. */
  readonly profile: MasterProfile;
  readonly report: SelectionReport;
}

export type SelectionResult =
  | { readonly ok: true; readonly selection: Selection }
  | { readonly ok: false; readonly error: { readonly code: 'UNKNOWN_SPECIALTY'; readonly message: string; readonly available: readonly string[] } };

export function selectForSpecialty(profile: MasterProfile, specialtyId: string): SelectionResult;

/** Utilidades puras, exportadas para reutilización y tests. */
export function specialtyVocabulary(specialty: Specialty): ReadonlySet<string>;
export function relevanceOf(tags: readonly string[], vocabulary: ReadonlySet<string>): { relevant: boolean; explicit: boolean; matchedTags: string[] };
```

El informe alimenta un `--explain` en la CLI (T-1.8): «`exp-startup` excluida: sin coincidencia (tags node.js, typescript)». Sin especialidad (`generate-cv` sin `--specialty`) no se invoca al selector: el renderer recibe el perfil completo con su `headline`/`summary` por defecto.

### 2.5 Invariantes (se verifican en los tests)

1. **Pura y determinista**: no muta la entrada; misma entrada, misma salida.
2. **Conserva el contrato**: `validateMasterProfile(selection.profile)` es válido siempre.
3. **Conserva el orden** de los ítems que sobreviven.
4. **Idempotente**: seleccionar el resultado con la misma especialidad devuelve el mismo perfil.
5. **Monótona respecto al etiquetado**: quitar tags a un ítem nunca lo excluye, y añadir tags nunca incluye un ítem que estaba excluido salvo que la tag esté en el vocabulario. Precisión (2026-08-28, tras la implementación): para un logro anidado la garantía se cumple *dentro de su contenedor*; si el logro era el único que arrastraba a su contenedor (`via-achievements`, §2.2.1), quitarle las tags hace que el contenedor —y con él el logro— deje de aparecer. Es la consecuencia directa de la regla aprobada, y la suite verifica explícitamente esa única excepción.
6. **Explicable**: hay exactamente una decisión por ítem evaluado (incluidos los logros de contenedores conservados) y `included ⇔ reason ≠ 'no-match'`.

## 3. Ejemplos antes/después

Dataset mínimo (solo lo relevante para la selección):

```
specialties/backend.md              title: Senior Backend Engineer     tags: [php, symfony, kubernetes]
specialties/engineering-manager.md  title: Engineering Manager         tags: [liderazgo, gestion, agile]

experience/acme.md                  tags: []  (universal)
  A1 Reduje la latencia p95 un 40 %.               #performance #php
  A2 Lideré la migración a Kubernetes.             #kubernetes #liderazgo
  A3 Mentoricé a 4 desarrolladores.                #liderazgo #gestion
  A4 Responsable del área de pagos.                (sin tags)
experience/startup.md               tags: [node.js, typescript]
  S1 Definí la arquitectura del producto.          #arquitectura #typescript
projects/platform.md                tags: [terraform]
  P1 Diseñé el proceso de guardias (on-call).      #gestion
skills.csv      PHP [php, backend] · Kubernetes [kubernetes, devops] · Liderazgo técnico [liderazgo] · Comunicación []
certifications.csv   CKA [kubernetes, devops]
achievements.md      ach-1 Ponente en una conferencia. #comunidad · ach-2 Mentora en un programa. #liderazgo
```

**`--specialty backend`** (vocabulario: `backend, php, symfony, kubernetes`):

| Ítem | Decisión | Motivo |
|---|---|---|
| `exp-acme` | incluida | universal |
| · A1 | incluido | matched (`php`) |
| · A2 | incluido | matched (`kubernetes`) |
| · A3 | **excluido** | no-match |
| · A4 | incluido | universal |
| `exp-startup` | **excluida** | no-match (ni la experiencia ni S1 coinciden) |
| `proj-platform` | **excluido** | no-match |
| PHP, Kubernetes | incluidas | matched |
| Comunicación | incluida | universal |
| Liderazgo técnico | **excluida** | no-match |
| CKA | incluida | matched (`kubernetes`) |
| ach-1, ach-2 | **excluidos** | no-match |
| `personal` | `headline` = «Senior Backend Engineer»; `summary` = el de la especialidad si existe | — |

**`--specialty engineering-manager`** (vocabulario: `engineering-manager, liderazgo, gestion, agile`):

| Ítem | Decisión | Motivo |
|---|---|---|
| `exp-acme` | incluida | universal |
| · A1 | **excluido** | no-match |
| · A2, A3 | incluidos | matched (`liderazgo`; `liderazgo`, `gestion`) |
| · A4 | incluido | universal |
| `exp-startup` | **excluida** | no-match |
| `proj-platform` | incluido | **via-achievements** (P1 coincide por `gestion`, aunque `terraform` no) |
| · P1 | incluido | matched (`gestion`) |
| Liderazgo técnico, Comunicación | incluidas | matched; universal |
| PHP, Kubernetes, CKA | **excluidos** | no-match |
| ach-2 | incluido | matched (`liderazgo`) |
| ach-1 | **excluido** | no-match |

Los cuatro motivos (`universal`, `matched`, `via-achievements`, `no-match`) aparecen en los ejemplos y serán los casos de la suite.

## 4. Fuera de alcance y ganchos para el Hito 2

- **Scoring** (T-2.2): el mismo contrato, con un `score` por decisión en el informe y un criterio de corte «N mejores por sección» (T-2.3). La regla de tags seguirá siendo el filtro previo; el scoring ordena y recorta dentro de lo relevante.
- **Exclusiones explícitas** (`!backend`) y **pesos** por tag: no en el MVP; el vocabulario como conjunto lo admite sin cambiar la firma.
- **Alias de skills** (`aliases`): no intervienen en la selección por especialidad; son para el emparejamiento con ofertas.

## 5. MarkdownRenderer (T-1.7): arquitectura y plantilla base

### 5.1 Arquitectura: modelo de vista + plantilla sin lógica

- `buildCvView(profile, locale) → CvView` (`src/renderers/markdown/view.ts`): función **pura** que ordena, agrupa y formatea todo (fechas por locale, periodos, línea de contacto, grupos de skills, etiquetas de sección). 100 % testeable sin plantilla.
- `renderMarkdownCv(profile, options) → string` (`src/renderers/markdown/renderer.ts`): compila la plantilla Handlebars con `noEscape: true` (la salida es Markdown, no HTML; el texto ya viene saneado por el esquema) y la aplica al `CvView`. Después normaliza los espacios en blanco (nunca más de una línea vacía seguida; salto final) para que quien edite la plantilla no tenga que pelear con Handlebars.
- **Una sola plantilla para todos los idiomas**: los títulos de sección y palabras como «actualidad» salen del modelo de vista (`labels`), elegidos por `meta.locale` (tabla `es`/`en`, `en` como reserva). `--template <fichero>` permite una plantilla propia.
- La plantilla base vive en `templates/cv.md.hbs` y se copia a `dist/` en el *build*.

### 5.2 Plantilla base propuesta (`templates/cv.md.hbs`)

```handlebars
# {{fullName}}

**{{headline}}**

{{#if contact}}{{contact}}{{/if}}

{{#if summary}}{{summary}}{{/if}}

{{#if experience.length}}
## {{labels.experience}}
{{#each experience}}

### {{role}} · {{company}}

*{{period}}{{#if location}} · {{location}}{{/if}}*

{{#if summary}}{{summary}}{{/if}}

{{#each achievements}}
- {{text}}{{#if impact}} ({{impact}}){{/if}}
{{/each}}

{{#if technologies}}*{{../labels.technologies}}:* {{technologies}}{{/if}}
{{/each}}
{{/if}}

{{#if projects.length}}
## {{labels.projects}}
{{#each projects}}

### {{name}}{{#if role}} · {{role}}{{/if}}

{{#if meta}}*{{meta}}*{{/if}}

{{#if summary}}{{summary}}{{/if}}

{{#each achievements}}
- {{text}}{{#if impact}} ({{impact}}){{/if}}
{{/each}}

{{#if technologies}}*{{../labels.technologies}}:* {{technologies}}{{/if}}
{{/each}}
{{/if}}

{{#if skillGroups.length}}
## {{labels.skills}}

{{#each skillGroups}}
- **{{label}}:** {{names}}
{{/each}}
{{/if}}

{{#if achievements.length}}
## {{labels.achievements}}

{{#each achievements}}
- {{text}}{{#if impact}} ({{impact}}){{/if}}
{{/each}}
{{/if}}

{{#if education.length}}
## {{labels.education}}

{{#each education}}
- **{{degree}}**{{#if field}} ({{field}}){{/if}} · {{institution}}{{#if period}} · {{period}}{{/if}}
{{/each}}
{{/if}}

{{#if certifications.length}}
## {{labels.certifications}}

{{#each certifications}}
- **{{name}}**{{#if issuer}} · {{issuer}}{{/if}}{{#if date}} · {{date}}{{/if}}{{#if url}} · [{{../labels.link}}]({{url}}){{/if}}
{{/each}}
{{/if}}

{{#if languages.length}}
## {{labels.languages}}

{{#each languages}}
- {{name}}: {{level}}
{{/each}}
{{/if}}
```

### 5.3 Reglas de formato del modelo de vista

| Elemento | Regla |
|---|---|
| Orden | `experience`, `projects` y `education` por `dates.start` descendente, los periodos en curso primero; `certifications` por `date` descendente; sin fecha, al final en orden de documento. `achievements` y `skills`: orden de documento. |
| Fechas | `YYYY` → «2021»; `YYYY-MM` → «mar 2021» (`Intl.DateTimeFormat` con `meta.locale`, mes corto); `YYYY-MM-DD` → «15 mar 2021». |
| Periodos | «mar 2021 – jun 2024»; sin `end`: «mar 2021 – actualidad» (`present` en `en`). Guion largo `–` con espacios. |
| Contacto | `ciudad, país · email · teléfono · [GitHub](url) · [LinkedIn](url)`: solo las partes presentes, unidas por « · ». |
| Skills | Agrupadas por `category` en orden fijo (`language`, `framework`, `library`, `tool`, `platform`, `database`, `cloud`, `methodology`, `domain`, `soft`, `other`) con etiqueta por locale («Lenguajes», «Frameworks», «Librerías», «Herramientas», «Plataformas», «Bases de datos», «Cloud», «Metodologías», «Dominio», «Competencias», «Otras»); nombres unidos por «, ». `level` y `years` se exponen en el modelo de vista para plantillas propias, pero la base no los imprime. |
| Tecnologías | Unidas por «, ». |
| Idiomas | `native` → «nativo»/«native»; niveles MCER tal cual. |
| Proyectos | `meta` = periodo y URL (`ago 2026 – actualidad · https://…`), solo las partes presentes. |
| Texto | `summary`, `text` e `impact` se emiten tal cual: son Markdown del autor. |

### 5.4 Salida esperada para el ejemplo (backend)

Con el dataset de §3 completado con los datos personales del dataset de ejemplo, `generate-cv --specialty backend` produciría (fichero *golden* de la suite de T-1.7):

```markdown
# Ada Ejemplo

**Senior Backend Engineer**

Madrid, España · ada@example.com · +34 600 000 000 · [GitHub](https://github.com/ada-ejemplo)

APIs y sistemas distribuidos para esta especialidad.

## Experiencia

### Senior Backend Engineer · ACME Corp

*mar 2021 – jun 2024 · Madrid (remoto)*

Plataforma de pagos con 2 M de transacciones/mes.

- Reduje la latencia p95 un 40 %. (-40 % p95)
- Lideré la migración a Kubernetes.
- Responsable del área de pagos.

*Tecnologías:* PHP 8.3, Symfony 6.4, Kubernetes

## Habilidades

- **Lenguajes:** PHP
- **Plataformas:** Kubernetes
- **Competencias:** Comunicación

## Formación

- **Grado en Ingeniería Informática** (Software) · Universidad Ejemplo · 2010 – 2014

## Certificaciones

- **CKA** · CNCF · may 2022 · [enlace](https://example.com/cert/cka)

## Idiomas

- Español: nativo
- Inglés: C1
```

## 6. Decisiones técnicas

| Decisión | Elección | Motivo |
|---|---|---|
| Ubicación del selector | `src/core/selection/` | Lógica de negocio pura, sin dependencias; entra en el umbral del 100 %. |
| Motor de plantillas | **Handlebars** (`noEscape`, sin helpers de lógica) | Plantillas sin lógica, muy conocidas, CJS nativo; EJS invita a meter código en la plantilla, justo lo que el modelo de vista evita. `noEscape` es correcto porque la salida es Markdown y el contenido ya está saneado (sin caracteres de control, URLs solo http(s)). |
| Formato del modelo de vista | Cadenas ya formateadas + datos crudos donde una plantilla propia pueda quererlos | La plantilla base queda trivial y la personalización sigue siendo posible. |
| Tests | Selector: tabla de casos con los cuatro motivos + invariantes (§2.5). Renderer: unitarios del modelo de vista (fechas, orden, agrupación, locales) y *golden file* del CV del dataset de ejemplo. | Cobertura 100 % en `src/core/selection/**` y `src/renderers/**`. |

## 7. Puntos de decisión (todos aprobados el 2026-08-28)

1. **Regla de selección** «sin tags = universal; con tags = debe coincidir», con contenedores arrastrados solo por logros con coincidencia explícita (§2.1–2.2). Recomendación: aprobar.
2. **Práctica recomendada** «etiqueta los logros, no las experiencias» como guía documentada para el usuario (§2.3). Recomendación: aprobar.
3. **Contrato** `Selection { specialty, profile, report }` con informe explicable (§2.4). Recomendación: aprobar.
4. **Renderer**: Handlebars + modelo de vista + una plantilla para todos los idiomas con etiquetas por locale y `--template` (§5.1). Recomendación: aprobar.
5. **Orden cronológico en el renderer**, no en el selector (§5.3). Recomendación: aprobar.
6. **Plantilla base** de §5.2 y formato de §5.3 como *golden* del MVP. Recomendación: aprobar (los ajustes estéticos posteriores son cambios de plantilla, no de código).

Aprobados los seis puntos sin modificaciones; la práctica «etiqueta los logros, no las experiencias» pasa a ser la recomendación oficial de la documentación de usuario.
