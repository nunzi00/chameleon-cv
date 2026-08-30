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

- 2026-08-30: PROPUESTA v1 redactada tras la aprobación del S3 de T-8.3 y enviada al Director con las releases v1.5.0 y v1.6.0 ya en marcha.
- 2026-08-30: **APROBADA** por el Director de Ingeniería y Producto «en su totalidad»: las ocho decisiones de §10 confirmadas y los umbrales de §4.4 **fijados** («no se modificarán»). El S1 comienza cuando las dos releases estén verificadas.
- 2026-08-30: **S2 entregado**: P3 y P2 implementados y medidos, grupo B completo, siete ajustes de la heurística, métrica corregida (Anexo B); **veredicto propuesto: Go limitado** (P3 núcleo determinista; P2 fuera del flujo por defecto por tiempo, falsos positivos de atribución y no determinismo); enviado al Product Owner para su veredicto.
- 2026-08-30: **S1 entregado (corpus y medida)**: corpus A/B/C reproducible (B con dos de las cuatro maquetaciones), arnés de métricas con pruebas al 100 %, P0 y P1 medidos, tablas preliminares en el Anexo A. Informe intermedio enviado al Director; pendiente de su veredicto para el S2.

## Anexo A · Resultados del S1 (2026-08-30): corpus, arnés y P1

**Lo construido.** `scripts/spike/pdf-import/` (fuera de `src/`, sin comandos ni rutas nuevas): `text.ts` (normalización y similitud de Dice sobre bigramas), `dates.ts` (puntos y rangos en es/en, con día, numéricos y solo año), `headings.ts` (diccionario cerrado de títulos de sección, con numeración, letras espaciadas y kerning partido), `structure.ts` (**P1**, el estructurador heurístico con procedencia por campo), `metrics.ts` (emparejamiento por parecido con los umbrales de §4.3, tarjeta por PDF y tabla Markdown), `corpus.ts` (generación reproducible) y `measure.ts`/`cli.ts` (`npm run spike:pdf-import -- corpus | measure | all`). Pruebas propias en `tests/spike/pdf-import/` (28 pruebas) con **cobertura 100 %** de los cinco módulos puros en líneas, sentencias, funciones y ramas (arnés de métricas incluido, C13). Maquetaciones «ajenas» en `tests/spike/pdf-import/layouts/` (mismo contrato `cv(d, theme)` que los temas).

**Corpus real.** Los PDF **no se versionan** (los de pdfkit dependen de la zlib de la máquina): se regeneran en `build/spike/pdf-import/corpus/` desde fuentes versionadas. A · propios: pdfkit y los cinco temas de Typst con el CV completo del banco en español, más `default` en inglés (7 PDF, verdad = el perfil del banco). B · ajenos: `two-column-icons` (dos columnas, glifos de contacto, empresa antes del rol, tabla de formación, habilidades en viñetas) y `dense-one-page-en` (una página densa, en inglés, sin viñetas, logros en línea separados por «;»); los dos previstos restantes (fechas en tabla y formato «funcional») pasan al S2. C · límites: solo imagen, 60 páginas y columnas entrelazadas.

**Tabla (generada por el arnés; P0 = parte de la verdad presente en el texto extraído; «Prefijado» = campos de la verdad correctos en el borrador; ms = extracción + estructuración):**

| PDF | Candidato | P0 texto | Contacto | Exp. entradas | Exp. fechas | Exp. logros | Logros inventados | Proyectos | Formación | Certif. | Habilidades | Idiomas | Prefijado | Sin asignar | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a/pdfkit | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 1 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 98 % (127/129) | 0 | 455 |
| a/typst-academic | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 5 | 33 % (1/3) | 0 % (0/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 86 % (107/125) | 0 | 368 |
| a/typst-classic | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 1 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 98 % (127/129) | 0 | 336 |
| a/typst-default-en | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 1 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 98 % (127/129) | 0 | 323 |
| a/typst-default | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 1 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 98 % (127/129) | 0 | 322 |
| a/typst-minimal | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 1 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 95 % (122/129) | 0 | 330 |
| a/typst-modern | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 5 | 33 % (1/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 88 % (112/127) | 0 | 336 |
| b/dense-one-page-en | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 0 % (0/22) | 0 | 100 % (3/3) | 100 % (2/2) | 25 % (1/4) | 56 % (9/16) | 100 % (3/3) | 33 % (43/129) | 0 | 316 |
| b/two-column-icons | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 1 | 100 % (3/3) | 0 % (0/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 89 % (113/127) | 3 | 328 |
| c/interleaved | p1 | 79 % (53/67) | 4/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 0 % (0/3) | 50 % (1/2) | 0 % (0/4) | 100 % (16/16) | 0 % (0/3) | 43 % (54/125) | 2 | 313 |

Determinismo: dos ejecuciones idénticas de P1 en todos los PDF. Tiempo: 0,3–0,45 s por PDF en la máquina de referencia (casi todo es la extracción en el worker contenido).

| PDF | Resultado del extractor | ms |
|---|---|---|
| c/image-only | texto extraído (1 páginas, 0 caracteres) | 260 |
| c/sixty-pages | too-many-pages: El PDF tiene 60 páginas (máximo 50) | 240 |

**Lectura.** (1) En los **PDF propios**, P1 recupera las cinco experiencias con fechas exactas y los 22 logros en las seis maquetaciones y prefija el 95–98 % de los campos en pdfkit, `default`, `classic`, `minimal` y `default-en`; `academic` (86 %) y `modern` (88 %) pierden proyectos (1/3, con cinco logros «inventados» = logros de proyectos atribuidos a la entrada equivocada) y, en `academic`, la formación (0/2): la fecha en el margen y el título en la columna de texto parten cada entrada en líneas que P1 no vuelve a unir. (2) En los **ajenos**, la maquetación de dos columnas queda en el 89 % (falla la tabla de formación, 0/2) y la página densa **sin viñetas** en el 33 %: las entradas y sus fechas se reconocen (5/5, 100 %) pero los logros en línea no superan el umbral del 0,9 porque el primer trozo arrastra el resumen y P1 no sabe dónde acaba una frase de resumen y empieza un logro. (3) **Columnas entrelazadas**: el propio texto extraído solo contiene el 79 % de la verdad de forma contigua; aun así P1 recupera las experiencias y sus logros (el orden no importa al emparejar) y pierde proyectos, certificaciones e idiomas. (4) Los **límites** se detectan y se explican sin colgarse ni inventar: cero caracteres en el PDF de imagen (OCR fuera de alcance, §1) y `too-many-pages` en el de 60 páginas. (5) Dos artefactos del extractor tuvieron que entrar en P1 porque aparecen en PDF reales: el nombre y el titular pegados sin salto de línea (banda de `modern`) y un título con la primera letra separada por el kerning («L anguages»).

**Frente a los umbrales de §4.4 (provisional, solo P1).** Grupo A: entradas con fechas correctas 100 % y logros 100 % en las seis maquetaciones (≥ 95 % / ≥ 90 %: cumplido por el candidato determinista); grupo B: entradas con fechas 100 % en las dos maquetaciones, campos prefijados 89 % y 33 % (el segundo, por debajo del 70 %); **logros inventados**: 1 por PDF en cinco maquetaciones (≈ 4–5 %) y 5 en `academic` y `modern` (≈ 23 %), **por encima del 2 %** exigido a P1/P3: es el punto que decide el S2; tiempo ≤ 5 s: cumplido con margen; casos límite: cumplido.

**S2.** (a) P3 (coordenadas y tamaños de fuente de los *items* de `pdfjs`, en el propio spike): apunta a los tres fallos de maquetación —márgenes de `academic`, pastillas y bandas de `modern`, tablas y columnas de B/C— y a los logros mal atribuidos; (b) P2 (co-piloto local guiado por el esquema, con verificación por código de que nada sale de fuera del texto) sobre todo el corpus, medido con Qwen2.5 7B; (c) las dos maquetaciones B pendientes; (d) análisis de errores por tipo y el informe Go / No-Go con las tablas completas.

## Anexo B · Resultados del S2 (2026-08-30): P3, P2, maquetaciones ajenas y análisis de errores

**Lo construido (commit `b562bd0`).** En `scripts/spike/pdf-import/`, siempre fuera de `src/`: `items-worker.mts` e `items.ts` (**P3**, extracción de los *items* de `pdfjs` con coordenadas, anchura y tamaño de fuente en un *worker* aparte con los mismos límites de bytes, páginas, memoria y tiempo que el extractor del producto), `layout.ts` (reconstrucción del orden de lectura a partir de los items), `verify.ts` (**P2**, parte pura: esquema JSON del borrador, *prompt*, normalización de fechas y verificación por código de la respuesta), `model.ts` (la llamada al co-piloto local con el proveedor `openai-compatible` del producto), `patient-fetch.ts` + `patient-fetch-install.ts` (transporte HTTP sin el límite de 300 s de cabeceras de `undici`, solo para medir), `measure.ts`/`cli.ts` (`measure --candidate p1|p2|p3 [--only a|b|c] [--limit n]` y `compare`, que escribe `build/spike/pdf-import/compare.md`). Dos maquetaciones ajenas más en `tests/spike/pdf-import/layouts/`: `table-dates` (experiencia, proyectos, formación, certificaciones e idiomas en tablas con el periodo en la primera columna y los logros en bloques «Puesto — Empresa» después de cada tabla) y `functional` (competencias primero, «Logros profesionales» agrupados sin empresa y la trayectoria como «periodo — *puesto*, empresa (lugar)»). Pruebas: 61 en `tests/spike/pdf-import/` (33 nuevas) con **cobertura del 100 %** en líneas, sentencias, funciones y ramas de los siete módulos puros (`text`, `dates`, `headings`, `structure`, `metrics`, `layout`, `verify`); `items.ts` se prueba con PDF reales (items, tamaño, inválido, páginas, tiempo). El conjunto completo del producto sigue en verde (127 ficheros, 887 pruebas) y las coberturas del producto no cambian.

**P3 · cómo reconstruye el orden de lectura (`layout.ts`).** (1) Los items con la misma línea base (tolerancia 0,45 × tamaño de fuente) forman una línea; dentro de ella, un hueco > 14 pt o un salto de tamaño de fuente ≥ 1,35× separa **celdas**, que se emiten unidas con « | » (separador que la heurística ya entendía). Dos items que se tocan se unen sin espacio (kerning: «L» + «anguages»), salvo entre letra y cifra («Universitat» + «2014»: celdas contiguas de una tabla). (2) Una página tiene **barra lateral** si los dos grupos de celdas más poblados por su x inicial están a ≥ 60 pt, el derecho tiene al menos una quinta parte de las líneas, el izquierdo se apila de forma continua (≥ 50 % de sus líneas a distancia de una línea de la vecina) y **no está atado a la fila**: si la mitad o más de sus primeras celdas son fechas o periodos, títulos de sección o etiquetas de habilidad con otra celda al lado, o etiquetas pegadas a su valor («Bases de datos PostgreSQL, MySQL»), es una tabla o un margen de fechas y la página se lee fila a fila. (3) Con barra lateral se emite primero la columna izquierda entera y después la derecha; las páginas consecutivas con la misma división se agrupan (la barra de las dos páginas antes que el cuerpo de las dos) para que el flujo principal no se corte. Es determinista y no necesita el modelo.

**P2 · cómo se guía y se verifica el modelo (`verify.ts`, `model.ts`).** El texto del extractor del producto (P0, hasta 24 000 caracteres) va al co-piloto local con el mismo proveedor y la misma forma de petición que las tareas del producto: `response_format: json_schema` estricto generado con `z.toJSONSchema` a partir de un `z.strictObject` con las secciones del borrador, temperatura 0, semilla fija, 6 000 tokens de salida como máximo y 15 minutos de tiempo límite. El *prompt* exige copiar cada texto **literalmente** y omitir lo que no esté. La respuesta se valida con el esquema y después se **verifica por código**: cada cadena (nombre, titular, subtítulo, lugar, URL, resumen, tecnología, logro, impacto, habilidad, idioma) debe aparecer en el texto del CV como palabra o secuencia completa (forma alfanumérica con límites de palabra: «Go» dentro de «Pagos» o «56» dentro de un teléfono no cuentan); lo que no aparece se descarta y se cuenta (entradas, logros, campos); las fechas se normalizan a `AAAA`, `AAAA-MM` o `AAAA-MM-DD` y lo que no cuadra se descarta; la procedencia es la primera línea que contiene el texto. Máquina de referencia: AMD Ryzen AI 9 365 (10 núcleos, sin GPU dedicada), llama.cpp b10679 con `Qwen2.5-7B-Instruct-Q4_K_M` (`-c 12288 -t 10`); con `-t 20` (hilos SMT) el servidor generaba a 0,8 tokens/s frente a 7,1 tokens/s con `-t 10`, y una primera pasada murió por el límite de cabeceras de `undici` (300 s) porque llama-server no envía nada hasta terminar el JSON: de ahí el transporte «paciente», que se instala antes de que `src/llm` capture `fetch`.

**Métrica corregida (C13).** La verdad del banco lleva marcas Markdown en algunos logros («Publiqué [Kafka Guardian](https://…)») que el PDF no muestra; el arnés comparaba con la marca y contaba un logro «inventado» en todas las maquetaciones propias (parecido 0,85 < 0,9). Ahora la verdad se compara sin enlaces, negritas ni cursivas (`plainText`, con prueba).

**Ajustes de P1 tras el análisis de errores del S2.** Todos son reglas generales (ninguna mira el nombre de la maquetación), cada una con su prueba y su caso motivador:

1. **Enlace en su propia línea** bajo el título de un proyecto → `url`, no continuación del subtítulo (`modern` y `academic` perdían 2 de 3 proyectos y sus 5 logros contaban como inventados). Admite un espacio interior porque la fuente de `academic` devuelve el guion como espacio («https://example.org/kafka guardian»; también «( 56 % p99)» sin signo): es una particularidad de `pdfjs` con esa fuente que afecta por igual a P0, P1 y P3.
2. **Bloque de detalle que repite el título** de una entrada ya cerrada («Staff Backend Engineer — Nexo Pagos» tras la tabla) → se **reabre** esa entrada (se restaura tal como estaba) y sus viñetas van a ella (`table-dates`: los 22 logros iban a la última fila; de 34 % a 79 % prefijado). La cabecera repetida de la entrada abierta se omite.
3. **Fila de tabla**: una celda « | » tras la fecha nunca es cuerpo en línea, y el cuerpo en línea exige prosa (frases con punto o punto y coma): «2014 – 2015 Máster en Ciencia de Datos · Universitat de València» es un título largo (formación 0/2 en cinco maquetaciones → 2/2 en cuatro).
4. **Paréntesis final con tres partes** califica al lugar («Valencia (remoto)»), no lo sustituye; en formación el paréntesis es el campo («(Ingeniería de datos)»), nunca el lugar.
5. **Continuación en minúscula** corta («de València») tras un subtítulo no es el título de la entrada siguiente aunque la línea de después lleve fecha.
6. **Nivel de idioma sin separador** («Valenciano C1») y **separadores de celda** en las habilidades («Lenguajes: | PHP, Python») se limpian.
7. **Etiqueta de habilidad pegada a su valor** y **celdas contiguas letra/cifra** (en `layout.ts`, para P3).

Efecto acumulado sobre P1 en el grupo A: de 86–98 % (S1) a **96–100 %** prefijado, **0 logros inventados** en todas las maquetaciones (S1: entre 1 y 5).

**Tablas (generadas por el arnés; mismas columnas que el Anexo A; ms = extracción + estructuración, media de máquina de referencia).**

P1 (heurística sobre el texto del extractor del producto):

| PDF | Candidato | P0 texto | Contacto | Exp. entradas | Exp. fechas | Exp. logros | Logros inventados | Proyectos | Formación | Certif. | Habilidades | Idiomas | Prefijado | Sin asignar | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a/pdfkit | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | 1299 |
| a/typst-academic | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | 1310 |
| a/typst-classic | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | 1117 |
| a/typst-default-en | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | 872 |
| a/typst-default | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | 779 |
| a/typst-minimal | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 96 % (124/129) | 0 | 1278 |
| a/typst-modern | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | 1090 |
| b/dense-one-page-en | p1 | 99 % (66/67) | 5/5 | 80 % (4/5) | 100 % (4/4) | 0 % (0/22) | 0 | 100 % (3/3) | 100 % (2/2) | 25 % (1/4) | 56 % (9/16) | 100 % (3/3) | 31 % (40/128) | 0 | 792 |
| b/functional | p1 | 90 % (60/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 0 % (0/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 41 % (53/129) | 0 | 900 |
| b/table-dates | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 3 | 67 % (2/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 89 % (114/128) | 2 | 929 |
| b/two-column-icons | p1 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 0 % (0/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 90 % (114/127) | 3 | 887 |
| c/interleaved | p1 | 79 % (53/67) | 4/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 0 % (0/3) | 50 % (1/2) | 0 % (0/4) | 100 % (16/16) | 0 % (0/3) | 43 % (54/125) | 2 | 796 |

P3 (la misma heurística sobre el texto reconstruido a partir de los items):

| PDF | Candidato | P0 texto | Contacto | Exp. entradas | Exp. fechas | Exp. logros | Logros inventados | Proyectos | Formación | Certif. | Habilidades | Idiomas | Prefijado | Sin asignar | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a/pdfkit | p3 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | 2511 |
| a/typst-academic | p3 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | 2182 |
| a/typst-classic | p3 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | 2637 |
| a/typst-default-en | p3 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | 2555 |
| a/typst-default | p3 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | 2089 |
| a/typst-minimal | p3 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 96 % (124/129) | 0 | 1951 |
| a/typst-modern | p3 | 97 % (65/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 50 % (1/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 99 % (127/128) | 0 | 2479 |
| b/dense-one-page-en | p3 | 99 % (66/67) | 5/5 | 80 % (4/5) | 100 % (4/4) | 0 % (0/22) | 0 | 100 % (3/3) | 100 % (2/2) | 25 % (1/4) | 56 % (9/16) | 100 % (3/3) | 31 % (40/128) | 0 | 2454 |
| b/functional | p3 | 90 % (60/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 0 % (0/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 41 % (53/129) | 0 | 2367 |
| b/table-dates | p3 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 3 | 1543 |
| b/two-column-icons | p3 | 96 % (64/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 50 % (1/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 91 % (116/128) | 3 | 2530 |
| c/interleaved | p3 | 76 % (51/67) | 4/5 | 100 % (5/5) | 100 % (5/5) | 50 % (11/22) | 1 | 0 % (0/3) | 50 % (1/2) | 0 % (0/4) | 100 % (16/16) | 0 % (0/3) | 34 % (43/125) | 5 | 2068 |

Casos límite (grupo C, iguales para P1 y P3):

| PDF | Resultado | ms |
|---|---|---|
| c/image-only | texto extraído (1 páginas, 0 caracteres) | 921 |
| c/sixty-pages | too-many-pages: El PDF tiene 60 páginas (máximo 50) | 881 |

**Lectura de P1 y P3.** (1) **Grupo A**: las siete maquetaciones propias recuperan las 5 experiencias con fechas exactas, los 22 logros con sus impactos, los 3 proyectos, la formación, las 4 certificaciones, las 16 habilidades y los 3 idiomas; `minimal` (96 %) solo pierde los cinco lugares de la experiencia porque su plantilla imprime «Nexo Pagos Valencia» sin separador (la empresa absorbe el lugar). P3 iguala a P1 en A salvo en `modern` (99 %: la celda de la pastilla parte «Universitat | 2014 – 2015» y la segunda formación queda incompleta). (2) **Grupo B**: `table-dates` pasa de 89 % (P1, con 3 logros mal atribuidos) a **100 %** con P3, porque las celdas « | » dan a la heurística los límites entre periodo, puesto, empresa y lugar; `two-column-icons` 90–91 % en ambos (la barra lateral se lee entera antes que el cuerpo; falla la tabla de formación porque la columna estrecha del centro parte «Universitat / de / València» en tres líneas y P3 aún no une celdas partidas verticalmente); `functional` **41 %** y `dense-one-page-en` **31 %** no mejoran con P3 porque no es un problema de orden de lectura: en `functional` los 22 logros están agrupados bajo «Logros profesionales» sin empresa —el propio CV no los asocia a un puesto, así que van a la sección general de logros y ningún candidato puede atribuirlos sin inventar—, y en `dense` cada puesto es un párrafo corrido («Puesto, Empresa (Lugar) — fechas. Resumen. Logro; Logro; … Technologies: …») cuyos logros, tecnologías, impactos y certificaciones (cuatro en una línea separadas por «;») exigirían partir prosa por frases, algo que hoy la heurística no hace porque crearía logros falsos a partir de los resúmenes; aun así ambos prefijan cabecera, contacto, las 5 experiencias con fechas, formación, habilidades e idiomas. (3) **Grupo C**: `image-only` devuelve texto vacío sin inventar nada, `sixty-pages` se rechaza por el límite de páginas del producto y `interleaved` (columnas entrelazadas a propósito) degrada sin colgarse (43 % P1, 34 % P3: la unión de celdas empareja fragmentos de columnas distintas y P3 pierde 11 logros y atribuye 1 mal). (4) **Tiempo**: P1 0,8–1,3 s por PDF y P3 1,5–2,6 s (el segundo *worker* añade ~1,2 s); los dos deterministas (dos ejecuciones idénticas en todos los PDF).

**P2 · primera pasada (esquema v1, claves opcionales).** Doce PDF en 71 minutos (de 3,9 a 9,5 min por CV; media 5,7). Prefijado entre el 12 % y el 48 %; **contacto 0/5 y fechas 0/5 en diez de doce**, habilidades 0/16 en siete, y entre 3 y 8 logros mal atribuidos por PDF (58 en `functional`: el modelo repartió entre los puestos los logros que el CV agrupa sin empresa, exactamente la atribución inventada que temíamos, y que la verificación por código no puede detectar porque los textos sí están en el CV). La verificación descartó 0 entradas, 0 logros y 2 campos: el modelo casi no inventa texto; **omite y atribuye mal**. El análisis de la respuesta cruda (guardada ahora por el arnés en `build/spike/pdf-import/drafts/p2/`) lo explica: con claves opcionales en el esquema, la gramática le permite saltarse `fullName`, `email`, `phone`, `location`, `links`, `summary` y las fechas, y lo hace; y en `skills` devolvió las etiquetas («Lenguajes», «Frameworks»…) como nombres. Además **no es determinista** aunque la temperatura sea 0 y la semilla fija: el mismo `a/typst-default` dio 48 % (fechas 5/5, 16 logros, 16 habilidades) en la pasada completa y 17 % (fechas 0/5, 3 logros, 0 habilidades) al repetirlo (llama.cpp en CPU no garantiza la misma salida entre ejecuciones). Antes de juzgar a P2 con un esquema que le permite omitir, se midió una segunda pasada con el **esquema v2**: todas las claves obligatorias (`null` cuando no hay dato), el *prompt* exige rellenar la cabecera y todos los logros, y las fechas con el mes en letras pasan por el analizador de fechas del spike (`normalizeDate`).

Tabla de la primera pasada de P2 (esquema v1):

| PDF | Candidato | P0 texto | Contacto | Exp. entradas | Exp. fechas | Exp. logros | Logros inventados | Proyectos | Formación | Certif. | Habilidades | Idiomas | Prefijado | Sin asignar | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a/pdfkit | p2 | 99 % (66/67) | 0/5 | 100 % (5/5) | 0 % (0/5) | 73 % (16/22) | 7 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 0 % (0/3) | 40 % (52/129) | 0 | 425933 |
| a/typst-academic | p2 | 99 % (66/67) | 0/5 | 100 % (5/5) | 0 % (0/5) | 14 % (3/22) | 4 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 0 % (0/3) | 27 % (35/129) | 0 | 257927 |
| a/typst-classic | p2 | 99 % (66/67) | 0/5 | 100 % (5/5) | 0 % (0/5) | 14 % (3/22) | 3 | 100 % (3/3) | 100 % (2/2) | 75 % (3/4) | 0 % (0/16) | 0 % (0/3) | 12 % (16/129) | 0 | 232702 |
| a/typst-default-en | p2 | 99 % (66/67) | 0/5 | 100 % (5/5) | 100 % (5/5) | 73 % (16/22) | 7 | 100 % (3/3) | 0 % (0/2) | 0 % (0/4) | 0 % (0/16) | 100 % (3/3) | 32 % (41/127) | 0 | 377426 |
| a/typst-default | p2 | 99 % (66/67) | 0/5 | 100 % (5/5) | 100 % (5/5) | 73 % (16/22) | 7 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 0 % (0/3) | 48 % (62/129) | 0 | 369366 |
| a/typst-minimal | p2 | 99 % (66/67) | 0/5 | 100 % (5/5) | 0 % (0/5) | 14 % (3/22) | 4 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 0 % (0/16) | 0 % (0/3) | 15 % (19/129) | 0 | 227410 |
| a/typst-modern | p2 | 99 % (66/67) | 0/5 | 100 % (5/5) | 0 % (0/5) | 14 % (3/22) | 4 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 0 % (0/16) | 100 % (3/3) | 17 % (22/129) | 0 | 240379 |
| b/dense-one-page-en | p2 | 99 % (66/67) | 0/5 | 100 % (5/5) | 0 % (0/5) | 55 % (12/22) | 8 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 0 % (0/16) | 100 % (3/3) | 22 % (29/129) | 0 | 298720 |
| b/functional | p2 | 90 % (60/67) | 0/5 | 100 % (5/5) | 0 % (0/5) | 68 % (15/22) | 58 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 0 % (0/16) | 0 % (0/3) | 22 % (29/129) | 0 | 569962 |
| b/table-dates | p2 | 99 % (66/67) | 0/5 | 100 % (5/5) | 0 % (0/5) | 73 % (16/22) | 7 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 43 % (55/129) | 0 | 335245 |
| b/two-column-icons | p2 | 99 % (66/67) | 0/5 | 100 % (5/5) | 0 % (0/5) | 73 % (16/22) | 6 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 0 % (0/16) | 0 % (0/3) | 29 % (37/129) | 0 | 335295 |
| c/interleaved | p2 | 79 % (53/67) | 0/5 | 100 % (5/5) | 0 % (0/5) | 100 % (22/22) | 0 | 0 % (0/3) | 100 % (2/2) | 0 % (0/4) | 0 % (0/16) | 0 % (0/3) | 23 % (29/126) | 0 | 235857 |

**P2 · segunda pasada (esquema v2, claves obligatorias) y repuntuación.** Doce PDF: 9 en la pasada de 65 min y 3 (`typst-default`, `typst-minimal`, `functional`) repetidos con 30 min de límite tras agotar los 15. Tiempos por CV entre **4,3 y 20,1 minutos** (mediana ≈ 12,5; 10–14 en la mayoría): las respuestas v2 son más largas porque el modelo rellena todas las claves. Como el arnés guarda la respuesta cruda de cada CV, la mejora de la verificación (el impacto «(…)» que el modelo deja dentro del texto se separa por código, como hace P1) se aplicó **repuntuando sin volver a llamar al modelo** (`npm run spike:pdf-import -- rescore`); la tabla es la de esa repuntuación (ms no aplicables). La verificación por código descartó **2 logros y 33 campos** cuyo texto no está en el CV (invención pura, eliminada); lo que queda como «inventado» en la tabla son logros **presentes en el CV pero mal atribuidos o segmentados**, que la verificación no puede detectar.

| PDF | Candidato | P0 texto | Contacto | Exp. entradas | Exp. fechas | Exp. logros | Logros inventados | Proyectos | Formación | Certif. | Habilidades | Idiomas | Prefijado | Sin asignar | ms |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| a/pdfkit | p2 | 99 % (66/67) | 4/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 98 % (126/129) | 0 | — |
| a/typst-academic | p2 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 93 % (120/129) | 0 | — |
| a/typst-classic | p2 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 86 % (19/22) | 4 | 100 % (3/3) | 100 % (2/2) | 75 % (3/4) | 100 % (16/16) | 100 % (3/3) | 91 % (118/129) | 0 | — |
| a/typst-default-en | p2 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 98 % (127/129) | 0 | — |
| a/typst-default | p2 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 100 % (129/129) | 0 | — |
| a/typst-minimal | p2 | 99 % (66/67) | 4/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 99 % (128/129) | 0 | — |
| a/typst-modern | p2 | 99 % (66/67) | 4/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 95 % (122/129) | 0 | — |
| b/dense-one-page-en | p2 | 99 % (66/67) | 4/5 | 100 % (5/5) | 100 % (5/5) | 9 % (2/22) | 19 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 63 % (81/129) | 0 | — |
| b/functional | p2 | 90 % (60/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 27 % (6/22) | 16 | 33 % (1/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 50 % (63/127) | 0 | — |
| b/table-dates | p2 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 100 % (16/16) | 100 % (3/3) | 98 % (127/129) | 0 | — |
| b/two-column-icons | p2 | 99 % (66/67) | 5/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 100 % (3/3) | 100 % (2/2) | 100 % (4/4) | 94 % (15/16) | 100 % (3/3) | 91 % (118/129) | 0 | — |
| c/interleaved | p2 | 79 % (53/67) | 4/5 | 100 % (5/5) | 100 % (5/5) | 100 % (22/22) | 0 | 0 % (0/3) | 100 % (2/2) | 0 % (0/4) | 100 % (16/16) | 0 % (0/3) | 58 % (73/126) | 0 | 0 |

**Lectura de P2.** Con la cabecera y las fechas ya obligatorias, P2 llega al 91–100 % en los PDF propios (100 % en `default`, 98 % en `pdfkit`, `default-en` y `table-dates`), pero: (1) `classic` pierde 3 logros y atribuye 4 mal; (2) en `dense` (párrafos corridos) re-segmenta la prosa a su manera: 2/22 logros y **19 «inventados»** (frases partidas de otra forma); (3) en `functional` reparte entre los puestos los logros que el CV agrupa sin empresa: **16 atribuciones inventadas** (6/22 correctas), justo el riesgo que temíamos y que ningún verificador de texto detecta; (4) `interleaved` recupera los 22 logros (mejor que P1/P3) pero pierde proyectos e idiomas; (5) **no es determinista**: en la v1 el mismo `typst-default` dio 48 % y 17 % en dos ejecuciones idénticas (temperatura 0, semilla fija; llama.cpp en CPU no lo garantiza); (6) el coste temporal es 100–600 veces el de P3.

**Frente a los umbrales de §4.4 (fijados de antemano).**

| Criterio | P1 | P3 | P2 (v2, repuntuado) |
|---|---|---|---|
| Grupo A: ≥ 95 % entradas con fechas · ≥ 90 % logros | 100 % · 100 % (7/7) | 100 % · 100 % (7/7) | 100 % · ≥ 90 % en 6/7 (`classic` 86 %) |
| Grupo B: ≥ 80 % entradas con fechas · ≥ 70 % prefijado | fechas 4/4 · prefijado 2/4 (`table-dates` 89 %, `two-column` 90 %; `functional` 41 %, `dense` 31 %) | fechas 4/4 · prefijado **2/4** (`table-dates` 100 %, `two-column` 91 %; `functional` 41 %, `dense` 31 %) | fechas 4/4 · prefijado 2/4 (98 %, 91 %; `dense` 63 %, `functional` 50 %) |
| Go limitado en B: ≥ 60 % entradas con fechas y el borrador ahorra trabajo visible | sí (4/4) | sí (4/4) | sí (4/4) |
| Falsos positivos (≤ 2 % P1/P3, ≤ 5 % P2) | 0 en A y B; `interleaved` 0 | 0 en A y B; `interleaved` 1/22 | `classic` 18 %, `dense` 86 %, `functional` 73 % de los logros de la verdad: **no cumple** |
| Tiempo por PDF (P1/P3 ≤ 5 s; P2 ≤ 2 min) | 0,8–1,3 s ✓ | 1,5–2,6 s ✓ | 4–20 min ✗ |
| Grupo C detectado y explicado, sin bloqueo | ✓ | ✓ | ✓ (rechaza 60 páginas, vacío sin inventar) |

**Veredicto que propone el Director Técnico: Go limitado**, con P3 como núcleo determinista y P2 fuera del flujo por defecto.

- El candidato determinista cumple el Go en el grupo A (100 %, 0 inventados en las siete maquetaciones propias, ~2 s por PDF, dos ejecuciones idénticas) y en las maquetaciones ajenas estructuradas (tablas 100 %, barra lateral 91 %); no alcanza el 70 % en las dos maquetaciones ajenas cuya información no está estructurada (`functional`: el propio CV no asocia los logros a un puesto; `dense`: prosa sin viñetas), en las que sí cumple la fila «Go limitado» (todas las entradas con fechas, cabecera, formación, habilidades e idiomas prefijados). Es exactamente la definición de §4.4: recuperar un perfil desde un CV propio y un borrador «mejor esfuerzo», con aviso, para el resto.
- P2 no puede ser el núcleo: falla el tiempo (4–20 min en la máquina de referencia frente a 2) y, sobre todo, el umbral de falsos positivos en tres maquetaciones por **atribución y segmentación inventadas** que la verificación por código no puede detectar (los textos sí están en el CV); además no es determinista. Aporta algo donde P3 no llega (`interleaved`: 22/22 logros; `dense`: 63 % frente a 31 %) a un coste que solo tiene sentido como opción explícita, con GPU y con un verificador de atribución que hoy no existe: **queda fuera de T-8.4b** y, si algún día se retoma, con un spike propio.
- Lo que iría a **T-8.4b «Importar desde PDF»** (propuesta aparte, si el PO lo aprueba): `cv import --from-pdf` y la pantalla correspondiente con P3 (items + heurística) generando un **borrador de fuentes revisable** con la procedencia línea a línea y lo «sin asignar» a la vista; ámbito prometido = PDF generados por Chameleon CV y maquetaciones con tablas o barra lateral; para el resto, borrador parcial con aviso; **antes de implementar, un corpus de PDF reales de terceros** (el de este spike es sintético) medido con este mismo arnés.
- Deuda del spike que se cierra con él: el corpus y el arnés quedan en `scripts/spike/pdf-import/` y `tests/spike/pdf-import/` (61 pruebas, 100 %), sin tocar `src/`; los borradores y respuestas del modelo en `build/spike/pdf-import/drafts/` no se versionan.
