# Portabilidad del perfil: `cv export` y `cv import`, la inversa de `cv build`

| | |
|---|---|
| **Tarea** | T-8.1 · [DATOS] Portabilidad fundacional (Hito 8) |
| **Estado** | PROPUESTA v1 (2026-08-30) **APROBADA en su totalidad** por el Director de Ingeniería y Producto el 2026-08-30 (diez decisiones de §10); **ENTREGADA** el 2026-08-30 (S1, S2 y S3 en §11); versión 1.4.0 preparada, etiquetado por orden del Director |
| **Autor** | Claude (Director Técnico) |
| **Base** | `docs/formato-dataset.md` y `docs/formato-csv.md` (el formato de las fuentes); `src/core/schema/master-profile.ts` (el perfil canónico, `schemaVersion` 1); `src/parsers/` (fuentes → perfil); `src/app/sources.ts` y `src/parsers/markdown/apply.ts` (las dos escrituras de fuentes que ya existen: `PUT /sources/{path}` e `improve apply`); `docs/api-headless.md` (patrón de la API); nota del Director en `ROADMAP.md` (T-8.1) |

## 0. Resumen ejecutivo

- **No se inventa un segundo formato**: el fichero de intercambio **es el perfil canónico** (`MasterProfile`, el mismo JSON que `cv build` escribe en `data/dist/profile.json`, con `meta.schemaVersion`). `cv export` lo produce **desde las fuentes** (nunca copia el artefacto, que puede no existir o estar viejo); `cv import` lo lee, lo valida con el mismo esquema estricto y **regenera las fuentes Markdown/CSV** con la disposición fija que `cv build` espera: es la transformación inversa que hoy no existe.
- **La importación se comprueba a sí misma antes de escribir** (C12, C13): las fuentes regeneradas se vuelven a analizar con el parser real y el perfil resultante se compara con el importado; a la primera diferencia, no se escribe nada y se explica dónde. Regla: *importar no escribe nada que `cv build` no reconstruya exactamente*.
- **Escribir fuentes es un acto explícito del usuario** (C9): `cv import` solo escribe en un directorio de fuentes vacío o inexistente; sustituir uno existente exige `--replace` y deja una copia completa (`data/sources.<marca>.bak/`); `--dry-run` enseña el plan. Es la segunda orden que escribe en `data/sources/` (la primera es `improve apply`), y por la misma vía: a petición, sin IA, con copia de seguridad.
- Alcance: núcleo en `src/app/portability.ts` con serializadores puros (`src/parsers/markdown/serialize.ts`, `src/parsers/csv/serialize.ts`) al 100 %; CLI (`cv export`, `cv import`) y API (`GET /export`, `POST /import`) como clientes delgados (C14); GUI mínima en Estado (exportar/importar) como sprint opcional; guía «Exportar e importar el perfil»; escenario `portability` en el arnés determinista con la ida y vuelta completa; versión **1.4.0**.

## 1. Objetivo y alcance

**Objetivo.** Que el perfil salga y entre del producto en un formato estructurado, versionado y validado, sin romper el principio de que la fuente de verdad son las fuentes Markdown/CSV: exportar para llevárselo, respaldarlo, editarlo con otras herramientas o alimentar otras; importar para empezar un proyecto desde un perfil existente (otro proyecto, una copia de seguridad, una herramienta externa que hable el esquema) y seguir editando las fuentes como siempre.

**Dentro**: `cv export`; `cv import` con validación, plan, auto-chequeo, copia de seguridad y escritura; serializadores deterministas de frontmatter, cuerpo Markdown (resumen y `## Logros` con metadatos) y CSV; rutas `GET /api/v1/export` y `POST /api/v1/import`; pruebas unitarias al 100 %, ida y vuelta sobre `templates/dataset` y el banco del arnés, escenario de aceptación; guía, referencia generada, CHANGELOG y 1.4.0.

**Fuera** (y por qué): otros formatos de intercambio (JSON Resume, hResume, Europass) —el esquema propio ya es el canónico; un `--format json-resume` es una tarea aparte si el Director la pide—; importar desde PDF (T-8.4, *spike* con decisión Go/No-Go; `cv import` queda reservado al formato estructurado y un futuro PDF entraría como `--from pdf` tras el Go); fusionar un perfil con fuentes existentes (*merge*) —C9 y la ambigüedad de la fusión lo desaconsejan; se importa a un directorio vacío o se sustituye con copia—; conservar el formato original de las fuentes al importar (importar regenera fuentes canónicas: no es una edición); migraciones entre `schemaVersion` (solo existe la 1; cuando haya una 2, las migraciones serán su tarea).

## 2. Situación de partida

- **Fuentes → perfil** (`src/parsers/dataset/loader.ts`, `layout.ts`, `merge.ts`; `src/core/schema/validate.ts`): disposición fija (`profile.md`, `specialties/`, `experience/`, `projects/`, `education/` en orden alfabético, `achievements.md`, `skills.csv`, `certifications.csv`), frontmatter YAML *failsafe* (todo texto), cuerpo = resumen y, en experiencia y proyectos, `## Logros` con viñetas cuyas `#etiquetas` finales son las etiquetas y cuyos metadatos van en una sublista (`impact:`, `date:`, `id:`); CSV con delimitador autodetectado, `|` para multivalor e ids posicionales (`skill-<n>`, `cert-<n>`) salvo columna `id`. Validación zod **estricta** (clave desconocida = error), mensajes en castellano, todos los errores a la vez con `fichero:línea`.
- **Perfil** (`src/core/schema/master-profile.ts`): `meta`, `personal`, `specialties`, `experience`, `projects`, `education`, `skills`, `achievements`, `certifications`, `languages`; ids `^[a-z0-9][a-z0-9-]*$` únicos en todo el perfil; `MASTER_PROFILE_SCHEMA_VERSION = 1`. `cv build` lo escribe con `serializeProfile` (JSON a dos espacios, salto final), atómico y `0600`; leerlo vuelve a validarlo siempre.
- **Perfil → fuentes: no existe.** `improve apply` hace cirugía mínima sobre un tramo localizado (no regenera nada) y `PUT /sources/{path}` escribe el contenido que compone el cliente. No hay serializador de frontmatter ni de CSV.
- Ya existe `GET /api/v1/profile`, que sirve el **artefacto** (`data/dist/profile.json`) revalidado; no sustituye a `export`, que debe salir de las fuentes.

## 3. Principios de diseño

1. **Un solo esquema.** Exportar e importar hablan `MasterProfile` tal cual: cualquier `profile.json` válido se importa y cualquier exportación es un `profile.json` válido. Sin envoltorio, sin campos nuevos: `meta.schemaVersion` ya versiona el formato.
2. **La inversa se demuestra, no se supone** (C12, C13). Propiedad de ida y vuelta, verificada en pruebas y en cada importación real: `build(import(P)) ≡ P` (igualdad semántica, §4.4) y regeneración idempotente byte a byte: `import(export(import(P)))` produce exactamente los mismos ficheros que `import(P)`.
3. **Escribir fuentes es del usuario** (C9). Nunca sobre lo que ya existe sin `--replace`; siempre con copia completa; nunca desde la IA; plan visible antes (`--dry-run`, `dryRun` en la API).
4. **Determinismo.** Mismo perfil, mismos bytes: orden de claves fijo, comillas solo cuando YAML o CSV las exigen, `\n`, salto final, sin marcas de tiempo generadas.
5. **Fuentes regeneradas indistinguibles de las escritas a mano.** Los ficheros que produce `import` siguen `docs/formato-dataset.md` al pie de la letra (las plantillas de `cv init` son el modelo): ids explícitos solo cuando el parser no los derivaría igual, sin ruido.
6. **Núcleo agnóstico** (C14): toda la lógica en `src/app/portability.ts` y en serializadores puros; la CLI y la API solo formatean y transportan.

## 4. Diseño

### 4.1 El formato de intercambio

El `MasterProfile` en JSON, a dos espacios, claves en el orden del esquema, salto de línea final: **byte a byte lo mismo** que `data/dist/profile.json` cuando el artefacto está al día (misma función `serializeProfile`). Al importar se admite cualquier JSON que valide con el esquema estricto (espacios, orden de claves y codificación UTF-8 con o sin BOM son irrelevantes); `meta.schemaVersion` distinto de 1 es un error («versión de esquema no admitida: 2; esta versión de cv entiende la 1»).

### 4.2 `cv export`

`cv export [--data <dir>] [-o, --output <fichero>]`

- Carga y valida las fuentes exactamente como `cv validate` (mismo cargador, mismos errores, todos a la vez, mismos avisos por `stderr`); si hay errores, salida 1 y nada escrito.
- Sin `--output`, imprime el JSON por la salida estándar (`cv export > perfil.json`, `cv export | jq`); con `--output`, escribe el fichero de forma atómica y con modo `0600` (reutiliza el escritor del artefacto) e informa por `stdout` («Perfil exportado en …»).
- No necesita `cv build` previo ni toca `data/dist/`.

### 4.3 `cv import`

`cv import <fichero.json | -> [--data <dir>] [--replace] [--dry-run]`

Pasos, en este orden, y **ninguna escritura hasta el último**:

1. **Leer** el JSON (fichero o entrada estándar con `-`). JSON inválido → error con la posición.
2. **Validar** con el esquema estricto del perfil (zod, mensajes en castellano): todos los errores a la vez, con la ruta JSON (`experience[2].dates.start: …`), la unicidad de ids y `schemaVersion`.
3. **Planificar**: el conjunto de ficheros a escribir (ruta relativa al directorio de fuentes y contenido), según §4.4.
4. **Auto-chequeo** (§4.5): analizar el plan con el parser real y comparar el perfil resultante con el importado; cualquier diferencia → error con las rutas que difieren, sin escribir.
5. **Comprobar el destino** (`--data`, por defecto `data/sources`): si no existe o está vacío, se escribe; si tiene contenido y no hay `--replace`, error («`data/sources` no está vacío: use `--replace` para sustituirlo con copia de seguridad, o `--data` con otro directorio»); con `--replace`, el directorio existente se **renombra entero** a `data/sources.<AAAAMMDD-HHMMSS>.bak` (atómico en el mismo sistema de ficheros; nunca se borra) antes de escribir. Un destino que sea un enlace simbólico se rechaza, como en el resto de escritores.
6. **Escribir** cada fichero de forma atómica (temporal + `rename`) con modo `0600` y directorios `0700`, reutilizando `writeSource`; si una escritura falla, se informa de lo escrito y la copia queda intacta.
7. **Resumen** por `stdout`: ficheros escritos y conteos por sección («8 ficheros: 1 perfil, 2 especialidades, 3 experiencias, 1 proyecto, 1 formación, 12 habilidades, 2 certificaciones, 4 logros transversales»), la ruta de la copia si la hubo, y el recordatorio «ejecute `cv build` para regenerar el artefacto» (importar no compila: una responsabilidad por orden).

`--dry-run` ejecuta 1–5 y muestra el plan (ficheros y tamaños, conteos, avisos, resultado del auto-chequeo) sin escribir; salida 0 si todo es válido.

**Avisos** (no errores): el orden de las entidades cambia (§4.4, ids); campos vacíos que se omiten; `personal` con datos de contacto (recordatorio de que las fuentes quedan en claro con `0600`, igual que las escritas a mano).

### 4.4 Serialización: perfil → fuentes

Regla general: la disposición y las claves de `docs/formato-dataset.md` §8.1, **claves en el orden de esa tabla**, los opcionales ausentes no se escriben, las listas vacías tampoco (el parser las rellena), y los textos se escriben tal cual.

| Sección del perfil | Fichero | Frontmatter (orden) | Cuerpo |
|---|---|---|---|
| `meta` + `personal` + `languages` | `profile.md` | `schemaVersion`, `locale`, `updatedAt`, `fullName`, `headline`, `email`, `phone`, `location` (mapa `city`/`region`/`country`), `links` (lista de `label`/`url`), `languages` (lista de `name`/`level`) | `personal.summary` |
| `specialties[]` | `specialties/<id>.md` | `title`, `tags` | `summary` |
| `experience[]` | `experience/<nombre>.md` | `id` (solo si difiere de `exp-<nombre>`), `company`, `role`, `location`, `start`, `end`, `tags`, `technologies` | `summary`, línea en blanco, `## Logros` (si hay) |
| `projects[]` | `projects/<nombre>.md` | `id` (solo si difiere de `proj-<nombre>`), `name`, `role`, `url`, `start`, `end`, `tags`, `technologies` | ídem |
| `education[]` | `education/<nombre>.md` | `id` (solo si difiere de `edu-<nombre>`), `institution`, `degree`, `field`, `start`, `end`, `tags` | `summary` |
| `achievements[]` | `achievements.md` | ninguno | viñetas |
| `skills[]` | `skills.csv` | cabecera `name,category,level,years,aliases,tags` (+ `id` solo si algún id no es el posicional `skill-<n>`) | filas en el orden del perfil |
| `certifications[]` | `certifications.csv` | `name,issuer,date,url,tags` (+ `id` en las mismas condiciones) | ídem |

- **Nombres de fichero e ids.** El nombre sale del id: si el id lleva el prefijo por defecto de su sección (`exp-`, `proj-`, `edu-`), el nombre es el id sin prefijo y no se escribe `id:`; si no, el nombre es el id completo y se escribe `id:` explícito. Las especialidades no admiten `id:` (su id es el nombre) y no tienen prefijo. Como `IdSchema` solo admite `[a-z0-9-]`, los nombres son seguros por construcción (sin `..`, sin separadores). Los ids de los logros se escriben como metadato `- id:` solo cuando no coinciden con el que el parser derivaría (`<id-padre>-<n>` / `ach-<n>`).
- **Orden.** El cargador lee cada directorio en el orden de los nombres de fichero (con extensión, comparación por código), así que, tras importar, `experience`, `projects`, `education` y `specialties` quedan en ese orden: el del id sin su prefijo por defecto (`exp-acme` va como `acme.md`; un id sin prefijo, como `beta`, va como `beta.md`, así que `exp-acme` precede a `beta`). Si el perfil importado los traía en otro orden, `import` **avisa** («El orden de experience pasa a ser el de sus ficheros: exp-acme, exp-zeta») y el auto-chequeo compara con esa reordenación. **Colisiones**: si dos ids querrían el mismo fichero (`exp-acme` y `acme`), la entidad posterior recibe el primer sufijo libre (`acme-2.md`) con `id:` explícito. Los logros dentro de cada entidad, `achievements`, `skills`, `certifications`, `links` y `languages` conservan su orden (viñetas y filas son posicionales).
- **Frontmatter.** Se genera con la biblioteca `yaml` ya presente, en esquema *failsafe* (todo escalares de texto): listas de escalares en flujo (`tags: [PHP, symfony]`), listas de objetos en bloque; comillas solo cuando el valor las exige (`:`, `#`, comillas, espacios extremos, aspecto de número o de booleano que el parser *failsafe* leería igual pero que otros lectores no). Un valor con salto de línea se escribe en bloque literal (`|`).
- **Logros.** Una viñeta por logro: `- <texto> #tag1 #tag2` (las etiquetas, si las hay, al final, que es donde el parser las lee), y debajo la sublista de metadatos presentes, en el orden `id`, `impact`, `date`. El texto va en una sola línea (el parser une las líneas de continuación con un espacio, así que un texto con saltos no es reconstruible: el auto-chequeo lo detecta y lo explica). Un texto cuya última palabra empiece por `#` tampoco lo es (se leería como etiqueta): mismo tratamiento.
- **CSV.** Delimitador `,`, comillas RFC 4180 solo cuando el valor contiene `,`, `"` o salto de línea (el esquema no admite `|` en alias ni etiquetas, así que el separador multivalor nunca necesita comillas); multivalor con `|`; salto `\n`; salto final. Delimitador `;` y CSV de Excel se leen pero no se generan.
- **Resumen.** El cuerpo antes de `## Logros` (o todo el cuerpo) es el resumen tal cual, con sus párrafos; sin resumen, el cuerpo queda vacío.

### 4.5 Auto-chequeo: la importación se demuestra a sí misma

Antes de escribir, el plan (las rutas y contenidos que se van a escribir) se vuelve a leer con **el mismo cargador y validador** que usa `cv build`, sobre un sistema de ficheros en memoria (la capa `AppContext.fs` ya sirve a las pruebas) o, si el cargador exigiera disco, sobre un directorio temporal que nunca es el destino. El perfil obtenido se compara con el importado **normalizado** (entidades ordenadas como quedarán, §4.4; listas vacías y opcionales ausentes equivalentes). Cualquier diferencia es un error de importación que enumera las rutas JSON afectadas y el fichero generado responsable; no se escribe nada. Esto convierte la propiedad de ida y vuelta en una **garantía de cada ejecución**, no solo de las pruebas, y protege frente a perfiles escritos a mano o por otras herramientas que el serializador no sepa representar.

### 4.6 La API (C14)

- `GET /api/v1/export` → `200 application/json` con el perfil desde las fuentes (misma serialización); `422 invalid-data` con `lines` cuando las fuentes no validan, como `POST /validate`. No lee el artefacto: `GET /profile` sigue sirviendo el artefacto y no cambia.
- `POST /api/v1/import` · cuerpo `{ profile: <objeto>, replace?: boolean, dryRun?: boolean }` (`dryRun` **por defecto `true`**, como `apply`): `200 { plan: [{ path, bytes }], counts, warnings, written: [...], backup?: string }`; `409 target-not-empty` (con `details.entries` de muestra) cuando el directorio no está vacío y `replace` es `false`; `422 invalid-data` con `lines` (validación o auto-chequeo). Cuerpo acotado como el resto (`profile` de un CV real pesa decenas de KB). `writes: true` en el registro de rutas, y en la referencia generada.

### 4.7 GUI mínima (sprint opcional, decisión 8)

En **Estado**: «Exportar perfil (JSON)» descarga el resultado de `GET /export` como fichero (`perfil-<fecha>.json`, vía blob, sin abrir ninguna URL externa); «Importar perfil…» abre un selector de fichero, pide el plan (`dryRun`), lo muestra (ficheros, conteos, avisos, auto-chequeo) y solo tras confirmar en un diálogo —con «sustituir el directorio actual (copia de seguridad)» como casilla explícita cuando no está vacío— envía `dryRun: false`. Sin editor de JSON, sin *merge*.

## 5. Pruebas y verificación (C12, C13)

- **Unitarias al 100 %** sobre los serializadores (frontmatter con cada tipo de valor problemático —dos puntos, almohadillas, comillas, aspecto de número/fecha/booleano, saltos de línea—, entidades con y sin `id` explícito, logros con y sin etiquetas y metadatos, CSV con comillas y multivalor, listas vacías y opcionales ausentes) y sobre `src/app/portability.ts` (`exportProfile`, `planImport`, `importProfile`: errores de JSON, de esquema con rutas, de versión, destino no vacío, `replace` con copia, `dryRun`, fallo de escritura a medias, aviso de reordenación, auto-chequeo que rechaza el texto con salto o con `#` final).
- **Ida y vuelta** como pruebas de propiedad sobre los datasets reales del repositorio (`templates/dataset`, `tests/acceptance/bench/…`): `build(import(export(S))) ≡ export(S)` y regeneración idempotente byte a byte (`import(export(import(P)))` = `import(P)`); y sobre perfiles sintéticos que cubran cada campo del esquema.
- **Arnés determinista**: escenario `portability` —`export` por `stdout` (golden), `export -o`, `import --dry-run`, `import` a un directorio nuevo y `export --data` de ese directorio (golden idéntico al primero: la ida y vuelta en vivo), `import` sobre fuentes existentes sin `--replace` (salida 1), `import --replace` (copia `.bak` visible en el resumen con la marca normalizada), JSON inválido y esquema inválido (mensajes)—, contra `dist/` y contra el ejecutable en la release (`--binary`).
- **API**: pruebas de rutas (200/409/422, `dryRun` por defecto, `writes`), referencia regenerada. **GUI** (si se aprueba §4.7): pruebas de componente y un paso E2E (exportar → importar el mismo fichero con sustitución → Estado sigue compilando).
- Verificación final de cada sprint con binarios reales, como hasta ahora: typecheck, cobertura 100 %, arnés, `docs:check`; el sprint de release, además, ejecutable SEA y E2E contra él.

## 6. Documentación (C15)

Guía `website/src/guide/portability.md` («Exportar e importar el perfil»: para qué, qué se conserva y qué no, la copia de seguridad, el auto-chequeo, ejemplos con `jq`), referencia de `cv export`/`cv import` y de las dos rutas generadas automáticamente; `docs/formato-dataset.md` gana un §«Fuentes regeneradas por `cv import`» (las convenciones de §4.4 son la especificación del serializador y su prueba); la clarificación de C9 en `docs/llm-integration.md` §3 (junto a la de `improve apply`); CHANGELOG `[1.4.0]`; guía web si hay GUI; README (una línea en la tabla de órdenes).

## 7. Seguridad

- **Rutas**: todo fichero generado nace de un id validado por `IdSchema` dentro de una disposición fija; no hay forma de que un perfil importado escriba fuera de `--data` (ni `..`, ni separadores, ni nombres especiales). Se prueba con ids límite.
- **Escrituras**: solo con destino vacío o `--replace`; copia completa que la herramienta nunca borra; `0600`/`0700`; atómicas; enlaces simbólicos rechazados. Importar no ejecuta nada del perfil (son datos); el YAML generado es *failsafe* y el parser también, sin etiquetas ni anclas.
- **Datos personales**: el export contiene lo que el usuario puso en `profile.md` (correo, teléfono); sale solo a donde él dice (`stdout` o `-o`), sin red. La API lo sirve bajo el token de sesión y las guardas de `Host`/`Origin` de siempre; la GUI lo descarga en local.
- **Sin IA**: T-8.1 no toca proveedores ni consentimiento (C3/C11 no aplican); el modelo de amenazas de `cv serve` no cambia salvo por una ruta más que escribe, con el mismo régimen que `PUT /sources` y `apply`.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Perfiles que el formato de fuentes no puede representar (texto de logro con saltos o acabado en `#…`, campos que solo existen en el esquema) | El auto-chequeo lo detecta antes de escribir y dice qué; las pruebas de propiedad sobre el esquema completo buscan huecos en el sprint 1, no en producción. |
| Sutilezas de YAML (*failsafe* frente a otros lectores: `2021-03`, `yes`, `010`) | Comillas conservadoras (§4.4) y prueba de ida y vuelta por cada valor problemático. |
| Reordenación silenciosa de entidades | Aviso explícito y comparación consciente en el auto-chequeo; documentado en la guía. |
| Pérdida de formato/comentarios de las fuentes al sustituir | Solo con `--replace`, siempre con copia completa, y documentado: importar regenera, no edita. |
| Crecimiento del alcance (JSON Resume, *merge*, PDF) | Fuera por diseño (§1); cada uno es una tarea con su propuesta. |

## 9. Plan de ejecución

- **S1 · Núcleo (1.4.0-dev)**: `src/parsers/markdown/serialize.ts` (frontmatter, entidades, logros, `profile.md`), `src/parsers/csv/serialize.ts`, `src/app/portability.ts` (`exportProfile`, `planImport` con auto-chequeo, `importProfile` con copia y escritura), pruebas unitarias al 100 % y de ida y vuelta sobre los datasets reales. Informe y aprobación.
- **S2 · CLI y API**: `cv export`, `cv import` (clientes delgados), rutas `GET /export` y `POST /import`, escenario `portability` del arnés (también contra el ejecutable), referencia regenerada, clarificación de C9. Informe y aprobación.
- **S3 · Entrega**: guía, `formato-dataset.md`, GUI mínima (si se aprueba), CHANGELOG `[1.4.0]`, versión 1.4.0, verificación completa y solicitud de la orden de etiquetado.

## 10. Decisiones que se piden al Director

1. **Formato**: el `MasterProfile` JSON (`schemaVersion` 1), sin envoltorio ni campos añadidos; JSON Resume u otros, fuera (tarea aparte si se pide). *Recomendado.*
2. **`cv export`** lee las fuentes (no el artefacto); `stdout` por defecto y `-o` para fichero (`0600`). *Recomendado.*
3. **`cv import`** solo sobre destino vacío o inexistente; `--replace` sustituye con copia completa `data/sources.<marca>.bak/` (nunca borrada por la herramienta); `--dry-run` enseña el plan. Sin *merge*. *Recomendado.*
4. **Auto-chequeo obligatorio** en cada importación: re-análisis con el parser real y comparación; a la primera diferencia, no se escribe nada. *Recomendado.*
5. **Fuentes regeneradas canónicas**: importar no conserva el formato ni los comentarios de las fuentes anteriores (no es edición); las plantillas de `cv init` son el modelo. *Recomendado.*
6. **Ids y orden**: ids exactos (explícitos solo cuando el parser no los derivaría igual), nombre de fichero = id sin prefijo por defecto, orden alfabético por id con aviso cuando cambie. *Recomendado.*
7. **API**: `GET /export` y `POST /import` (`dryRun` por defecto, `409 target-not-empty`), en el mismo sprint que la CLI (C14). *Recomendado.*
8. **GUI mínima** en Estado (exportar como descarga; importar con plan y confirmación) en S3 — o aplazarla a la pantalla «Ajustes» de T-8.2. *Recomiendo incluirla: es pequeña y evita que la GUI quede por detrás de la CLI.*
9. **C9**: `cv import` es la segunda orden que escribe fuentes, bajo el mismo régimen que `improve apply` (acción explícita del usuario, sin IA, con copia); se registra la clarificación en `docs/llm-integration.md` §3. *Recomendado.*
10. **Versión 1.4.0** al cerrar S3; `cv import` queda reservado al formato estructurado (un PDF, tras el Go de T-8.4, entraría como `--from pdf`). *Recomendado.*

## 11. Estado de la implementación

- 2026-08-30: PROPUESTA v1 redactada y enviada al Director de Ingeniería y Producto; **APROBADA en su totalidad** el mismo día (10/10 decisiones), con luz verde para S1.
- **S1 · Núcleo (2026-08-30)**: entregado. `src/parsers/markdown/serialize.ts` (frontmatter con la biblioteca `yaml` en *failsafe* y listas de escalares en flujo sin relleno; `id:` solo cuando no se deriva del nombre; `assignFileNames` con resolución de colisiones por sufijo; viñetas de logros con `#etiquetas` finales y metadatos `id`/`impact`/`date`; `achievementProblem` para los textos irrepresentables), `src/parsers/csv/serialize.ts` (RFC 4180, `|`, columna `id` solo si algún id no es posicional), `src/parsers/dataset/memory-file-system.ts` (`MemorySourceTree`, `FileSystem` de solo lectura en memoria para el auto-chequeo) y `src/app/portability.ts` (`exportProfile`, `parseProfileJson`, `canonicalOrder` con el mismo orden que el cargador, `planFiles`, `diffPaths`, `planImport` con validación estricta, representabilidad, avisos de reorden y contacto y **auto-chequeo por el cargador real**, `backupDirectory`, `importProfile` con destino vacío/`replace`/`dryRun`, rechazo de enlaces simbólicos, copia `<data>.<marca>.bak[.n]` y escritura atómica `0600` vía `writeSource`). Pruebas: 31 nuevas (cada serializador con la ida y vuelta por el parser real; el árbol en memoria; `portability.ts` en todos sus caminos) y **la propiedad de ida y vuelta sobre los datasets reales** (`templates/dataset` y el banco del arnés): `export(import(export(S)))` byte a byte igual a `export(S)` y regeneración idempotente. Raíz al 100 % de cobertura (735 pruebas); arnés determinista 78/78 sin cambios. Tres precisiones de §4.4 salidas al implementar: el orden canónico es el del cargador (nombre con extensión), las colisiones de nombre se resuelven con sufijo, y el CSV no necesita entrecomillar `|`.
- **S2 · CLI y API (2026-08-30)**: entregado. `cv export [-d] [-o]` y `cv import <fichero|-> [-d] [--replace] [--dry-run]` como clientes delgados (`src/cli/commands/portability.ts`: leen el JSON, imprimen el plan —ficheros con su tamaño, conteos, auto-chequeo— o el resumen con la copia y el recordatorio de `cv build`, y los avisos por `stderr`; los errores con líneas terminan con una línea resumen, como `validate`). Rutas `GET /api/v1/export` (perfil desde las fuentes; 422 con líneas) y `POST /api/v1/import` (`{ profile, replace?, dryRun? }`, `dryRun` por defecto `true`; 200 con `{ root, dryRun, plan: { files[{path,bytes}], counts, warnings }, written, backup? }`; **409 `conflict`** con el destino ocupado —el contrato usa los códigos cerrados compartidos con la CLI, así que no se añade `target-not-empty`—; 422 con el perfil inválido o irrepresentable; 400 con un cuerpo que no cumple el esquema). Referencia de comandos y de la API regenerada (24 comandos, 29 rutas) con ejemplos en `website/examples/`. Clarificación de C9 registrada en `docs/llm-integration.md` §3. **Arnés determinista**: escenario `portability` (13 pasos: `export` por `stdout` y a fichero; `import --dry-run`; `import` a un directorio nuevo y **`export` de ese directorio byte a byte idéntico al original** —la ida y vuelta en vivo—; `build` del directorio importado; destino ocupado; `--replace` con la copia normalizada como `<STAMP>` (el arnés admite ahora reemplazos por expresión regular); perfil reordenado por `stdin` con sus avisos; JSON inválido, esquema inválido con siete problemas, logro irrepresentable y fichero inexistente) y cuatro llamadas nuevas en el escenario `serve` (`GET /export`, `POST /import` 409/422/400): 10 escenarios · 91 pasos. Pruebas: CLI (7), rutas (3), `portability.ts` ampliado; raíz al 100 % (744 pruebas).
- **S3 · Entrega (2026-08-30)**: entregado; **T-8.1 cerrada**. Guía «Exportar e importar el perfil» (`website/src/guide/portability.md`, en la barra lateral), §15 «Fuentes regeneradas por `cv import`» en `docs/formato-dataset.md`, filas de `export` e `import` en el README, mención en la guía de la interfaz web. **GUI mínima** (decisión 8): en Estado, tarjeta «Portabilidad» con **Exportar perfil (JSON)** (descarga `perfil-AAAA-MM-DD.json` con la misma serialización que `cv export`) e **Importar perfil…** (selector de fichero → diálogo con el nombre, casilla «sustituir las fuentes actuales» → **Ver plan** (`dryRun`; el 409 y los 422 se muestran dentro del diálogo) → **Escribir en las fuentes** → resumen con la copia y el recordatorio de compilar); lógica pura en `gui/src/lib/portability.ts` (100 %), cliente con `exportProfile`/`importProfile`, 3 pruebas de componente y el E2E «Estado exporta el perfil como descarga y lo importa sustituyendo las fuentes con copia; después compila» (comprueba la descarga, el `.bak` en disco y la compilación posterior): **9/9**. Bundle inicial 27,0 KB gzip (presupuesto 30). CHANGELOG `[1.4.0]`; versión 1.4.0 en `package.json`, `compose.yml`, README, guías y goldens; capturas regeneradas. Verificación: raíz (typecheck, cobertura 100 % con 744 pruebas, arnés 10 escenarios · 91 pasos), GUI (svelte-check, pruebas al 100 % de `lib`, E2E 9/9), portal (`docs:build`), ejecutable SEA 1.4.0 con E2E contra él.
