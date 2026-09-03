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
   un `README.md` con el origen, la fecha y el informe de lo que no se pudo situar. Los `.md` del borrador NO
   llevan banner: el cuerpo tras el frontmatter es el resumen que lee el cargador y un comentario lo ensuciaría;
   la procedencia vive en el informe (`src/import/draft.ts`).
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

Descargar desde la URL (§8, decidido) y la exportación «completa» de LinkedIn: **descartada por el PO el
1-sep-2026**. Trae decenas de CSV de mensajes, anuncios y conexiones que no son un CV, tarda hasta 24 horas
frente a los diez minutos de la selección concreta, y **no aporta ningún dato que la selección no traiga** (los
nueve CSV que se leen están en las dos). Admitirla solo añadiría superficie y datos personales que no queremos
tocar. La pantalla web sí se hizo, con el mismo núcleo (§8.2).

## §9 El «Guardar como PDF» de un perfil de LinkedIn (B-13)

Un PDF exportado desde el propio LinkedIn no es un CV maquetado cualquiera: aplana **dos columnas** en un solo
flujo, así que la barra lateral (contacto y aptitudes) sale ANTES del nombre; escribe la **empresa arriba y el
puesto debajo**, al revés de «Rol · Empresa»; y su sección de educación lista pares centro/titulación **sin
ninguna fecha**. Medido sobre `Profile.pdf`: 0 formaciones, 0 habilidades, «Nombre pendiente», dos empleos
fundidos en uno, dos entradas sin empresa y 6 líneas sin situar.

**Se reconoce el DOCUMENTO, no la línea.** Es el punto que faltaba: a nivel de línea no hay marca que diga si
«picas rojas» es la empresa o el puesto —y por eso el orden no se tocaba—, pero a nivel de documento sí la hay.
Se exigen **dos señales independientes**: la URL del perfil (`linkedin.com/in/<slug>`) y el pie paginado que
LinkedIn escribe siempre. Con una sola no basta: un CV corriente que se limite a citar su LinkedIn no entra por
aquí, y se sigue leyendo con el lector general.

Verificado eso, cambian tres reglas y **solo** tres:

1. **El nombre** se identifica por el *slug* de su propia URL: la línea cuyas palabras contienen las del slug.
   Es comprobar, no adivinar. Si ninguna casa —una URL personalizada como `/in/devlucas` no dice el nombre—, **se
   vuelve al lector general** en vez de forzar un formato del que ya no estamos seguros. El titular y la
   ubicación son las líneas que siguen al nombre; la ubicación va al contacto, que es su sitio.
2. **La experiencia** se agrupa en «empresa / puesto / rango», que es lo que el formato garantiza. Lo que va
   entre la fecha de un empleo y la empresa del siguiente es el **cuerpo del empleo anterior**, que es donde
   LinkedIn lo escribe.
3. **La formación** se empareja por posición y **no se le inventa una fecha**: el esquema admite formación sin
   fechas, y eso es preferible a rellenar el hueco. Si la titulación trae el rango, o va en una tercera línea
   suelta, se aprovecha.

Además, «Contactar», «Aptitudes principales» y «Extracto» pasan al diccionario de títulos de sección: son las
palabras que LinkedIn escribe, y sin ellas su barra lateral acababa dentro del resumen.

Resultado sobre el mismo fichero: **6 experiencias con su empresa y su puesto, 3 formaciones, 3 habilidades,
nombre, titular, correo y ubicación, 0 avisos y 0 líneas sin situar**, y el borrador compila con `cv build
--data`. Los otros cinco CV del corpus dan exactamente lo mismo que antes.

**Y aun así, la recomendación no cambia**: para un perfil de LinkedIn, la vía buena es `cv import-linkedin` con
la exportación oficial de datos (§8). Son datos estructurados; esto es adivinar una maquetación, por bien que
salga.

## §10 Revisar los borradores y adoptarlos (T-9.19)

**El encargo del PO (2-sep)**: «he importado varios cvs pero no veo que se añada información sobre los
currículums, experiencias». No era un fallo: `import-cv` deja un **borrador** y ahí se quedaba. La tabla de
`--all` contaba lo que el borrador reconoció, no lo que entró en el perfil, y desde la web «Importar CV» solo
enseñaba el resultado de la importación que acababas de hacer: no había forma de volver a un borrador, verlo,
corregirlo ni llevártelo a `data/sources/`.

Lo que se añade es **la vuelta del camino**, no un importador nuevo: `cv drafts` en la terminal, la pantalla
«Borradores» en la web y `GET /api/v1/drafts`, `GET|PUT /api/v1/drafts/{nombre}/files/{ruta}` y
`POST /api/v1/drafts/adopt` en la API. El criterio vive entero en `src/app/drafts.ts` (C14).

### §10.1 Adoptar no es fusionar

`docs/portability.md` §1 deja el *merge* fuera por la ambigüedad de fusionar dos versiones de lo mismo, y **eso
sigue en pie**. Adoptar es otra cosa, y por eso entra:

- Se copia **la entrada que señalas**, tal cual, a un fichero **nuevo** de `data/sources/`. No se mezclan dos
  versiones de un empleo ni se elige por ti cuál vale.
- El id y el nombre de fichero se toman del borrador si están libres y, si no, se busca el primero que lo esté
  (`exp-acme`, `exp-acme-2`…). Se serializa con **los mismos serializadores** que `cv import`, así que lo
  adoptado es indistinguible de lo que ya tenías.
- Antes de tocar el disco se valida el perfil **entero** que quedará: si no valida, no se escribe nada.
- Cada fichero se escribe con la huella `*`, que **crea o falla**: una adopción no puede pisar una fuente tuya.
  Deshacerla es borrar el fichero.
- Solo se adoptan las secciones en las que **un fichero es una entrada** (`experience/`, `education/`,
  `projects/`). `skills.csv`, `certifications.csv` y `achievements.md` juntan muchas entradas en un fichero, así
  que adoptarlas exigiría reescribir un fichero que ya es tuyo: otra tarea, con otras garantías.

### §10.2 Los duplicados se enseñan, no se resuelven

Con seis CV de la misma persona, la misma experiencia aparece seis veces y **cada CV se contradice con los
demás**: Baser Lugo empieza en 2011-04 en un CV y en 2010-10 en otro; medio corpus trae la empresa y el puesto
intercambiados; un PDF espaciado letra a letra llega como `B A S E R L U G O`, y otro con mojibake. Fusionar
eso automáticamente produce basura, así que el producto **agrupa y pregunta**: enseña el grupo con todos sus
miembros y su procedencia —incluida la entrada que ya esté en `data/sources/`— y eliges tú. Ninguna casilla
viene marcada.

Dos entradas de la misma sección van al mismo grupo si son de la **misma organización**, **sus periodos
coinciden** y **sus palabras se parecen**. Cada regla salió de un fallo medido sobre el corpus real:

| Regla | Por qué |
| --- | --- |
| «Empresa pendiente» / «Centro pendiente» no cuentan como palabras | Es la marca de que el dato falta. Contarla emparejaba entre sí las siete formaciones de un mismo CV y las encadenaba en un grupo de veinticuatro. |
| Un grupo son las entradas que se parecen **a la primera**, no en cadena | Encadenando, «C. S. Administrador de Sistemas» y «C. S. Desarrollo de Aplicaciones Web» acababan juntas por compartir el nombre del instituto. |
| Siembran primero las entradas **con fechas** | Una entrada sin fechas empareja con cualquier periodo: de semilla se arrastra medio corpus. |
| El solapamiento se mide contra la **media geométrica** de los dos periodos, no contra el más corto | Contra el más corto, contener puntúa siempre 1 y un empleo de «2006–2009» se tragaba los tres cursos de tres meses que caen dentro. |
| Solaparse no basta: hace falta la mitad | «Graduado Escolar 1986–1993» y «Bachillerato 1993–1997» comparten un año y son dos cosas distintas. |
| Un texto espaciado letra a letra se compara **buscando las palabras dentro de la cadena pegada** | El PDF perdió la frontera entre palabras (B-10, B-14): comparar palabra a palabra da 0. |
| Empresa y puesto se comparan **juntos**, sin distinguir cuál es cuál | Medio corpus los trae intercambiados y no hay señal fiable para saberlo (B-13). |
| Pero la **empresa de cada una tiene que reconocerse en la otra** | Dos puestos parecidos en empresas distintas no son el mismo empleo (B-20). Se busca en **todo el título** de la otra, no contra su campo `company`, porque medio corpus los trae intercambiados: lo que se exige es que la empresa esté, venga en el campo que venga. Si a alguna **no se le conoce** («Empresa pendiente»), no se descarta nada. |

En el nombre de una organización cuentan hasta las palabras de tres letras —«IBM» y «SAP» son el nombre
entero, y descartarlas por cortas dejaría a las dos entradas sin identidad—, y se caen las iniciales sueltas
cuando el nombre trae además palabras de verdad: «I.E.S Muralla Romana» se busca por «muralla romana», porque
otro CV lo escribe «ies muralla romana» de una pieza.

**Medido sobre el corpus del PO** (8 borradores, 158 entradas): 27 grupos, uno por empleo o titulación real.

**B-20 (arreglado el 3-sep, encontrado por el PO sobre sus propias fuentes)**: sin la condición de la empresa,
«Desarrollador / Administrador · Servigasa Special Jobs» y «Desarrollador/Administrador · Picas Rojas»
compartían la mitad de las palabras de la más corta —las del **puesto**— y solapaban fechas, así que caían en
el mismo grupo. Y como un grupo se forma **contra su semilla**, ese emparejamiento falso además **robaba** el
miembro al grupo verdadero: las dos entradas de Picas Rojas, que sí eran la misma, se quedaban sin agrupar.
Salían dos empresas mezcladas donde no había nada y dos empleos donde había uno repetido. Sobre el corpus del
PO: de 2 grupos (uno falso, uno bueno) a **3 grupos, uno por empresa**.

**Límite conocido y aceptado**: una entrada **sin fechas** puede caer en un grupo con el que solo comparte el
nombre del centro. Se prefiere así porque agrupar de menos esconde duplicados, y agrupar de más solo cuesta una
mirada: el grupo es una pregunta, no una fusión. Queda con su prueba en `tests/app/drafts.test.ts`.

### §10.3 Editar el borrador

Un borrador se edita **como se edita una fuente**, por la misma función (`writeSource`): escritura atómica, modo
0600 y `If-Match` con la huella que el cliente leyó. Para quien revisa es lo mismo —texto suyo que corregir
antes de adoptarlo—, y eso es justo lo que hace falta cuando el informe dice «experiencia sin empresa
reconocida: lleva "Empresa pendiente"». Corregir un borrador **no toca** `data/sources/`.

### §10.4 Fuera de alcance

- **Fusionar dos entradas en una** (tomar las fechas de un CV y los logros de otro). Se adopta una y se edita;
  el editor ya está.
- **Adoptar habilidades, certificaciones y logros** (§10.1): exige reescribir un fichero existente.
- **Elegir por ti el «mejor» miembro de un grupo**. No hay forma honesta de saberlo, y fingirla sería peor que
  no ofrecerla.
- **Borrar borradores** desde el producto. `import/` es del usuario; se borra con `rm`.

### §10.5 Elegir la carpeta en vez de escribir su ruta (T-9.21)

**El encargo del PO (2-sep)**: «al importar CV, cuando selecciono carpeta quiero poder seleccionar la carpeta
sin tener que escribir la ruta».

Un selector de directorio del navegador **no sirve aquí**, y no es un detalle de implementación: la web entrega
los ficheros de la carpeta elegida, nunca su sitio en el disco (`webkitdirectory` y `showDirectoryPicker` dan
contenido, no rutas). Y esta importación la hace el **servidor**, leyendo el espacio de trabajo, que es lo que
permite la tabla comparativa y lo que la iguala con `cv import-cv <carpeta> --all` (C14). Así que las carpetas
las ofrece quien sí conoce las rutas: el servidor.

`GET /api/v1/import-cv/folders` recorre el espacio de trabajo y devuelve **las carpetas que tienen CV dentro**,
con cuántos. Se elige sabiendo lo que se importaría, y no se puede pedir una carpeta que no traería nada. Tres
niveles como mucho y 400 carpetas como tope: explorar no puede costar un minuto. Quedan fuera `node_modules`,
las ocultas, las copias `.bak` y las del propio producto —`import/` son borradores en Markdown, `data/` son tus
fuentes y `output/` son los CV que este programa acaba de generar—.

Con una sola candidata queda puesta y solo hay que pulsar. **La lista no es una jaula**: el campo de ruta sigue
ahí para una carpeta que no esté, y si el recorrido falla la pantalla cae a él sola.

## §11 Duplicados en las propias fuentes (T-9.20)

**El encargo del PO (2-sep, tras adoptar de varios borradores)**: «necesito una herramienta para detectar
duplicados en mis fuentes y poder solventarlos». Adoptar entrada a entrada de varios borradores (§10) es justo
lo que los crea: el mismo empleo entra dos veces desde dos CV que lo cuentan distinto.

`cv duplicates` los detecta y `cv duplicates resolve` los resuelve; en la web, la pantalla **Duplicados**. En la
API, `GET /api/v1/duplicates` y `POST /api/v1/duplicates/resolve`.

### §11.1 Detectar es la misma regla, aplicada a otra cosa

No hay un segundo criterio: se reutiliza `src/app/duplicates.ts`, el mismo que agrupa las entradas de los
borradores (§10.2), aplicado a `data/sources/` contra sí mismo. Por eso el módulo salió de `drafts.ts` en esta
tarea: qué es «la misma cosa» no es de los borradores.

**Lo importante es lo que NO marca.** Un mismo empleo contado por periodos —una entrada por etapa, que es la
forma normal de enseñar una promoción— comparte empresa pero no fechas, y la regla del solapamiento lo respeta.
Medido sobre el espacio de trabajo real: de 22 entradas, **2 grupos** (dos formaciones repetidas al adoptar) y
**cero** falsos positivos sobre las cuatro entradas de Life5 partidas por periodo. Sería el peor falso positivo
posible: son la carrera de la persona.

### §11.2 Resolver: quedarse con una y absorber lo que le falta

La forma la decidió el dato real. En los duplicados que salen de importar, **cada mitad tiene lo que a la otra
le falta**: una trae las fechas y `Centro pendiente`, la otra el centro de verdad y ninguna fecha. Borrar
cualquiera de las dos pierde información, así que resolver es *quedarse con una y absorber de las otras solo lo
que le falta*:

| Regla | Por qué |
| --- | --- |
| Un valor que la elegida ya tiene **no se pisa nunca** | Quien eligió la entrada eligió sus datos. Si la otra trae uno distinto, se **dice** y se descarta: no se pierde en silencio. |
| «Empresa pendiente» y «Centro pendiente» cuentan como **ausencia** | Son la marca que escribe el importador cuando NO reconoció el dato. Tratarlas como texto dejaría el hueco sin rellenar, que es el caso real. |
| El periodo va **entero** | Un `end` ausente significa «en curso», que es un dato y no un hueco: no se rellena desde otra entrada. |
| Las listas se **añaden sin repetir** | Logros, tecnologías y etiquetas se comparan normalizadas; un logro absorbido entra con un id libre. |
| Antes del disco, se **valida el perfil entero** | Unas fuentes que `cv build` rechaza son peor que un duplicado. |

### §11.3 Borrar una fuente, y poder deshacerlo

Resolver **borra** el fichero de la entrada absorbida, que es lo que el producto no sabía hacer. Se apoya en el
histórico de fuentes (T-8.10), no en una copia nueva: lo escrito y lo borrado quedan en
`output/historial-fuentes/<id>/`, y `cv history restore <id> <ruta>` lo devuelve. Un solo mecanismo de deshacer
para todo (C9).

Hizo falta un arreglo pequeño para que fuera cierto: `restoreSourceVersion` fallaba si la fuente **ya no
existía**, porque leía su versión actual sin contemplar que faltara. Ahora una fuente borrada se restaura igual;
su versión actual es «no existe», que es exactamente lo que hay que guardar para poder deshacer la restauración.
Un fallo de lectura que no sea «no existe» sigue siendo un error.

### §11.4 Fuera de alcance

- **Resolver solo**: la elección de cuál se queda es siempre de una persona. Cuando dos entradas se contradicen
  no hay forma honesta de saber cuál lleva razón.
- **Fusionar dos textos** (juntar dos resúmenes en uno). Se absorbe el que falta o se conserva el que hay; para
  redactar está el editor.
- **Duplicados de habilidades, certificaciones y logros transversales**: viven en ficheros compartidos
  (`skills.csv`, `certifications.csv`, `achievements.md`) y su unicidad ya la vigila el esquema por id.

## §12 Importar un MAC de Manfred (T-9.22)

**El encargo del PO (2-sep)**: «añade importador desde Manfred con JSON», con su propio MAC como caso de prueba.

El **MAC** («Manfred Awesome CV», <https://github.com/getmanfred/mac>) es el JSON que Manfred deja exportar del
perfil. Como la exportación de LinkedIn (§8), trae los datos **ya estructurados**: no hay maquetación que
adivinar, se leen los campos y se rellena el mismo `DraftProfile` que produce el importador de PDF, así que todo
lo de aguas abajo —validación entidad a entidad, ficheros del borrador, informe, duplicados, adopción— sirve sin
cambios. **Nada queda «sin situar»**, porque el fichero dice a qué sección pertenece cada dato.

`cv import-manfred <fichero.json>`, `POST /api/v1/import-manfred` y, en la web, la opción **«Un MAC de Manfred
(.json)»** del selector «Origen» de *Importar CV*.

### §12.1 El mapeo

| MAC | Perfil |
| --- | --- |
| `aboutMe.profile.name` + `surnames` | `fullName` |
| `.title` / `.description` | titular / resumen |
| `.location` (`municipality`, `region`, `country`) | ubicación |
| `.contact.contactMails[0]` / `.phoneNumbers[0]` | correo / teléfono |
| `aboutMe.relevantLinks[]` + `careerPreferences.contact.publicProfiles[]` | enlaces, sin repetir |
| `experience.jobs[].roles[]` | **una experiencia por rol**, con la empresa y la ubicación de la organización |
| `roles[].challenges[]` (y sus `actions`) | logros de esa experiencia |
| `roles[].competences[]` | tecnologías de esa experiencia |
| `experience.projects[]` | proyectos, con su enlace y su descripción |
| `knowledge.studies[]` con `studyType: certification` | certificaciones |
| el resto de `knowledge.studies[]` | formación |
| `knowledge.hardSkills[]` + `manfredSpecificData.mainStackTechs` | habilidades, sin repetir |
| `knowledge.softSkills[]` | habilidades de categoría `soft` |
| `knowledge.languages[]` | idiomas, con los cinco niveles traducidos al MCER |

Tres decisiones que no son obvias:

- **`location.notes` se descarta a propósito.** Manfred la rellena con la traza de su autocompletado
  («Autocompleted using Google Maps API (id: …)»), que no es una ubicación sino cómo se obtuvo.
- **Un empleo con varios roles son varias entradas.** En el perfil cada puesto tiene sus fechas y sus logros;
  fundirlos perdería la promoción.
- **Las habilidades duras entran sin categoría.** MAC dice de cada una un `type` («technology») que no es
  ninguna de las categorías del perfil, así que se dejan en `other` para clasificarlas a mano. Las blandas sí
  van a `soft`: ahí la equivalencia es exacta.

### §12.2 Lo que no cabe, se dice

Un MAC guarda cosas que este perfil no modela: los puestos y el tipo de contrato que buscas, tu salario, el
estado de búsqueda, las recomendaciones, los *interesting facts* y los artefactos públicos. **No se les busca un
hueco forzado ni se callan**: encabezan el informe del borrador como «no importado (el perfil no lo guarda)»,
para que se vea qué se quedó en Manfred.

Dos avisos más, medidos sobre el MAC real del PO:

- **Fechas de formación rellenadas de una sentada.** Manfred pone el día en que lo escribiste si no recuerdas
  cuándo cursaste. Cuando **varios estudios comparten la fecha de inicio y ninguno tiene fin** se avisa —en el
  MAC del PO, tres con «2024-12-20»—. La fecha **no se toca**: es lo que dice el fichero.
- **Una ubicación que se queda en el país.** El perfil exige `city`; si el MAC no da municipio, ahí acaba el
  país, y se dice para que se ajuste en `profile.md`.

### §12.3 Tolerante, y sin red

El `$schema` que el fichero declara **no se descarga**. Lo que no se reconoce se ignora en vez de tirar la
importación, y una versión distinta de la 0.5 se avisa y se importa igual. Solo se exige que el fichero **sea**
un MAC —`settings.MACVersion`, un `$schema` de MAC o alguna de sus secciones—, porque importar otro JSON
cualquiera daría un perfil vacío sin decir por qué. Un `cv import-cv` con un JSON tampoco dice ya «cabecera
desconocida»: dice por dónde entra.

**Medido sobre `my-mac-from-manfred.json`**: 6 experiencias, 3 formaciones, 41 habilidades, 2 idiomas, **0
degradado y 0 sin situar**, y `cv build --data import/lucas-nunzi` en verde.

### §12.4 Fuera de alcance

- **Exportar a MAC.** Es la tarea inversa y tiene su propia decisión: el esquema canónico del producto es el
  suyo (`docs/portability.md` §1).
- **Descargar el `$schema` para validar**: implicaría red en una orden que hoy no la tiene, y la lectura
  tolerante ya cubre lo que hace falta.
- **Los niveles de habilidad de MAC** (básico/intermedio/alto/experto): se avisa de que no entran, porque el
  nivel de una skill es de las cosas que conviene repasar a mano.
