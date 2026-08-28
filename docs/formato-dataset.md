# Formato del dataset de Chameleon CV (Markdown)

| | |
|---|---|
| **Tarea** | T-1.2 · [PARSER] Parser para Markdown |
| **Estado** | **PROPUESTA v1 — pendiente de aprobación del Director de Ingeniería** |
| **Fecha** | 2026-08-28 |
| **Autor** | Claude (Director Técnico) |
| **Decide** | Cómo se escriben los datos fuente en Markdown y cómo se mapean a `MasterProfile` (`src/core/schema/`). |

## 1. Objetivo y alcance

Definir el **contrato de entrada** del sistema antes de implementar su consumidor: qué ficheros forman un *dataset*, qué contiene cada uno y con qué reglas se convierten en un `MasterProfile` válido.

Dentro del alcance: estructura de directorios, anatomía de los ficheros `.md`, sintaxis de los logros, reglas de mapeo, validación, errores y seguridad. Fuera del alcance (se cita solo lo necesario para que encaje): las columnas de `skills.csv` (T-1.3), la selección por especialidad (T-1.4/T-1.5) y el soporte multi-idioma avanzado (§11).

## 2. Principios de diseño

1. **Markdown natural.** Los textos que de verdad importan en un CV (resumen, logros) se escriben como prosa y viñetas Markdown, no como YAML ni JSON.
2. **Una entidad = un fichero.** Cada experiencia, proyecto, formación, certificación o especialidad es un `.md` propio. Escala, se navega bien en cualquier editor y el *diff* de git es legible.
3. **Frontmatter = datos; cuerpo = texto.** Lo estructurado (fechas, tags, tecnologías) va en el frontmatter YAML; lo narrativo, en el cuerpo. No hay metadatos incrustados en la prosa salvo los `#hashtags` de los logros.
4. **Mismo vocabulario que el esquema.** Las claves del frontmatter son los nombres de campo de `MasterProfile` (`company`, `role`, `tags`…). Solo hay tres azúcares sintácticos, enumerados en §8. Un único vocabulario en datos, código, errores y documentación.
5. **Estricto por defecto.** Clave, sección, fichero o directorio desconocidos = error con fichero y línea. Un `compnay:` no se ignora en silencio.
6. **Todos los errores de una vez**, con formato `ruta/fichero.md:línea: mensaje`.
7. **Seguro y local.** Solo se leen ficheros del dataset, con límites de tamaño, YAML sin tipado automático ni alias, y el saneado del esquema como última barrera.

## 3. Estructura del dataset

`--data <ruta>` apunta a un directorio con esta forma:

```
data/
├── profile.md            # obligatorio · meta + datos personales + idiomas + resumen por defecto
├── specialties/          # una especialidad por fichero · el nombre del fichero es su id
│   ├── backend.md
│   └── engineering-manager.md
├── experience/           # una experiencia por fichero
│   ├── life5.md
│   └── acme.md
├── projects/             # un proyecto por fichero
├── education/            # una formación por fichero
├── certifications/       # una certificación por fichero
├── achievements.md       # logros transversales (lista de viñetas, misma sintaxis que «## Logros»)
├── skills.csv            # skills (T-1.3)
└── README.md             # ignorado
```

| Ruta | Sección de `MasterProfile` | Id por defecto | Obligatorio |
|---|---|---|---|
| `profile.md` | `meta`, `personal`, `languages` | — | sí |
| `specialties/<id>.md` | `specialties[]` | `<nombre de fichero>` (sin prefijo: es el valor de `--specialty`) | no |
| `experience/<nombre>.md` | `experience[]` | `exp-<nombre de fichero>` | no |
| `projects/<nombre>.md` | `projects[]` | `proj-<nombre de fichero>` | no |
| `education/<nombre>.md` | `education[]` | `edu-<nombre de fichero>` | no |
| `certifications/<nombre>.md` | `certifications[]` | `cert-<nombre de fichero>` | no |
| `achievements.md` | `achievements[]` | `ach-<posición>` | no |
| `skills.csv` | `skills[]` | (T-1.3) | no |

Reglas del recorrido:

- El nombre de los ficheros de entidad debe cumplir el patrón de identificador (`^[a-z0-9][a-z0-9-]*\.md$`), porque de él sale el `id`. Si no, error con sugerencia de renombrado.
- Los ficheros se procesan en **orden alfabético** dentro de cada directorio (orden de documento determinista: de él dependen las rutas de error y los ids posicionales). El orden cronológico lo decide el generador a partir de las fechas.
- Se **ignoran**: ficheros y directorios ocultos (`.git`, `.obsidian`…), `README.md` en la raíz y los ficheros que no sean `.md` dentro de los directorios de entidades (p. ej. imágenes).
- Es **error**: cualquier otro `.md`, `.csv` o directorio en la raíz (`experiencia/` es un error, no un olvido silencioso) y cualquier subdirectorio dentro de un directorio de entidades.
- Varios idiomas o variantes = varios datasets (`data/es/`, `data/en/`); véase §11.

## 4. Anatomía de un fichero de entidad

```markdown
---
company: ACME Corp                      # obligatorio
role: Senior Backend Engineer           # obligatorio
location: Madrid (remoto)
start: 2021-03                          # obligatorio · YYYY | YYYY-MM | YYYY-MM-DD
end: 2024-06                            # ausente o vacío = en curso
tags: [php, symfony, kubernetes]        # lista YAML; se normalizan a minúsculas
technologies: [PHP 8.3, Symfony 6.4, Kubernetes]
# id: exp-acme                          # opcional · por defecto exp-<nombre de fichero>
---

Plataforma de pagos con 2 M de transacciones/mes. Este texto es el `summary`:
Markdown libre, uno o varios párrafos, **negritas**, enlaces y listas.

## Logros

- Reduje la latencia p95 del checkout un **40 %** rediseñando la capa de caché. #performance #php
  - impact: -40 % p95
  - date: 2023-05
- Lideré la migración a Kubernetes sin ventana de parada. #kubernetes #devops #liderazgo
  - id: exp-acme-k8s
- Introduje contract testing entre el monolito y 4 microservicios. #testing #arquitectura
```

Reglas del cuerpo:

- El texto **antes del primer encabezado** es el `summary` (opcional). Se conserva el Markdown tal cual (los generadores emiten Markdown).
- Solo se reconoce una sección: `## Logros` (alias `## Achievements`). Contiene **una única lista** de viñetas. Cualquier otro encabezado, o texto suelto dentro de la sección, es un error.
- `experience` y `projects` admiten `## Logros`; `education` y `certifications` no (el esquema no lo contempla). El cuerpo de `certifications` debe estar vacío.

## 5. `profile.md`

```markdown
---
schemaVersion: 1                        # opcional · por defecto 1
locale: es-ES                           # opcional · idioma del contenido
updatedAt: 2026-08-28                   # opcional
fullName: Ada Ejemplo                   # obligatorio
headline: Ingeniera de software         # titular por defecto (la especialidad puede sobrescribirlo)
email: ada@example.com
phone: +34 600 000 000
location:
  city: Madrid
  region: Comunidad de Madrid
  country: España
links:
  - label: GitHub
    url: https://github.com/ada-ejemplo
  - label: LinkedIn
    url: https://www.linkedin.com/in/ada-ejemplo
languages:
  - { name: Español, level: native }
  - { name: Inglés, level: C1 }
---

Resumen profesional por defecto, en Markdown. La especialidad puede sobrescribirlo.
```

Mapeo: `schemaVersion`, `locale` y `updatedAt` → `meta`; `languages` → `languages`; el resto → `personal`; el cuerpo → `personal.summary`. No se admiten encabezados en el cuerpo.

## 6. `specialties/<id>.md`

```markdown
---
title: Senior Backend Engineer          # obligatorio · titular del CV para esta especialidad
tags: [php, symfony, kubernetes, kafka, ddd]   # vocabulario de relevancia
---

Resumen específico para esta especialidad (opcional). Sustituye al de `profile.md`.
```

El `id` es el nombre del fichero (`backend.md` → `backend`) y es el valor que recibirá `--specialty`. No se admite `id:` en el frontmatter para evitar dos nombres para la misma cosa.

## 7. Logros: sintaxis de las viñetas

La misma sintaxis vale dentro de `## Logros` y en `achievements.md` (que solo contiene la lista, sin frontmatter ni resumen).

```markdown
- Texto del logro en Markdown en línea. #etiqueta-1 #etiqueta-2
  - impact: métrica o impacto cuantificado
  - date: 2023-05
  - id: identificador-explicito
```

| Elemento | Regla |
|---|---|
| Texto | El primer (y único) párrafo de la viñeta → `text`. Se conserva el Markdown en línea. Máximo 600 caracteres (esquema). |
| Etiquetas | `#hashtags` **al final** del párrafo, separados por espacios → `tags`. Se retiran del texto. Un `#` en medio del texto, en código o en una URL no es una etiqueta. |
| Metadatos | Sub-lista de `clave: valor`. Claves admitidas: `impact`, `date`, `id`. Clave desconocida = error. El valor es el resto de la línea. |
| Id por defecto | `<id del padre>-<n>` (`exp-acme-1`, `exp-acme-2`…) o `ach-<n>` en `achievements.md`, con `n` = posición 1-based en la lista. `id:` explícito lo sustituye. |
| Errores | Viñeta sin texto, más de un párrafo, sub-lista con formato distinto de `clave: valor`, o sub-sub-listas. |

Los ids posicionales cambian si se reordena la lista; es aceptable porque nada los referencia todavía (la selección y el scoring usan tags) y para los casos que lo necesiten existe `id:` explícito.

## 8. Reglas de mapeo Markdown → `MasterProfile`

### 8.1 Claves de frontmatter por tipo

| Tipo | Obligatorias | Opcionales |
|---|---|---|
| `profile.md` | `fullName` | `schemaVersion`, `locale`, `updatedAt`, `headline`, `email`, `phone`, `location{city,region,country}`, `links[{label,url}]`, `languages[{name,level}]` |
| `specialties/` | `title` | `tags` |
| `experience/` | `company`, `role`, `start` | `end`, `location`, `tags`, `technologies`, `id` |
| `projects/` | `name` | `role`, `url`, `start`, `end`, `tags`, `technologies`, `id` |
| `education/` | `institution`, `degree` | `field`, `start`, `end`, `tags`, `id` |
| `certifications/` | `name` | `issuer`, `date`, `url`, `tags`, `id` |

### 8.2 Azúcar sintáctico (las únicas tres diferencias con el esquema)

1. **`start` / `end` planos** en el frontmatter → `dates: { start, end }`. `end` sin `start` es un error.
2. **`id` opcional**, derivado del nombre del fichero con el prefijo del tipo (§3). Los logros: posicional (§7).
3. **`summary` y `achievements` salen del cuerpo**, nunca del frontmatter (`summary:` en el frontmatter es un error con la pista «usa el cuerpo del fichero»).

### 8.3 Tipado del YAML

- El frontmatter se lee con el esquema YAML **failsafe**: todo escalar es texto; no existe el tipado automático. Así `start: 2021` es `"2021"` y `phone: 600000000` es `"600000000"`, sin comillas y sin sorpresas (con el esquema YAML por defecto, `2021` sería un número y `2021-03-15` una fecha).
- Únicas coerciones: `schemaVersion` (y `years` en el CSV) se convierten a entero.
- Un valor vacío (`end:`) equivale a omitir la clave.
- Las listas se escriben como listas YAML (`[a, b]` o con guiones). `tags: php, symfony` es un error con la pista «usa [php, symfony]».
- Claves desconocidas = error (coherente con los objetos estrictos del esquema).

### 8.4 Texto

- Codificación UTF-8 (BOM tolerado); `\r\n` se normaliza a `\n`.
- `summary` y `text` se toman del **código fuente** Markdown (por posiciones del AST), no de una versión renderizada: nada se pierde ni se reescribe.

## 9. Validación y errores

Dos niveles, y siempre se reportan **todos** los problemas:

1. **Por fichero.** Frontmatter + cuerpo se validan con el esquema zod del tipo correspondiente (`ExperienceSchema`…). Cada error lleva `fichero:línea` — la línea de la clave del frontmatter o de la viñeta del logro — y el mensaje del esquema, ya en castellano.
2. **Global.** El `MasterProfile` ensamblado pasa por `validateMasterProfile` (unicidad de ids, etc.). El cargador traduce las rutas del esquema (`experience[3].id`) al fichero que las produjo.

Formato: `experience/acme.md:6: La fecha de fin no puede ser anterior a la de inicio (end)`.
Los mensajes **no reproducen el contenido** del fichero (solo ruta, línea y clave): minimización de datos personales en logs y terminal.

## 10. Seguridad

- Solo se leen ficheros con extensión `.md`/`.csv` situados bajo la raíz del dataset **tras resolver enlaces simbólicos**; un enlace que apunte fuera es un error.
- Límites: 1 MiB por fichero, 64 KiB de frontmatter, 500 ficheros por dataset.
- YAML failsafe: sin tipado implícito, sin etiquetas personalizadas, sin anchors/alias (`maxAliasCount: 0`); cero ejecución de código.
- El esquema es la última barrera: caracteres de control, longitudes, esquemas de URL (`javascript:` rechazado), etc.
- Sin red, sin telemetría. Recomendación operativa: `data/` contendrá datos personales reales; el repo no tiene remoto, y si algún día lo tuviera, `data/` debería excluirse o cifrarse.

## 11. Fuera de alcance y evolución prevista

- **Idiomas.** MVP: un dataset por idioma (`data/es/`, `data/en/`), sin cambios en el esquema. Evolución: ficheros de *overlay* `experience/acme.en.md` que sobrescriban solo los campos de texto; la extensión `.<locale>.md` queda **reservada** desde ahora (hoy es un error).
- **Herencia de tags.** Si un logro sin tags debe heredar las de su experiencia a efectos de selección es una regla de selección, no de formato; se decidirá en T-1.4/T-1.5.
- **Skills.** Solo por CSV en el MVP (T-1.3). La arquitectura admite `skills/*.md` si algún día se necesita texto por skill.
- **Comando `validate`.** El cargador dejará listo un `chameleon validate --data <ruta>` casi gratis; se propondrá en T-1.5.

## 12. Decisiones técnicas para la implementación

| Decisión | Elección | Motivo |
|---|---|---|
| Parser Markdown | `unified` 11 + `remark-parse` 11 + `remark-frontmatter` 5 (mdast) | AST estándar con posiciones de línea (errores precisos), listas anidadas bien resueltas, ecosistema para futuros generadores. `marked` no aporta posiciones; `markdown-it` da posiciones pero con *tokens* planos, más trabajo para las sub-listas. |
| YAML | `yaml` 2.9 (schema `failsafe`, `maxAliasCount: 0`) | YAML 1.2, sin tipado implícito, rangos de nodos para dar la línea de cada clave. `gray-matter`/`js-yaml` tipan automáticamente fechas y números. |
| ESM desde CommonJS | `require(esm)` nativo de Node (≥ 22.12) | Spike verificado el 2026-08-28: `tsc` (NodeNext) compila y `ts-node` ejecuta `unified`/`remark` en Node 26 sin avisos. Implica declarar `engines.node >= 22.12`. |
| Módulos | `src/parsers/markdown/` (frontmatter, documento, logros, entidades) + `src/parsers/dataset/` (recorrido y ensamblado) | Parsers **puros sobre cadenas** (100 % cubribles sin disco); el sistema de ficheros se inyecta (`FileSystem` mínimo) y en tests se sustituye por uno en memoria. |
| Resultado | `loadDataset(ruta) → { ok, profile } \| { ok: false, errors: DatasetError[] }` con `DatasetError { file, line?, message }` | Mismo patrón `Result` que `validateMasterProfile`; el CLI decide cómo imprimir. |
| Tests | Unitarios por módulo + dataset sintético de fixtures (`tests/fixtures/dataset/`) que es, a la vez, el ejemplo canónico de este documento | Cobertura 100 % en `src/core/**` y `src/parsers/**` (el umbral se ampliará en `vitest.config.mts`). |

## 13. Alternativas consideradas

| Alternativa | Por qué se descarta |
|---|---|
| Un único `cv.md` con todo en secciones `##`/`###` | Codificar ids, fechas y tags en encabezados o viñetas es frágil y poco legible; los ficheros crecen mal; el *diff* mezcla todo. |
| Datos íntegros en YAML/JSON | Escribir logros y resúmenes en YAML es hostil; el Markdown es el formato natural del autor (el dosier existente ya es Markdown). |
| Claves en castellano (`empresa`, `puesto`) | Dos vocabularios (datos vs esquema/código/errores) y una capa de traducción que mantener. Se puede añadir como alias más adelante si se echa en falta. |
| Ids de logro por *slug* del texto | Cambian al reescribir el texto (lo más habitual al afinar un CV) y colisionan entre viñetas parecidas. Los posicionales son deterministas y explicables. |
| `dates: {start, end}` anidado en el frontmatter | Fidelidad total al esquema a cambio de ergonomía en el campo que más se escribe. `start`/`end` planos ganan. |
| Parser propio línea a línea | Los casos límite de Markdown (continuaciones, listas anidadas, `#` en código o URLs) reinventarían un parser real, peor. |

## 14. Puntos que requieren decisión del Director

Recomendación: **aprobar la propuesta tal cual**. Los puntos donde una opinión distinta cambiaría la implementación:

1. Claves de frontmatter en **inglés** (= nombres del esquema) frente a castellano.
2. Ids de logro **posicionales** (`exp-acme-3`) con `id:` explícito opcional.
3. **Una entidad por fichero** también para `education/` y `certifications/` (uniformidad) frente a una lista única.
4. **Un dataset por idioma** en el MVP, con la extensión `.<locale>.md` reservada para overlays futuros.
5. Política **estricta** en la raíz del dataset (solo `README.md` se ignora; lo demás desconocido es error).
6. Adoptar `remark`/`unified` (ESM) mediante `require(esm)` y fijar `engines.node >= 22.12`.

Con la aprobación (o las modificaciones que indique) se actualiza este documento a estado **APROBADO** y arranca la implementación de T-1.2.
