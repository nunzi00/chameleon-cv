# Arquitectura de Chameleon CV

| | |
|---|---|
| **Estado** | Vigente. Recoge el análisis estratégico del Director de Ingeniería y Producto (2026-08-28) con las anotaciones técnicas del Director Técnico. |
| **Ámbito** | Ecosistema de datos (Hitos 1–2) y capa de inteligencia (Hito 3, propuesto). |
| **Relación** | El formato de las fuentes se especifica en `docs/formato-dataset.md`; el contrato de datos, en `src/core/schema/`. |

## 1. Principio rector: el «lago de datos del perfil»

`MasterProfile` (validado por zod) es el activo central. Hay **una sola fuente de verdad para la máquina** (`data/dist/profile.json`) y **fuentes legibles y editables para el humano** (`data/sources/`). Nunca compiten: el JSON siempre se deriva de las fuentes y el humano nunca lo edita.

## 2. Ecosistema de datos

```
data/sources/  (edita el humano)                                  data/dist/profile.json          output/
  profile.md   ─┐                                                  (canónico, generado,            cv_<spec>.md
  experience/   ├─► parsers (plugins) ─► fusión ─► validación ─► escritura atómica ────────────► renderers ─► cv_<spec>.pdf
  projects/     │   .md  → MarkdownParser                          │                                   ▲
  skills.csv    │   .csv → CsvParser                               │                                   │
  …            ─┘                                                  └──── re-validación al leer ────────┘
                 ↑ cv build-profile                                                    ↑ cv generate · cv match
```

### 2.1 Fuentes (`data/sources/`)

- **Markdown** para lo narrativo: perfil, resúmenes, experiencias, proyectos, formación, logros. Formato en `docs/formato-dataset.md`.
- **CSV** para lo tabular: `skills.csv`, `certifications.csv` (T-1.3); extensible a otros.
- Nada más: cualquier otro fichero se ignora o es error según las reglas del formato.

### 2.2 Parsers como plugins (`src/parsers/`)

```ts
interface SourceParser {
  readonly name: string;                    // 'markdown' | 'csv' | …
  readonly extensions: readonly string[];   // ['.md'] — el cargador despacha por extensión
  parse(file: SourceFile): ParseResult;     // función pura: sin disco, sin red
}

interface SourceFile {
  readonly path: string;                    // relativa a la raíz del dataset (de ella salen tipo de entidad e id)
  readonly content: string;
}

type ParseResult =
  | { readonly ok: true; readonly contribution: ProfileContribution; readonly provenance: readonly Provenance[] }
  | { readonly ok: false; readonly errors: readonly DatasetError[] };

type ProfileContribution = Partial<MasterProfileInput>;       // cada fichero aporta secciones completas del perfil
interface Provenance { readonly path: SchemaPath; readonly file: string; readonly line?: number }
interface DatasetError { readonly file: string; readonly line?: number; readonly message: string }
```

- Añadir un formato (TOML, XML, JSON…) = un fichero nuevo que implemente `SourceParser`. El núcleo no cambia (Principio 3).
- Los parsers **no lanzan**: devuelven `Result`, igual que `validateMasterProfile`.
- Nota técnica: la ruta forma parte de la entrada porque de ella salen el tipo de entidad y el `id` por defecto, y porque todo error debe señalar `fichero:línea`.

### 2.3 Hidratación: `cv build-profile`

1. Recorre `data/sources/` aplicando los límites y reglas de seguridad de `docs/formato-dataset.md` §10.
2. Despacha cada fichero al parser por extensión.
3. **Fusiona** las contribuciones: los arrays se **concatenan** en orden de documento; los objetos se fusionan en profundidad; que dos fuentes fijen el mismo escalar es un **conflicto** (error que cita ambos ficheros), nunca «gana la última».
4. Valida con `validateMasterProfile`; los errores globales (p. ej. ids duplicados) se traducen a `fichero:línea` con la procedencia que registran los parsers.
5. Escribe `data/dist/profile.json` **solo si todo es válido**, de forma atómica (fichero temporal + renombrado).

### 2.4 Artefacto canónico: `data/dist/profile.json`

- Única entrada de generadores, CLI y capa de inteligencia.
- Contiene datos personales en claro: `data/dist/` está en `.gitignore` y se escribe con permisos `0600`.
- **Se re-valida al leer** con `parseMasterProfile`: no se confía en un fichero de disco aunque lo hayamos escrito nosotros.
- `generate` comprobará si alguna fuente es más reciente que el artefacto y avisará o reconstruirá (a decidir en T-1.5), para no producir CVs con datos obsoletos.

### 2.5 Renderers, no parsers

Las salidas (Markdown en el MVP; PDF después) son *renderers*: `MasterProfile` + selección → fichero en `output/`. Para PDF se evaluará en su momento `pandoc` (binario externo, sin dependencias npm pesadas) frente a `puppeteer` (descarga Chromium, ~300 MB); decisión en T-2.6.

## 3. Capa de inteligencia: «co-piloto de carrera» (Hito 3, propuesto)

### 3.1 Abstracción (`src/core/llm/`)

```ts
interface LlmService {
  extractJobRequirements(offerText: string): Promise<JobRequirements>;
  tailorProfile(input: {
    profile: MasterProfile;
    requirements: JobRequirements;
    specialtyId: string;
  }): Promise<TailoredResult>;
}
```

Implementaciones previstas: `OllamaLlmService` (local, **por defecto**), `AnthropicLlmService`, `OpenAiLlmService`. La aplicación depende solo de la interfaz; en tests se sustituye por un doble.

### 3.2 Flujo de `cv match <url | fichero>`

1. Obtención y saneado del texto de la oferta (`cheerio` sobre HTML, o fichero local `.txt`/`.pdf` de T-2.5).
2. LLM, tarea 1 → `JobRequirements { skills[], experienceYears?, responsibilities[], keywords[] }`.
3. LLM, tarea 2 → `TailoredResult { profile: MasterProfile; analysis: MatchAnalysis { strengths[], perfectMatches[], potentialGaps[] } }`.
4. Render del CV a medida e informe de adecuación en consola.

### 3.3 Anotaciones técnicas de obligado cumplimiento

Ratificadas por el Director de Ingeniería como **principios canónicos del proyecto** el 2026-08-28, junto con las de §2.3 (fusión sin sobrescritura) y §2.4 (manejo del artefacto `profile.json`).

- **Toda salida del modelo se valida con zod** (`JobRequirements`, `TailoredResult`) antes de usarse: JSON inválido es error, no *best effort*. El perfil a medida pasa por `parseMasterProfile`: el modelo no puede inventar campos ni romper el contrato.
- `MatchAnalysis` vive **fuera** de `MasterProfile` (en `TailoredResult`), no en `meta`: el esquema es estricto y `meta` describe el documento, no una candidatura.
- **Egreso de red = opt-in explícito.** Por defecto todo es local (Ollama). Enviar el perfil a un proveedor remoto exige un flag explícito (p. ej. `--provider anthropic`) y muestra qué se envía. Claves solo por variables de entorno; nunca en ficheros del repositorio.
- **Minimización:** al proveedor se envía el perfil **ya filtrado por especialidad** y sin `personal.email`, `phone` ni `location`; el modelo no los necesita para seleccionar logros.
- El *scraping* de URLs también es egreso de red y se somete al mismo opt-in; no se persisten las páginas descargadas.
- Determinismo y coste: temperatura baja, `max_tokens` acotado y caché local de `JobRequirements` por *hash* del texto de la oferta.

## 4. Decisiones registradas

| Fecha | Decisión | Origen |
|---|---|---|
| 2026-08-28 | Fuentes en `data/sources/`; artefacto canónico `data/dist/profile.json` generado por `build-profile`; renderers, CLI y LLM leen solo el artefacto. | Director de Ingeniería (propuesta); Director Técnico (§2.3–2.4). |
| 2026-08-28 | Parsers como plugins con el contrato `SourceParser`; fusión con concatenación de arrays y conflicto en escalares. | ídem. |
| 2026-08-28 | Certificaciones en CSV (`certifications.csv`), no en Markdown. | Director de Ingeniería. |
| 2026-08-28 | Capa LLM abstracta con implementación local por defecto; Hito 3 propuesto en el roadmap, pendiente de planificación. | ídem. |
| 2026-08-28 | Disposición **A** (un fichero por entidad) para las entidades narrativas de `data/sources/`; `docs/formato-dataset.md` aprobado íntegramente (v2). | Director de Ingeniería. |
| 2026-08-28 | Principios canónicos ratificados: fusión sin sobrescritura (§2.3), manejo del artefacto `profile.json` (§2.4), validación zod de toda salida del modelo y política de egreso de red *opt-in* (§3.3). | Director de Ingeniería (ratificación); Director Técnico (redacción). |
