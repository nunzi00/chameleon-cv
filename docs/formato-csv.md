# Formato de las fuentes CSV de Chameleon CV

| | |
|---|---|
| **Tarea** | T-1.3 · [PARSER] Parser para CSV |
| **Estado** | **APROBADO** por el Director de Ingeniería el 2026-08-28 (v1, sin modificaciones). Especificación canónica de las fuentes CSV; T-1.3 implementada en `src/parsers/csv/`. |
| **Autor** | Claude (Director Técnico) |
| **Decide** | Columnas, delimitadores y reglas de `skills.csv` y `certifications.csv`, y su mapeo a `MasterProfile`. Complementa `docs/formato-dataset.md`. |
| **Decisión §1** | Certificaciones en `certifications.csv` (aprobada). |

## 1. Certificaciones en CSV (decidido)

| Criterio | `certifications.csv` (recomendado) | `certifications/*.md` |
|---|---|---|
| Naturaleza del dato | Tabular: nombre, emisor, fecha, URL, tags. Sin prosa (`Certification` no tiene `summary`). | Igual de tabular, pero repartido en N ficheros con frontmatter y **cuerpo obligatoriamente vacío**. |
| Coste de edición | Una fila por certificación; 20 certificaciones = 21 líneas. | 20 ficheros. |
| Coherencia | Con el análisis estratégico («CSV para lo tabular») y con `skills.csv`: un solo parser tabular. | Con «una entidad por fichero» de las entidades narrativas. |
| Coste de implementación | El parser CSV ya tiene que existir para skills; certificaciones = una tabla de columnas más. | Una fila más en la tabla de entidades Markdown. |

Decisión del Director de Ingeniería (2026-08-28): **CSV**. La regla «una entidad por fichero» gana en las entidades narrativas porque tienen prosa y logros; las certificaciones no tienen ninguna de las dos cosas.

## 2. Reglas comunes a todos los CSV

1. **Cabecera obligatoria** en la primera línea, con los **nombres de campo del esquema** (mismo vocabulario que el Markdown). Orden de columnas libre. Solo `name` es obligatoria; las demás pueden omitirse. Columna desconocida o repetida = error.
2. **Delimitador**: coma (RFC 4180). Si la cabecera contiene `;` y ninguna `,` (exportación de Excel/LibreOffice en es-ES), el delimitador es `;` para todo el fichero.
3. **Comillas** RFC 4180: campo entre comillas dobles cuando contiene el delimitador, comillas o saltos de línea; `""` escapa una comilla.
4. **Valores múltiples** (`aliases`, `tags`) separados por `|` dentro de la celda: `kubernetes|devops`. Se recortan espacios y se descartan los vacíos.
5. **Celda vacía = clave omitida** (misma regla que el frontmatter). Se recortan espacios en todas las celdas.
6. **Líneas vacías** se ignoran. Una fila con más o menos campos que la cabecera es error. Un fichero con solo cabecera es válido y aporta una lista vacía.
7. **Tipado**: todo es texto salvo lo que el esquema declara numérico (`years` → entero si la celda es un número; si no, error del esquema).
8. **Errores** con `fichero:línea` (la línea física donde empieza la fila) y el nombre de la columna: `skills.csv:4: years: …`. Todos a la vez.
9. **Ids posicionales**: `skill-<n>` / `cert-<n>` con `n` = número de fila de datos (1-based), salvo columna `id` explícita. Se descarta derivar el id del nombre porque colisiona (`C`, `C++` y `C#` darían el mismo *slug*).
10. Codificación UTF-8 (BOM tolerado) y finales de línea normalizados por el cargador, como en Markdown.

## 3. `skills.csv`

| Columna | Obligatoria | Valor |
|---|---|---|
| `name` | sí | Nombre visible (`Kubernetes`, `PHP 8.3`). |
| `category` | no | `language`, `framework`, `library`, `tool`, `platform`, `database`, `cloud`, `methodology`, `domain`, `soft`, `other` (por defecto `other`). |
| `level` | no | `beginner`, `intermediate`, `advanced`, `expert`. |
| `years` | no | Entero 0–60. |
| `aliases` | no | Sinónimos para el emparejamiento, separados por `\|` (`k8s`). Minúsculas automáticas. |
| `tags` | no | Etiquetas de relevancia, separadas por `\|`. Minúsculas automáticas. |
| `id` | no | Por defecto `skill-<n>`. |

```csv
name,category,level,years,aliases,tags
PHP,language,expert,10,,php|backend
Symfony,framework,expert,8,,symfony|php|backend
Kubernetes,platform,advanced,5,k8s,kubernetes|devops|platform
"C++",language,intermediate,3,cpp,c++
Liderazgo técnico,soft,advanced,,tech lead|team lead,liderazgo
```

## 4. `certifications.csv`

| Columna | Obligatoria | Valor |
|---|---|---|
| `name` | sí | `CKA`, `AWS Solutions Architect`. |
| `issuer` | no | Entidad emisora. |
| `date` | no | Fecha ISO parcial (`2022-05-10`, `2022-05`, `2022`). |
| `url` | no | Solo `http(s)`. |
| `tags` | no | Etiquetas separadas por `\|`. |
| `id` | no | Por defecto `cert-<n>`. |

```csv
name,issuer,date,url,tags
CKA,CNCF,2022-05-10,https://example.com/cert/cka,kubernetes|devops
Symfony Certified Developer,SensioLabs,2021,,symfony|php
```

## 5. Mapeo y validación

- Cada fila → objeto con las claves de la cabecera; celdas vacías fuera; listas divididas por `|`; `years` coercionado; `id` por defecto.
- Validación fila a fila con `SkillSchema` / `CertificationSchema` (los mismos del núcleo) mediante `validateSection`, con localizador fila → línea física. Las normalizaciones (minúsculas en tags y alias, recorte, deduplicado) las hace el esquema, igual que en Markdown.
- Contribución `{ skills: [...] }` o `{ certifications: [...] }` con procedencia `['skills', i]` → línea; la unicidad global de ids la sigue comprobando el cargador.

## 6. Decisiones técnicas

| Decisión | Elección | Motivo |
|---|---|---|
| Librería | `csv-parse` (API síncrona `csv-parse/sync`), como indica el roadmap | RFC 4180 completo (comillas, saltos de línea en celdas), `columns: true`, `info: true` para la línea de cada fila, errores con línea, CJS y ESM. Ficheros pequeños: la API síncrona basta y mantiene el parser puro. |
| Módulo | `src/parsers/csv/` con `CsvParser: SourceParser` (`extensions: ['.csv']`), despacho por ruta (`skills.csv`, `certifications.csv`) | Mismo contrato de plugin que Markdown; el cargador ya despacha por extensión. |
| Tests | Unitarios sobre cadenas (comillas, `;`, `|`, columnas desconocidas, filas cortas, coerciones, errores con línea) + fixtures `skills.csv` y `certifications.csv` en `tests/fixtures/dataset/` | Cobertura 100 % en `src/parsers/csv/**`; el test de integración del dataset pasa a incluir skills y certificaciones. |

## 7. Puntos de decisión (todos aprobados el 2026-08-28)

1. Certificaciones en **CSV** (recomendado) o en Markdown (§1).
2. Delimitador `,` con detección de `;` por cabecera (recomendado) frente a solo `,`.
3. Separador de valores múltiples `|` (recomendado).
4. Ids posicionales `skill-<n>` / `cert-<n>` con columna `id` opcional (recomendado), coherente con los logros.
