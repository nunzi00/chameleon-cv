# Importación desde PDF: spike con evidencia y decisión Go / No-Go

| | |
|---|---|
| **Tarea** | T-8.4 · [I+D] Spike de importación desde PDF (Hito 8) |
| **Estado** | PROPUESTA v1 (2026-08-30), pendiente de aprobación por el Director de Ingeniería y Producto |
| **Autor** | Claude (Director Técnico) |
| **Base** | `docs/pdf-integration.md` (extracción de texto de PDF con `pdfjs-dist` en un worker contenido: 10 MiB, 50 páginas, 1 MiB de texto, 20 s, 512 MiB); `docs/portability.md` (T-8.1: `MasterProfile` JSON como formato de intercambio y `cv import` con plan, auto-chequeo y copia `.bak`); `docs/llm-integration.md` (cánones C1–C15: local por defecto, verificación por código, el usuario escribe sus fuentes); `tests/acceptance/bench/` (perfil sintético con verdad conocida); `src/renderers/` (pdfkit y Typst producen PDF desde ese mismo perfil) |

## 0. Resumen ejecutivo

- **Hoy** el usuario que llega con un CV en PDF empieza de cero: escribe las fuentes a mano (o importa un `MasterProfile` JSON que no tiene). El producto ya sabe **leer texto de un PDF** (ofertas, T-2.5) y ya sabe **escribir fuentes desde un perfil** (`cv import`, T-8.1); lo que no existe es el tramo intermedio: convertir el texto de un CV en un perfil estructurado con la calidad suficiente.
- **Propuesta**: un sprint de **investigación con evidencia**, sin función en el producto hasta la decisión, que mida sobre un corpus **sintético** (sin PII) tres caminos —(P1) estructurador **heurístico** determinista, (P2) estructurador con el **co-piloto local** guiado por el esquema, y (P3) extracción **consciente de la maquetación** (coordenadas de `pdfjs`) como mejora de P1— con métricas por sección (experiencias, fechas, logros, formación, habilidades, contacto), tiempo y memoria, y que termine en un **informe Go / No-Go** con umbrales fijados de antemano y, si es Go, el diseño del producto: `cv import --from-pdf <cv.pdf>` como **borrador revisable** que nunca escribe fuentes sin la orden del usuario (C9, C11).
- Sin versión asociada; un sprint (dos entregas: corpus y métricas + P1; P2, P3 e informe). Nada de red: los modelos, locales (C3).

## 1. Objetivo y alcance

**Objetivo.** Decidir con datos —no con intuición— si merece la pena construir la importación desde PDF y, en su caso, con qué técnica, con qué garantías y con qué límites explícitos para el usuario.

**Dentro**: el corpus sintético y su verdad conocida; el arnés de métricas reproducible; los tres candidatos (P1, P2, P3) implementados como **código de spike fuera del producto** (`scripts/spike/pdf-import/`), con lo justo para medir; el informe de decisión con las tablas de evidencia y los umbrales; el diseño del producto para el caso Go.

**Fuera** (y por qué): OCR de PDF escaneados sin capa de texto (otra investigación; se documenta el límite y se detecta el caso para decirlo claro); PDF de ofertas (ya resuelto en T-2.5); proveedores remotos para el spike (C3: la evidencia se toma con modelos locales; si Go, el producto usará el co-piloto configurado, con su consentimiento de siempre); importar formatos de otras herramientas (LinkedIn, Europass XML…): son tareas propias si algún día se piden; escribir en las fuentes sin revisión (nunca: C9).

## 2. Situación de partida

- **Texto de un PDF**: `src/pdf/extract-text.ts` (`extractPdfText`) devuelve el texto y el número de páginas o un error tipificado (`invalid`, `too-large`, `too-many-pages`, `timeout`, `failed`), ejecutando `pdfjs-dist` en un worker con límites de tamaño, páginas, texto, tiempo y memoria. El orden del texto es el de los *items* de `pdfjs`, sin noción de columnas ni de secciones. La API (`POST /offers/extract`) y la GUI ya lo usan para ofertas.
- **Perfil → fuentes**: `cv import` (T-8.1) toma un `MasterProfile` JSON, planifica los ficheros canónicos, se auto-comprueba (vuelve a cargar lo planeado y compara), muestra el plan (`--dry-run`) y solo escribe con la orden explícita; con `--replace`, copia `.bak`.
- **Perfil → PDF**: `cv generate-cv --format pdf` (pdfkit) y `--engine typst` con cinco temas producen PDF **desde el mismo perfil**: el banco de pruebas nos da, gratis, PDFs con verdad conocida en seis maquetaciones distintas.
- **Co-piloto**: tareas locales con salida JSON verificada por código (`improve`, `summarize`, `suggest tags`), caché, consentimiento para remotos, estimación de coste. No hay ninguna tarea de «estructurar texto libre en un perfil».

## 3. Principios de diseño

1. **Evidencia antes que función** (C12): el spike no entra en `src/`, no añade comandos ni rutas; solo produce números y un informe. Si es Go, la implementación será una tarea nueva con su propia propuesta.
2. **Verdad conocida y sin PII** (T-5.5.1): todo el corpus es sintético y se genera desde fuentes versionadas; las métricas se calculan contra perfiles que conocemos byte a byte.
3. **Local y contenido** (C3): la lectura del PDF pasa por el worker ya endurecido; los modelos son locales; ningún dato sale de la máquina.
4. **El usuario escribe sus fuentes** (C9, C11): cualquier resultado futuro es un **borrador** con procedencia (página y fragmento de origen por campo) y un plan revisable; nunca una escritura automática.
5. **Determinismo primero**: el candidato heurístico es reproducible y verificable al 100 %; el co-piloto se mide como mejora sobre él, no como única vía.

## 4. Diseño del spike

### 4.1 Corpus (`tests/spike/pdf-import/corpus/`, sintético)

| Grupo | Origen | Verdad conocida | Para qué |
|---|---|---|---|
| **A · Propios** | El perfil del banco (`tests/acceptance/bench/workspace`) generado con pdfkit y con los cinco temas de Typst (`default`, `classic`, `modern`, `academic`, `minimal`), CV completo y por especialidad | El propio `MasterProfile` del banco (exacta) | Medir el techo: lo que un PDF **nuestro** debe recuperar; `modern` tiene dos columnas y pastillas, `academic` fechas al margen, `minimal` líneas compactas |
| **B · Ajenos sintéticos** | Cuatro o cinco CV escritos para el spike en otras maquetaciones (dos columnas con iconos, tablas, inglés con `Present`/`Jan 2020`, formato «funcional» por competencias, un CV de una sola página muy denso), maquetados con Typst desde fuentes propias | Sus fuentes (exacta) | Medir la robustez frente a lo que trae la gente |
| **C · Límites** | Un PDF sin capa de texto (imagen), un PDF de 60 páginas, un PDF con texto en orden roto (columnas entrelazadas a propósito) | n/a | Comprobar que el spike detecta y **explica** el caso, sin colgarse ni inventar |

Los PDF del grupo A se regeneran con el propio producto; los del grupo B, con Typst desde plantillas del spike. Todo versionado y reproducible (`npm run spike:pdf-import -- corpus`).

### 4.2 Candidatos

- **P0 · Texto** (base común): `extractPdfText` tal cual. Métrica: ¿el texto conserva el orden de lectura por sección? (proporción de líneas de la verdad que aparecen contiguas).
- **P1 · Estructurador heurístico** (determinista, sin modelo): segmentación por **títulos de sección** (diccionario es/en con variantes: experiencia/experience/trayectoria, formación/education, habilidades/skills/tecnologías, logros, certificaciones, idiomas, proyectos), **rangos de fechas** (`mar 2022 – actualidad`, `2019–2021`, `Jan 2020 – Present`, `03/2020`), **contacto** (email, teléfono, URL, ciudad), **viñetas** como logros, línea «rol · empresa · lugar» con separadores habituales, habilidades por comas o por líneas. Salida: `MasterProfile` **parcial** con `confidence` por campo y `provenance` (página y fragmento). Se implementa como funciones puras con pruebas propias.
- **P2 · Estructurador con el co-piloto local**: una tarea nueva de spike (`structure-cv`) que envía el texto (troceado por secciones cuando P1 las detecta; entero si no) al modelo local con el **esquema JSON** de `MasterProfile` y las mismas reglas de las tareas existentes (salida `json_object`, verificación por código: fechas válidas, ids únicos, texto presente en el original —nada inventado—, longitud). Modelos de referencia: Qwen2.5 7B (`llama-server`) y el que sirva Ollama en la máquina del Director; se mide con caché desactivada.
- **P3 · Maquetación** (mejora de P1): usar las **coordenadas** de los *items* de `pdfjs` (ya disponibles en el worker) para detectar columnas y bloques antes de segmentar; reordena el texto por columna/bloque y vuelve a aplicar P1. Se mide como P1+P3.

### 4.3 Métricas (arnés `scripts/spike/pdf-import/measure.ts`)

Por PDF y candidato, contra la verdad conocida:

- **Contacto**: nombre, email, teléfono, ubicación, enlaces (exactitud campo a campo).
- **Experiencias / proyectos / formación / certificaciones**: precisión y exhaustividad de **entradas** (emparejadas por empresa+rol o institución+título con similitud normalizada) y, dentro de cada entrada, exactitud de **fechas** (inicio, fin, «actualidad»), **ubicación** y **logros** (proporción de logros de la verdad recuperados con ≥ 90 % de similitud de texto; logros inventados = falsos positivos).
- **Habilidades e idiomas**: exhaustividad y precisión de la lista.
- **Global**: proporción de campos del perfil **prefijados correctamente** (lo que el usuario no tendría que escribir), tiempo por PDF, memoria máxima, determinismo (P1/P3: dos ejecuciones idénticas), y para P2 el tamaño del prompt, tokens y tiempo con cada modelo.
- **Ida y vuelta** (grupo A): perfil → PDF → importación → `cv import --dry-run` del resultado → comparación con `cv export` del original.

Las tablas se generan desde el arnés (Markdown) y se pegan tal cual en el informe: nada a mano.

### 4.4 Informe Go / No-Go (`docs/pdf-import-spike.md`, este documento, §11)

Umbrales propuestos (a fijar en §10 **antes** de medir):

| Criterio | Go | Go limitado | No-Go |
|---|---|---|---|
| Grupo A (PDF propios), mejor candidato determinista | ≥ 95 % de entradas con fechas correctas y ≥ 90 % de logros recuperados | ≥ 90 % / ≥ 80 % | por debajo |
| Grupo B (ajenos sintéticos), mejor candidato | ≥ 80 % de entradas con fechas correctas y ≥ 70 % de campos prefijados correctamente | ≥ 60 % de entradas con fechas y el borrador ahorra trabajo visible | por debajo |
| Falsos positivos (logros o entradas inventadas) | ≤ 2 % (P1/P3), ≤ 5 % (P2, y siempre marcados como «sin origen en el texto») | igual | por encima |
| Tiempo por PDF en la máquina de referencia | P1/P3 ≤ 5 s; P2 ≤ 2 min con un 7B local | igual | por encima |
| Casos límite (grupo C) | detectados y explicados, sin bloqueo | igual | cuelgue o invención |

- **Go**: se propone T-8.4b «Importación desde PDF» con el diseño de §4.5.
- **Go limitado**: solo para PDF generados por Chameleon CV (recuperar el perfil de un CV propio cuando se perdieron las fuentes) y borrador «mejor esfuerzo» para el resto, con aviso.
- **No-Go**: se documenta por qué (con las tablas) y se cierra la tarea; el texto extraído queda como está (para ofertas).

### 4.5 Si es Go: forma del producto (para la propuesta siguiente, no para este spike)

`cv import --from-pdf <cv.pdf> [--data <dir>] [--dry-run] [--provider …]` → lee el PDF contenido → estructura (P1/P3 y, si el usuario lo pide, el co-piloto configurado con su consentimiento) → escribe un **borrador** `MasterProfile` JSON y un fichero de **revisión** (como las revisiones de `improve`: cada campo con su procedencia y su confianza, marcable) → el usuario lo revisa → `cv import` de siempre (plan, auto-chequeo, `--replace` con `.bak`). API: `POST /import/pdf` (trabajo, como el co-piloto) y GUI: en Estado, «Importar un CV en PDF…» reutilizando el diálogo de importación de T-8.1. La GUI y la API no forman parte del spike.

## 5. Pruebas y verificación (C12, C13)

- El **código del spike** vive en `scripts/spike/pdf-import/` y `tests/spike/pdf-import/` (fuera de `src/`, fuera del ejecutable y de la imagen; excluido de los umbrales de cobertura del producto), pero el arnés de métricas y los estructuradores llevan **pruebas propias al 100 %** de sus funciones puras (segmentación, fechas, emparejamiento, métricas), porque un arnés que mide mal decide mal (C13).
- **Reproducibilidad**: `npm run spike:pdf-import -- corpus` regenera el corpus; `npm run spike:pdf-import -- measure [--candidate p1|p2|p3] [--model …]` produce las tablas; P1/P3 deterministas (se comprueba en el propio arnés); P2 con semilla fija y caché desactivada, dos ejecuciones para medir la varianza.
- Los PDF del grupo A se comparan también por **ida y vuelta** con `cv import --dry-run` real (binario `dist/`), no con dobles.
- Nada del spike toca el arnés de aceptación ni las pruebas del producto; la CI ejecuta las pruebas del spike como un paquete más (`vitest` con su propia configuración), no las mediciones (que exigen modelos locales).

## 6. Documentación (C15)

Este documento (evidencia y decisión, §11), una entrada en el ROADMAP con el veredicto, y —si Go— la PROPUESTA de T-8.4b. Ninguna guía de usuario: no hay función que documentar hasta la decisión.

## 7. Seguridad

- **Entrada no fiable**: todo PDF pasa por el worker contenido existente (límites de tamaño, páginas, texto, tiempo y memoria; sin JavaScript de PDF ejecutado); el spike no añade parsers nuevos ni relaja límites.
- **Modelos**: solo locales, en loopback; el texto del CV nunca sale de la máquina durante el spike (C3, C7). Si Go, el producto aplicará el consentimiento de coste y de envío ya existente para los remotos.
- **Sin PII**: corpus sintético; el Director puede probar con su propio CV en su máquina, pero ningún resultado con datos reales entra en el repositorio ni en el informe.
- **Nada se escribe** en las fuentes: el spike produce ficheros en un directorio temporal; si Go, el producto pasará por `cv import` y su plan.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| El corpus sintético no representa los CV reales (maquetaciones exóticas, PDF de Word con texto fragmentado) | Grupo B diseñado con las maquetaciones más habituales y un caso de texto fragmentado a propósito; el informe declara el límite y, si Go limitado, el producto avisa |
| P2 «alucina» entradas o fechas | Verificación por código (nada que no esté en el texto), métrica de falsos positivos con umbral duro, resultado siempre como borrador revisable |
| Tiempo y hardware para P2 | Se mide en la máquina de referencia con un 7B; el umbral es explícito; P1/P3 no dependen de modelo |
| Deriva del spike hacia producto | Código fuera de `src/`, sin comandos ni rutas; la decisión cierra el spike y abre (o no) otra tarea |
| Idiomas: solo es/en en el diccionario de P1 | Se declara; el co-piloto (P2) no depende del diccionario; el informe registra el comportamiento con un CV en otro idioma si el Director lo pide |

## 9. Plan de ejecución

- **S1 · Corpus y medida**: corpus A/B/C reproducible, arnés de métricas con sus pruebas, P0 y P1 medidos; tablas preliminares. Informe intermedio.
- **S2 · Candidatos y decisión**: P2 (con los modelos disponibles) y P3, tablas completas, análisis de errores por tipo, **informe Go / No-Go** con la recomendación del Director Técnico y, si procede, el esbozo de T-8.4b. Solicitud de decisión.

## 10. Decisiones que se piden al Director

1. **Corpus sintético** (propios con seis maquetaciones + ajenos escritos para el spike + casos límite), sin PII y versionado. *Recomendado.*
2. **Tres candidatos** (P1 heurístico, P2 co-piloto local guiado por el esquema, P3 maquetación como mejora de P1), medidos con el mismo arnés. *Recomendado.*
3. **Umbrales Go / Go limitado / No-Go** de §4.4, fijados antes de medir. *Recomendado (puede ajustarlos ahora, no después).*
4. **Código del spike fuera de `src/`** (`scripts/spike/pdf-import/`, `tests/spike/pdf-import/`), sin comandos ni rutas nuevas, con pruebas propias al 100 % del arnés y de los estructuradores. *Recomendado.*
5. **Modelos solo locales** durante el spike (Qwen2.5 7B y lo que sirva Ollama en la máquina de referencia). *Recomendado.*
6. **OCR fuera** del alcance (se detecta y se explica el PDF sin texto). *Recomendado.*
7. Si Go, el producto será un **borrador con revisión** que pasa por `cv import` (nunca escritura automática), a proponer en T-8.4b. *Recomendado.*
8. **Dos entregas** (S1 corpus y medida; S2 candidatos y decisión), sin versión asociada. *Recomendado.*

## 11. Estado de la implementación

- 2026-08-30: PROPUESTA v1 redactada tras la aprobación del S3 de T-8.3; pendiente de envío al Director cuando las releases v1.5.0 y v1.6.0 estén en marcha, tal como ordenó. Sin implementación hasta su aprobación.
