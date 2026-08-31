# Importar un CV existente (PDF/DOCX) a las fuentes (T-8.4b) — PROPUESTA v1

Estado: APROBADA por el PO (2026-08-30, D1–D5) · Orden del Director · Se implementa tras T-8.5 S1–S2 (1.9.0)

## §0 Encargo

Director, 2026-08-30: «necesito que proceses […] la parte de importación de cv; para esa parte, creo que la ayuda de llm
puede ser de ayuda». Antecedentes: T-8.4 (spike, veredicto «Go limitado»): P3 (reconstrucción determinista desde la
maquetación del PDF) es el núcleo; P2 (modelo local de extremo a extremo) queda fuera del flujo por defecto por lento y
no determinista. La pregunta original del Director («¿dónde tenemos el importador de doc/pdf?») ya señaló la necesidad.

## §1 Qué hay hoy

`cv import <perfil.json>` (la inversa de `cv build`, con auto-chequeo); el spike en `scripts/spike/pdf-import/` con el
corpus sintético, el arnés de métricas y los tres candidatos medidos; `extractPdfText` endurecido en un worker; el
co-piloto con revisiones verificadas (C2) y, desde T-8.13, `qwen3:8b` por defecto con razonamiento conmutable.

## §2 Propuesta (dos fases, el LLM ayuda pero nunca decide)

1. **Fase determinista (P3, el núcleo)**: `cv import-cv <fichero.pdf>` extrae la maquetación (líneas, tamaños,
   negritas, posiciones) con el código del spike endurecido en `src/import/`, segmenta secciones (experiencia,
   formación, habilidades, certificaciones, idiomas) por tipografía y palabras clave, y produce un **borrador de
   fuentes** en `import/<nombre>/` (nunca sobre `data/sources/`): `profile.md`, `experience/*.md`, `skills.csv`… con
   una cabecera «BORRADOR importado de <fichero> el <fecha>» y un informe de lo que no se pudo situar.
2. **Asistente del co-piloto (la ayuda del LLM que pide el Director)**: `cv import-cv --copilot` (y en la GUI un botón
   «Refinar con el co-piloto») envía los fragmentos ambiguos —seudonimizados como improve/summarize— al modelo local
   para proponer el mapeo (¿esto es un logro o un resumen?, ¿la fecha es 2019–2021?, etiquetas del diccionario), y las
   propuestas llegan como **revisión** estándar (fichero de revisión + `cv improve apply` con historial de T-8.10):
   verificación C2 (nada que no esté en el texto origen), nunca escritura directa. Sin `--copilot`, cero red y cero LLM.
3. **DOCX**: conversión a texto con el mismo tokenizador de ofertas (docx = zip + XML; extractor propio sin
   dependencias, solo `word/document.xml` con los párrafos y estilos básicos); la maquetación fina queda para PDF.
4. `cv build --data import/<nombre>` permite validar el borrador antes de moverlo a mano (o con `cv import` una vez
   revisado) a `data/sources/`.

## §3 Fuera de alcance

OCR de PDF escaneados; fotos y diseño; importación directa a `data/sources/` sin revisión; LinkedIn export (otro
formato, otra tarea).

## §4 Pruebas

Corpus del spike + 3 CV reales del Director (anonimizados como en T-8.5); 100 % de `src/import/**`; arnés `import-cv-*`
con PDF del banco (generados por los propios temas: los 27 temas de T-8.12 son un corpus perfecto de maquetaciones);
métrica del spike como prueba con umbrales; el asistente del co-piloto con el doble del proveedor.

## §5 Decisiones que se piden al PO

1. **D1** Dos fases: núcleo determinista P3 + asistente opcional del co-piloto (`--copilot`), con las propuestas como
   revisión C2 y el historial de T-8.10.
2. **D2** Borrador en `import/<nombre>/`, nunca escritura directa en `data/sources/`.
3. **D3** DOCX con extractor propio mínimo (document.xml); la maquetación fina, solo PDF.
4. **D4** Los PDF de los 27 temas del banco como corpus de regresión, más 3 CV reales anonimizados del Director.
5. **D5** Se implementa tras T-8.5 S1–S2 (la URL primero, como ordenó el Director), con destino 1.9.0.

## §6 Estado

- **Núcleo (fase 1) IMPLEMENTADO el 2026-08-30**: `src/import/{text,dates,headings,layout,structure}.ts` portados del spike con cabeceras de producto; `items.ts`/`items-worker.mts` endurecidos como el extractor de PDF (ruta o código embebido vía assets, límites, worker terminado); `draft.ts` valida ENTIDAD A ENTIDAD contra el esquema maestro y degrada con motivo y procedencia (idiomas MCER aproximado con aviso, experiencia sin fechas al informe, campos opcionales rotos retirados uno a uno); ficheros con los serializadores de `cv import` + banner de borrador + `README.md` (informe); `docx.ts` mínimo con `readZipEntries`. CLI `import-cv` (--name, --replace), escenario de aceptación `import-cv` (PDF del banco → borrador → `build --data` en verde) y humo real: el PDF del tema `classic` regenera un borrador que compila.
- Desviaciones: el informe se llama `README.md` (el cargador lo ignora en la raíz del dataset, así el borrador valida tal cual); idioma sin nivel reconocible queda como B2 provisional con aviso (el esquema exige nivel MCER).
- **Pantalla web (30-ago, misma noche, a petición del Director «no veo la importación en la web»)**: núcleo compartido `src/app/import-cv.ts` (AppError: datos 422, conflicto 409, entorno 500) usado por la CLI y por `POST /import-cv` (cuerpo binario PDF/DOCX hasta 10 MiB, cabeceras `x-cv-import-name`/`x-cv-import-replace`; la cabecera mágica decide el formato, no el Content-Type); página «Importar CV» en el grupo Perfil (fichero + nombre opcional, resumen con cuentas, README como informe, sustitución tras 409); pruebas del servidor real (201/409/422, DOCX por magia, worker real con PDF inválido) y de la página.
- **Corpus público (31-ago, orden del Director: «busca en internet varios ejemplos» en lugar de sus 3 CV)**: siete PDF de terceros descargados a `build/import-corpus/` (NO se versionan: contenido ajeno; se re-descargan por URL). Fuentes: Stony Brook (Student Employee y First-Year — plantilla+guía con marcadores «Start Month Year»), Stanford (folleto multi-CV), Illinois (folleto), UC Davis (folleto de 60+ págs.), UCM ×2 (guías en español). Resultado baseline: **7/7 borradores validan con `cv build --data`** y los `.md` salen limpios (sin banner). Los folletos/guías caen mayormente a «Sin situar» (esperado: un CV por fichero es el contrato) y sirven como corpus de estrés.
- Hallazgos del corpus para la fase 2 (registrados, sin tocar la heurística ahora): (1) `splitNames` parte por comas DENTRO de paréntesis («Google Workspace (Docs, Slides…)» → habilidades basura); (2) las plantillas con marcadores («Start Month Year – End Month Year») no abren entradas (correcto, pero conviene detectarlo y avisar «parece una plantilla sin rellenar»); (3) prosa de guía se cuela como habilidades cortas o resumen — un umbral de «densidad de CV» podría avisar «esto no parece un CV». Bug ya corregido hoy: el banner HTML en los `.md` se colaba en el `summary` del cargador (rompía el límite de 3000 y ensuciaba el artefacto) → los `.md` del borrador salen LIMPIOS y la procedencia vive solo en el README (desviación respecto a §2.1).
- **Fase 2, verdad de precisión (31-ago; el Director autorizó localizar los CV en internet)**: cuatro CV FICTICIOS RELLENOS descargados a `build/import-corpus/` (nunca versionados): `janedoe-csuci` (CSU Channel Islands), `janedoe-plymouth` (escaneo con OCR sucio), `johnjacob-purdue` (guía anotada con plantilla) y `johndoe-wikimedia`. Medición ANTES → DESPUÉS de las mejoras heurísticas de esta fase (experiencias · formaciones reconocidas frente a lo que dice el propio CV):

| CV | verdad | antes | después |
| --- | --- | --- | --- |
| janedoe-csuci | 2 exp · 1 form | **0 exp · 4 form** (las 3 experiencias caían dentro de formación) | **2 exp · 1 form** ✅ |
| johndoe-wikimedia | 4 exp | 4 exp ✅ | 4 exp ✅ |
| janedoe-plymouth | 2 exp (escaneo ilegible) | 2 exp, sin aviso | 2 exp **+ aviso de OCR de baja calidad** |
| johnjacob-purdue | guía, no es un CV | 3 form falsas, sin aviso | 5 form falsas **+ aviso de plantilla sin rellenar** |

- **Mejoras heurísticas de la fase 2 (31-ago)**: (1) títulos de sección con MATIZ («Relevant Experience», «Otra formación») y su variante espaciada («R E L E V A N T  E X P E R I E N C E»), que era la causa exacta del fallo de CSUCI; (2) una cabecera ESPACIADA desconocida («C A M P U S  I N V O L V M E N T») cierra la sección en curso y su contenido va al informe, en vez de colarse como entradas de la sección anterior; (3) la formación abre con una FECHA ÚNICA de graduación cuando cierra la línea tras un separador y el título tiene cuerpo (con aviso «la toma como inicio; ajústala»), regla deliberadamente estrecha para no abrir entradas con cualquier año suelto de una guía; (4) `splitNames` respeta los separadores dentro de paréntesis y corchetes; (5) nuevo `src/import/quality.ts` con avisos de calidad del TEXTO (escaneo con OCR de baja calidad citando fragmentos, plantilla sin rellenar, texto demasiado corto —imagen sin capa de texto— y «ninguna entrada reconocida»), que encabezan el informe del borrador.
- **`--copilot` ENTREGADO (31-ago)**: nueva tarea `import map` (`src/llm/tasks/import-map.ts`, prompt `import-map.v1`) que envía SOLO las líneas sin situar (hasta 40, seudonimizadas con la redacción de improve/summarize) y recibe una sección de un **vocabulario cerrado** de diez valores; el código verifica cada propuesta (línea enviada, sección del vocabulario, una por línea) y rechaza el resto con aviso en el informe. Las propuestas se listan en el `README.md` bajo «Propuestas del co-piloto (no aplicadas)»: **nada se escribe en el borrador**. Con proveedor remoto, consentimiento de coste antes de enviar (`--yes` en scripts). Verificado en vivo con `qwen3:8b` sobre `janedoe-csuci`: «descartar» para la cabecera y «experiencia» para las dos entradas de CAMPUS INVOLVEMENT.
- **Desviación respecto a §2.2**: las propuestas NO viajan como fichero de revisión de `cv improve apply`. Ese formato aplica mejoras de texto a entidades que ya existen (con su id), y aquí las líneas sin situar todavía no pertenecen a ninguna entidad: no hay nada a lo que `apply` pueda aplicarlas. Se entregan en el informe del borrador, que es donde vive el resto de la revisión manual.
- **Botón «Refinar con el co-piloto» ENTREGADO (T-8.18, 31-ago)**: `POST /api/v1/jobs/import-map`, un trabajo del sistema de trabajos como improve/summarize/suggest-tags (progreso por SSE, cancelable, 403 sin permiso de remotos y 409 de consentimiento). Decisiones aprobadas por el PO: **D1** trabajo aparte en vez de una cabecera en `POST /import-cv` —esa ruta es síncrona y de cuerpo binario, sin sitio para el consentimiento en dos pasos y con riesgo de agotar la espera con modelos lentos—; **D2** el trabajo relee el `README.md` del borrador y extrae su sección «Sin situar», así se puede refinar cualquier borrador y el navegador no reenvía el CV; **D3** las propuestas se escriben en ese mismo informe (se sustituyen si se repite el refinado), igual que la CLI. En la pantalla: selector de proveedor, progreso, diálogo de consentimiento y las propuestas en la propia página.

## §7 Aplicar una propuesta al borrador (T-9.5)

Encargo del PO del 31-ago-2026: «el co-piloto propone, pero mover las líneas es manual». Hoy T-8.18 deja las
propuestas en el informe y aplicarlas es copiar y pegar. **D3 del Hito 9, aprobada por el PO**: un botón por
propuesta **mueve** esa línea a la sección propuesta, con confirmación explícita y registro en el informe. El
modelo sigue sin aplicar nada (C2): propone el modelo, aplica el botón, y solo lo que se le pide.

### §7.1 Qué exige cada sección del vocabulario

El vocabulario cerrado de `import map` tiene diez valores y el esquema maestro decide cuáles se pueden aplicar
con la línea sola. La línea nunca se completa por el código: lo que falta, lo pone la persona.

| Sección | De la línea sale | Falta | Destino |
| --- | --- | --- | --- |
| `habilidad` | `name` | — | `skills.csv` |
| `logro` | `text` | — | `achievements.md` |
| `resumen` | se añade a `personal.summary` | — | `profile.md` |
| `proyecto` | `name` | — | `projects/<slug>.md` |
| `certificacion` | `name` | — | `certifications.csv` |
| `descartar` | — | — | ningún fichero: sale de «Sin situar» |
| `idioma` | `name` | `level` (MCER) | `profile.md` |
| `contacto` | el valor | qué campo es (correo, teléfono, ubicación, enlace) | `profile.md` |
| `experiencia` | — | `company`, `role`, `dates.start` | `experience/<slug>.md` |
| `formacion` | — | `institution`, `degree` | `education/<slug>.md` |

Las seis primeras se aplican con un clic. Las cuatro últimas abren un formulario mínimo con la línea a la vista y
los campos que el esquema exige; sin completarlos no se aplica nada. `idioma` llega precargado cuando la línea
declara un nivel reconocible (`mapLanguageLevel`), que es lo que ya hace el importador determinista.

### §7.2 Cómo se aplica

Un solo camino, en el núcleo, compartido por la CLI y la API (C14): leer el borrador con `loadSources` —el mismo
cargador que valida `cv build --data`—, añadir la entidad al perfil, replanificar los ficheros con `planFiles` y
escribir **solo los que cambian**. Así el borrador que sale de aplicar una propuesta es, por construcción, un
borrador que valida: si la entidad nueva no cumpliera el esquema, la operación falla entera y no se escribe nada.

El informe se actualiza en la misma operación: la línea desaparece de «Sin situar» y de «Propuestas del
co-piloto», y aparece bajo **«## Aplicado»** con qué se movió, a qué sección y a qué fichero. Es el registro que
pide el encargo y lo que permite deshacerlo a mano.

### §7.3 Fuera de alcance

Deshacer desde la interfaz (el registro del informe y el historial de fuentes bastan para revertirlo a mano);
aplicar varias propuestas de una vez (una decisión por línea es justo lo que C2 pide); y editar la línea antes de
moverla, que es lo que hace el editor de fuentes una vez aplicada.

## §8 Importar desde LinkedIn (T-9.8)

Encargo del PO del 31-ago-2026: «a partir de la URL de LinkedIn que se descargue el CV, lo analice y lo use como
fuente». La URL **no** es viable y conviene dejar dicho por qué, con lo medido ese mismo día:

- El `robots.txt` de LinkedIn dice `User-agent: *` → `Disallow: /`, con un aviso explícito de que el acceso
  automatizado sin permiso está prohibido.
- Una URL de perfil responde 200, pero lo que llega es el **muro de acceso** con una vista pública recortada
  («Sign in» 21 veces, «Join now» 9), no el CV.

**Decisión del PO (31-ago)**: la vía es la **exportación oficial de datos** —Ajustes → Privacidad de datos →
Obtener una copia de tus datos—, que además es la de más fidelidad: LinkedIn entrega CSV **estructurados**, así
que no hay maquetación que adivinar y nada queda «sin situar».

### §8.1 Qué se lee

`cv import-linkedin <archivo.zip>` busca por nombre base (la exportación a veces los envuelve en una carpeta):

| Fichero | A dónde va |
| --- | --- |
| `Profile.csv` | nombre, titular, resumen, ubicación y enlaces |
| `Positions.csv` | experiencia (`Finished On` vacío = en curso) |
| `Education.csv` | formación |
| `Certifications.csv` | certificaciones |
| `Projects.csv` | proyectos |
| `Skills.csv` | habilidades |
| `Languages.csv` | idiomas, con los cinco niveles de LinkedIn traducidos a MCER |
| `Email Addresses.csv` | el correo marcado como principal |
| `PhoneNumbers.csv` | teléfono |

Las fechas (`Mar 2022`, `2013`) pasan por el mismo `parsePoint` que el importador de PDF, que ya entiende los
meses en inglés. Falta un CSV, no pasa nada: lo que no está, no aparece.

### §8.2 Por qué comparte camino con el importador de PDF

El módulo produce el **mismo `DraftProfile`** que `structureCv`, y la escritura del borrador es literalmente la
misma función (`writeDraft`, extraída de `import-cv.ts` en esta tarea). Así el destino, el nombre de la carpeta,
los permisos, el informe y la validación entidad a entidad son idénticos vengan de donde vengan los datos (C14),
y lo único propio de LinkedIn es el mapeo de columnas.

### §8.3 Fuera de alcance

Descargar desde la URL (§8, decidido); la exportación «completa» de LinkedIn, que trae decenas de CSV de
mensajes, anuncios y conexiones que no son un CV; y la pantalla web, que iría después con el mismo núcleo.
