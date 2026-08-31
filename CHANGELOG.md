# Registro de cambios

Todos los cambios notables de Chameleon CV se documentan aquí. El formato sigue [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/) y las versiones, el [Versionado Semántico](https://semver.org/lang/es/). La sección de cada versión es la fuente de las notas de su release en GitHub: el flujo de release la extrae con `npm run release:notes -- <versión>` y se detiene si no existe, no lleva fecha o está vacía.

## [1.11.0] - 2026-08-31

### Añadido

- **Botón «Refinar con el co-piloto» en la pantalla web de importación** (T-8.18): cuando un borrador deja líneas sin situar, `Perfil → Importar CV` ofrece refinarlo con el co-piloto. Es un trabajo del sistema de trabajos (`POST /api/v1/jobs/import-map`) con progreso, selector de proveedor y el mismo puente levadizo que el resto (403 sin permiso de remotos, 409 con el coste estimado): relee el `README.md` del borrador, envía **solo** sus líneas sin situar seudonimizadas, verifica cada propuesta por código y deja el informe al día **sin aplicar nada**. Sirve para cualquier borrador de `import/`, no solo para el recién subido.

### Corregido

- El informe del borrador en la pantalla «Importar CV» estiraba la tarjeta a lo ancho (usaba una clase de estilo inexistente): ahora ajusta y desplaza dentro de su caja como el resto de bloques de texto de la interfaz.

## [1.10.0] - 2026-08-31

### Añadido

- **Diez temas más para los PDF** (T-8.16, aprobada D1–D3): el catálogo pasa de 27 a **37 temas** (13 organizaciones + 24 estilos). Organizaciones nuevas: `sidebar-left` (columna lateral con contacto, habilidades, formación, certificaciones e idiomas), `two-column-dense` (dos columnas equilibradas para trayectorias largas), `ats-plain` (una columna sin filetes ni tablas, una sola tipografía: el formato más digerible para los lectores automáticos) e `impact-first` (abre con tres cifras de impacto tomadas de los logros anclados). Estilos nuevos: `serif-editorial`, `slate`, `terracotta`, `mono-grid`, `midnight` y `gazette`. Todos compilan con Typst real en español e inglés con el texto extraíble, tienen ficha e imagen en la galería y salen en `cv theme list` y en el selector de la interfaz web.
- Conmutador de proveedores remotos desde la configuración (T-8.17, opción A aprobada): nueva tabla `[serve]` en `cv.toml` con `allow_remote`, que **`cv serve` lee al arrancar**; Ajustes gana un botón para permitirlos o prohibirlos (`PUT /api/v1/config/serve`, con `If-Match` como `/config/llm`) que avisa de que **se aplica al reiniciar** y señala cuándo el fichero pide algo distinto de lo vigente. La bandera de la orden manda siempre sobre el fichero, en ambos sentidos (`--allow-remote` / `--no-allow-remote`). La frontera C3 se mantiene: un servidor arrancado sin permiso de salida no puede concedérselo a sí mismo en caliente.
- Importación de CV, fase 2 (T-8.4b F2): `cv import-cv --copilot` pide al modelo que **proponga** a qué sección pertenecen las líneas que quedaron sin situar —seudonimizadas, con un **vocabulario cerrado** de diez secciones y verificación por código de cada propuesta (se rechazan secciones inventadas, líneas que no se enviaron y repetidas)—; las propuestas se listan en el `README.md` del borrador y **nunca se aplican solas**. Con un proveedor remoto se pide antes el consentimiento de coste (`--yes` para scripts). Nuevos **avisos de calidad de la extracción** en el informe: escaneo con OCR de baja calidad (citando fragmentos), plantilla sin rellenar, texto demasiado corto (imagen sin capa de texto) y «ninguna entrada reconocida». Guía nueva del portal: «Importar un CV que ya tienes».
- Proveedor remoto **Gemini** registrado como `pending-verification` (T-8.15, aprobado D1–D5): API compatible de Google con **rutas propias sin `/v1`** (campo `paths` por proveedor, aditivo), modelos `gemini-2.5-flash` y `gemini-2.5-pro` sin tareas recomendadas hasta evaluarlos en español, clave `CHAMELEON_GEMINI_API_KEY`, y **aviso permanente de datos** en `cv llm status`, en Ajustes y dentro del consentimiento de coste de cada trabajo (el plan gratuito de Gemini usa las peticiones para mejorar productos de Google). No se puede seleccionar hasta la verificación al alta (§9/§11 de copilot-providers).

### Cambiado

- Importación de CV, precisión (T-8.4b F2, medida con cuatro CV rellenos de terceros): los títulos de sección admiten **matices** («Relevant Experience», «Otra formación») y su variante con letras espaciadas; una **cabecera espaciada desconocida** («C A M P U S  I N V O L V M E N T») cierra la sección en curso en lugar de colar su contenido en la anterior; la formación abre con una **fecha de graduación suelta** cuando cierra la línea tras un separador (con aviso de que se toma como inicio); y las habilidades ya no se parten por las comas dentro de paréntesis o corchetes. En el CV de referencia, el reconocimiento pasa de 0 experiencias y 4 formaciones falsas a las 2 experiencias y 1 formación reales.
- `cv llm status`: la línea de modelos ya no deja un «; » colgante cuando un modelo no tiene tareas recomendadas, y un plan gratuito sin cuota publicada se describe entre paréntesis como los de pago.

## [1.9.0] - 2026-08-31

### Añadido

- Ofertas en la interfaz web (T-8.5 S2): en Generar, la pestaña «Del espacio» ofrece un selector con las ofertas de `offers/` (`GET /api/v1/offers`, con «Recargar» y ruta a mano como alternativa) y la pestaña nueva «URL» descarga una oferta https con consentimiento en dos pasos (`POST /api/v1/offers/fetch`: 403 sin `--allow-remote`, 409 `consent-required` con `estimateId` de un solo uso; una petición sin cookies, 2 MiB) mostrando el texto extraído editable con su procedencia y avisos, y «Guardar en offers/…» (`POST /api/v1/offers`, cabecera de origen, 409 salvo `replace`). El plan del Co-piloto muestra ahora el **modelo** efectivo y si el **razonamiento** va pedido (y que las tareas con esquema lo ignoran).
- Ofertas desde URL (T-8.5 S1): `cv analyze-offer <url>` y `cv generate-cv -f <url>` aceptan una URL `https` con `--allow-remote` y confirmación por petición (`--yes` para scripts): una sola descarga sin cookies (máximo 2 MB, 15 s, guardia SSRF, redirecciones re-validadas), extracción con procedencia —JSON-LD `JobPosting` (también en listas y `@graph`), contenido principal cuando la descripción es un resumen, `og:*` como reserva— y avisos de páginas que se pintan con JavaScript; `--save-offer [ruta]` guarda el texto en `offers/` con cabecera de origen (`--replace` para sustituir) y `cv analyze-offer` sin argumento (o con `--list`) lista `offers/**`. Calidad medida con un corpus versionado de nueve páginas (seis sintéticas y tres réplicas de LinkedIn/Jobgether/Manfred) con umbrales fijados antes de medir.

- Importar un CV existente (T-8.4b, núcleo): `cv import-cv <fichero.pdf|docx>` convierte un CV ya maquetado en un **borrador de fuentes** en `import/<nombre>/` —nunca sobre `data/sources/`— con el orden de lectura reconstruido desde la maquetación del PDF (columnas laterales, tablas con fechas al margen; worker contenido con límites) o el texto de `word/document.xml` (DOCX, zip contenido), estructurado determinista con procedencia por línea y validación entidad a entidad: lo que no cumple el esquema se degrada al `README.md` del borrador con su motivo (nunca se inventa). `--name` y `--replace`; el borrador se valida con `cv build --data import/<nombre>`. En la interfaz web, la pantalla **Importar CV** (grupo Perfil) sube el fichero a `POST /import-cv` (cuerpo binario, hasta 10 MiB) y muestra el resumen, los avisos y el informe; un borrador existente pide confirmación para sustituirse (409).

### Cambiado

- Rematada la experiencia de ofertas y co-piloto (T-8.5 S3, parte 1): la guía «Adaptar el CV a una oferta» y el tutorial «Tres ofertas» cubren la URL y `offers/`; la guía de la API documenta `GET/POST /offers*` y `POST /import-cv` con `curl`; en Ajustes, el bloque de proveedores externos dice dónde se eligen de verdad (Co-piloto → Trabajos); y en Generar los selectores «Solo estas skills / Solo estos proyectos» viven agrupados en un plegable «Afinar el contenido» con el resumen de lo elegido.
- **Groq disponible**: verificado al alta el 30/31-ago-2026 (protocolo §9 de `docs/copilot-providers.md`: clave sin eco, estado con cuota publicada, tanda real con el banco y cabeceras de cuota correctas) y activado en el registro; se selecciona por orden con `--provider groq` (canon C3).

### Arreglado

- Importar un CV: los `.md` del borrador salen **limpios** — el banner HTML de procedencia se colaba en el `summary` que lee el cargador (ensuciaba el artefacto compilado y podía empujarlo por encima del límite de 3000 caracteres, rompiendo `cv build --data`). La procedencia vive ahora solo en el `README.md` del borrador. Verificado con un corpus público de siete PDF de terceros (guías y plantillas universitarias, EN/ES): 7/7 borradores validan.
- Modelos remotos que razonan (gpt-oss-120b en Groq): con el techo de salida de la tarea (600 tokens) el razonamiento agotaba el presupuesto y la generación llegaba vacía (HTTP 400 `json_validate_failed`). El registro declara ahora un **suelo de tokens de salida** (4000 para gpt-oss-120b) y las tareas y los estimadores del consentimiento elevan el techo hasta él: lo que se acepta es lo que se envía.
- Portada del portal: la captura de la interfaz se solapaba con el título (la imagen del hero vivía en un contenedor absoluto de altura fija del tema, con márgenes negativos al apilarse): ahora fluye bajo el texto con su anchura contenida, en todos los anchos.
- Las tandas del co-piloto se detienen al primer `quota-exceeded` también en «sugerir etiquetas» (como ya hacía «mejorar logros»): sin reintentos (C11), el resto del lote no se quema y el mensaje conserva el «reintenta en Xs» del proveedor.
- Co-piloto local: con `[llm] think = true`, las tareas con esquema JSON estricto (todas) fallaban con «el modelo no devolvió JSON válido»: el razonamiento consumía todo el presupuesto de tokens y el contenido llegaba vacío. Las peticiones con esquema ya no piden razonamiento nunca (el conmutador queda para futuras tareas de texto libre); la casilla de Ajustes y la guía lo explican.
- Co-piloto local: las peticiones a Ollama piden una ventana de contexto de 16384 tokens (`options.num_ctx`); sin ella Ollama carga el modelo con su defecto (4096) y las propuestas con fuentes largas fallaban con «HTTP 400 … exceeds the available context size». Configurable con `[llm] context` en `cv.toml` o `CHAMELEON_LLM_CONTEXT` (entero en [1024, 131072]); «Ajustes» conserva la clave al guardar.

## [1.8.1] - 2026-08-30

### Cambiado

- Runtime de Ollama adaptativo (T-8.14, encargo del Director): `cv llm status`, `GET /api/v1/llm/runtime` y «Ajustes» exponen las dos vías de arranque (binario `ollama` y Docker) con su motivo y el plan («se usará docker: sin binario ollama (…); se usa Docker: Docker 27.x»); `[llm.runtime] runner` y `CHAMELEON_LLM_RUNNER` pasan a ser preferencias con respaldo (si la vía preferida no está, se usa la otra con aviso; `--runner` y `runner` en la API siguen siendo estrictos); si el arranque falla y la otra vía está disponible, `cv llm up` la intenta a continuación y, si ambas fallan, el error lista los dos motivos. Ajustes muestra la vía y el motivo en el panel «Ollama local» y en el consentimiento de descarga.
- Portal, sprint S4 del rediseño (T-8.6, `docs/gui-design/pantallas.md` §8–§9): tema de VitePress sin la fuente descargada (solo fuentes del sistema) y con los tokens del sistema visual de la aplicación en claro y oscuro; portada nueva compuesta con las ranuras del tema —chip «Local y soberano», los tres comandos, captura real de la interfaz, bloques «Qué hace / Qué no hace», «Tres caminos» y «Temas» con miniaturas reales de la galería—, pie «MIT · sin telemetría · es-ES» y la versión en la navegación; páginas interiores con avisos, títulos y navegación anterior/siguiente pulidos. Pruebas: contraste AA de los tokens (`tests/docs/portal-tokens.test.ts`) y E2E sobre el sitio construido (`npm run docs:e2e`: la portada responde sin desplazarse en 1440×900, modo oscuro AA y ninguna petición fuera del sitio), también en el flujo de Pages.

## [1.8.0] - 2026-08-30

### Añadido

- Tres organizaciones y tres estilos más (T-8.12, parte 3; veintisiete temas): `education-first` (formación y certificaciones primero, después habilidades, proyectos y la experiencia), `achievements-first` (los logros del perfil y el primero de cada puesto en un panel inicial, cronología corta después), `unified-timeline` (puestos, formación, certificaciones y proyectos en un solo eje temporal ordenado por fecha), `swiss` (estilo tipográfico internacional con los títulos en una columna izquierda), `newspaper` (mancheta y experiencia a dos columnas en serif) y `pastel` (paleta lavanda/menta). La vista estructurada de las plantillas añade las fechas ISO (`experience[].start/end`, `projects[].start/end`, `education[].start/end`, `certifications[].dateIso`).
- Seis estilos Typst más (T-8.12, parte 2; `kind = "style"`, veintiún temas en total): `elegant` (serif Libertinus, nombre centrado en versalitas, doble filete y títulos entre filetes), `bold` (nombre en acento con barra lateral, secciones en mayúsculas con subrayado grueso, periodos en pastilla), `compact-grid` (periodo y ubicación en una columna estrecha a la izquierda de cada entrada, habilidades y formación en dos columnas), `monochrome` (solo negro y grises, para imprimir), `warm` (paleta terracota/ocre/crema, cabecera sobre panel y títulos como etiquetas redondeadas) y `europass-like` (estructura tabular al estilo europeo: apartado y periodo en la columna azul de la izquierda). Galería, `cv theme list` y el arnés (`typst`) los incluyen.
- Catálogo de modelos locales (T-8.13): `cv llm models [--json]` y `GET /api/v1/llm/models` describen cinco modelos (`qwen3:8b` —nuevo defecto—, `qwen2.5:7b-instruct`, `deepseek-r1:8b`, `gpt-oss:20b`, `qwen3:4b`) con familia, razonamiento (ninguno, conmutable o siempre), tamaño, RAM mínima, licencia, tareas recomendadas, espejo en Hugging Face y evidencia, más lo que hay descargado en el Ollama configurado. `cv llm up --source ollama|huggingface`: si el registro de Ollama falla y el catálogo tiene espejo, se descarga el espejo (`hf.co/<repositorio>:<cuantización>`) y se crea el alias corto. `[llm] think = true` (o `CHAMELEON_LLM_THINK=1`) pide razonamiento a los modelos que lo conmutan (Qwen3, gpt-oss); apagado por defecto. «Ajustes» elige el modelo en un selector con el catálogo (o un nombre libre), tiene la casilla de razonamiento y el consentimiento de descarga cita el espejo.
- Seis organizaciones del CV como temas Typst (T-8.12, parte 1; `kind = "organization"`): `chronological` (el periodo en una columna fija a la izquierda de cada entrada), `functional` (competencias por especialidad y logros consolidados con su empresa primero; trayectoria en una línea por puesto), `hybrid` (competencias clave en un panel sombreado y después la cronología completa), `skills-first` (matriz de skills por categoría con nivel y años), `project-portfolio` (cada proyecto en una tarjeta con tecnologías en etiquetas; experiencia en una línea) y `one-page` (una sola página con recortes visibles «(+N)»). Los nueve temas anteriores se declaran `kind = "style"`; `cv theme list`, la galería del portal y el selector de Generar agrupan por organización y estilo, y el resumen de `cv theme list` cuenta cada grupo.
- La vista estructurada que reciben las plantillas Typst añade `skillGroups[].items[]` (`name`, `level`, `years`) y las etiquetas `labels.level`, `labels.years` y `labels.levels` (niveles de skill traducidos) para matrices de competencias.
- Histórico de versiones de las fuentes (T-8.10): cada `cv improve apply` (y cada restauración) guarda el fichero entero tal como estaba en `output/historial-fuentes/<entrada>/<ruta>` con `cambio.json` e `index.json`; `cv history [--json]`, `cv history show <entrada|latest> <ruta>` y `cv history restore <entrada|latest> <ruta>` (restaurar deja a su vez la versión actual en el histórico); API `GET /history`, `POST /history/version`, `POST /history/restore`; en la interfaz, Fuentes muestra «Historial de esta fuente» con las diferencias frente al editor y «Restaurar esta versión», y Revisiones enlaza la entrada creada. Desaparecen las copias `.bak` de `data/sources/`.
- Generar con la adecuación de la oferta (T-8.9): `cv analyze-offer` (y `POST /analyze-offer`) sugieren la especialidad real que más cubre la oferta (`suggestedSpecialty`); al generar con oferta, los ítems que demuestran algún requisito no se recortan por los límites de cantidad (`report.kept`, `--explain` los lista; `--no-keep-evidence` / `keepEvidence: false` lo desactivan); en Generar, la especialidad sugerida rellena el paso 1 si estaba vacío y el panel de adecuación ofrece «Generar con esta adecuación».
- Arrancar y parar el Ollama local desde cv (T-8.8): `cv llm up [--model] [--runner native|docker] [--no-pull] [--json]` y `cv llm down [--json]`, `GET|POST /api/v1/llm/runtime` (arranque como trabajo `ollama-up` seguible por SSE) y el panel «Ollama local» en Ajustes con consentimiento antes de descargar el modelo. Runners `native` (`ollama serve` como proceso hijo; pid y registro 0600 en la caché de usuario) y `docker` (contenedor `chameleon-ollama` con la imagen fijada por digest, publicada solo en loopback, volumen conservado al parar). Solo se para lo que arrancó cv; deshabilitado dentro de la imagen de Compose (`CHAMELEON_CONTAINER=1`); sin shell y con el nombre del modelo validado. `cv llm status` añade la línea `runtime: …`.

### Cambiado

- Modelo local por defecto: `qwen3:8b` en lugar de `qwen2.5:7b-instruct` (T-8.11, evaluación en `docs/qwen3-evaluation.md` §4: 16/16 comprobaciones del arnés de IA en 1,29× el tiempo y 5 de 6 reescrituras de `improve` aceptadas por la verificación C2 frente a 0 de 6). El anterior sigue en el catálogo (`cv llm models`) y se elige con `--model` o `[llm] model`.
- Interfaz web, sprint S3 del rediseño (T-8.6): **Co-piloto** (tareas y proveedores como opciones en tarjeta con descripción y comando, límites de la ejecución, panel «Qué sale y a dónde» calculado antes de lanzar, «Lanzar trabajo» fijo, lista de trabajos con recuento, progreso con barra, resultado y enlace a la revisión; consentimiento remoto con destino, envío, escritura y coste), **Revisiones** (lista con subtítulo, barra pegajosa, ítems con antes/después, propuestas marcables y rechazadas tachadas, plan con borde de acento y el fichero completo antes y después de cada fuente con las líneas cambiadas resaltadas, vacío que lleva al Co-piloto), **Ajustes** (una columna de 940 px, runner e imagen de `[llm.runtime]`, proveedores externos como fichas con modelos, cuota publicada y viva con barra, lista blanca de hosts) y la **puerta de sesión** (pantalla centrada con el comando `cv serve`; explica la caducidad cuando un 401 devuelve a ella).
- Ollama con Qwen3 (T-8.11): el proveedor envía `think: false` a los modelos `qwen3*` y tolera un bloque `<think>` residual antes del JSON.
- `[llm.runtime]` en `cv.toml` (`runner = "native" | "docker"`, `image`) para `cv llm up` (T-8.8, D1/D2): el entorno y `--runner` mandan sobre el fichero; «Ajustes» muestra y guarda los dos campos y ahora conserva `[llm.models]` al guardar (`GET /config/llm` expone la tabla leída en `llm.settings.values`).
- Interfaz web, sprint S2 del rediseño (T-8.6): **Estado** (rejilla de cuatro tarjetas con badges, especialidades como chips, tabla de temas instalados con origen y estado, comprobación del co-piloto, vacío con `cv init` copiable, esqueleto de carga, incidencias con «Abrir la primera en Fuentes»), **Fuentes** (dos columnas a toda altura: árbol con filtro, «+» y badges de incidencias por fichero, barra del editor con huella y «cambios sin guardar», pie con lenguaje, fin de línea, línea y columna; diálogo de conflicto con las dos huellas), **Generar** (formulario en tres pasos —especialidad con vista previa, oferta por pestañas Texto/PDF/Del espacio, salida en rejilla 2×2 con «Más opciones»—, barra de acciones fija, resultado con visor, adecuación con porcentaje y barra, tres columnas de términos e informe de decisiones plegable) y **Salidas** (tabla compacta con etiqueta de tipo y tamaño, visor enmarcado, vacío que lleva a Generar). Estado y Fuentes se cargan bajo demanda: el paquete inicial baja a 25,7 KB gzip.
- Interfaz web, sprint S1 del rediseño (T-8.6, `docs/gui-design/`): sistema visual nuevo (tokens claro/oscuro con contraste AA comprobado en las pruebas, clases `cv-*` de referencia), barra lateral con tres grupos (Perfil, Producir, Co-piloto) más el portal, plegable a iconos (persistente, forzada por debajo de 1024 px), cabecera de contexto presente en todas las pantallas (espacio de trabajo, chips de artefacto/Typst/co-piloto/remotos alimentados por una sola consulta, conmutador de tema claro/oscuro/sistema aplicado antes del primer render y «Apagar» con confirmación), diálogos con foco atrapado y `Esc`. La pantalla Estado ya no tiene su propio botón de apagar.

## [1.7.0] - 2026-08-30

### Añadido

- Cuatro temas Typst nuevos en la galería (T-8.7): `awesome` (estilo Awesome-CV: nombre en dos pesos, titular en versalitas de color, secciones con las tres primeras letras en acento, rejilla 2×2), `executive` (banking: logros destacados arriba, fila de competencias clave, impacto en negrita), `tech` (skills-first: habilidades y tecnologías como etiquetas monoespaciadas, contacto con URL visibles) y `timeline` (línea de tiempo con raíl y puntos); todos en una columna, sin iconos ni barras y sin fuentes nuevas.
- Historial de ofertas procesadas (`output/historial-ofertas.json`, huella del texto): `cv analyze-offer` y `cv generate-cv -f` avisan de si la oferta ya se procesó, cuándo y con qué CV; `POST /api/v1/offers/history` lo consulta sin efectos y `/analyze-offer` y `/generate` lo devuelven (`history`); Generar lo muestra al añadir la oferta (requisito del Director, 2026-08-30).
- Selección explícita de skills y proyectos al generar el CV: `cv generate-cv --skills <nombres o ids> --projects <nombres o ids>` (antes de los límites por cantidad; los desconocidos se avisan), `skills`/`projects` en `POST /api/v1/generate` y dos selectores múltiples en Generar alimentados por el perfil (requisito del Director, 2026-08-30).
- Modelos seleccionables por proveedor remoto en el registro (`src/llm/registry.ts`), con estado (`estable`/`preview`), tareas recomendadas y evidencia; Groq ofrece `openai/gpt-oss-120b` (por defecto: mejorar logros y resumir) y `qwen/qwen3.8-27b` (preview; sugerir etiquetas y sesiones gratuitas con más de una tanda al día, por sus 2 000 000 tokens/día). `cv llm status`, `GET /api/v1/config/llm` y Ajustes los muestran; se eligen con `--model` o `[llm.models]`. Groq sigue pendiente de la verificación humana al alta.

## [1.6.1] - 2026-08-30

### Corregido

- `cv theme install` fallaba en el **ejecutable publicado** (`chameleon-cv-1.6.0-linux-x64.tar.gz`) con «ENOENT … package.json»: leía la versión para `.origin.json` de un `package.json` relativo a la ruta del ejecutable, que solo existe cuando el binario está dentro del repositorio (por eso el arnés de la release no lo vio). Ahora la versión sale de los assets embebidos, como `--version` y `cv serve`. La imagen Docker de la 1.6.0 no estaba afectada.
- Prueba de humo del empaquetado: instala y verifica un tema desde fuera del árbol del repositorio; el flujo de release ejecuta el arnés contra una copia del ejecutable fuera del repositorio.

## [1.6.0] - 2026-08-30

Galería de temas (T-8.3): tres temas distribuidos nuevos, metadatos de autoría en `theme.toml`, la página «Galería de temas» del portal, `cv theme install` para temas de la comunidad (con consentimiento, lector propio y huellas), `cv theme verify`, la API en dos pasos y «Instalar tema…» en la interfaz web.

### Añadido

- Temas distribuidos **`modern`** (franja de acento en la cabecera, columna lateral con contacto, skills, idiomas, certificaciones y logros, periodos en pastillas), **`academic`** (serif de una columna para trayectorias largas: cabecera centrada, secciones numeradas, fechas al margen y pie «Nombre · página X de Y»; A4 o US Letter desde `cv.toml`) y **`minimal`** (monocromo, sin filetes, columnas ni espaciado entre letras: pensado para los sistemas de filtrado de candidaturas). Mismo contrato `cv(d, theme)` que `default` y `classic`, autocontenidos, anulables desde `cv.toml`; `cv theme create mio --from modern` parte de cualquiera.
- `theme.toml` admite en `[theme]` los metadatos opcionales `author` (≤ 120), `license` (≤ 60) y `homepage` (URL `https`); `cv theme list` los muestra («· autor: … · licencia: …») y el inventario de la API (`GET /api/v1/themes`) los expone.
- La vista estructurada que reciben las plantillas gana las etiquetas `contact`, `page` y `of` (es/en) para los temas con columna de contacto o pie paginado.
- Portal: página **Galería de temas** con la primera página del CV del banco de pruebas compilada con cada tema (imágenes generadas con Typst por `npm run docs:themes` y versionadas; nada en línea desde el producto) y guía «Typst y temas» ampliada.
- Verificación: prueba común de los temas distribuidos (carga, metadatos, autocontención de la plantilla y compilación con Typst real en español e inglés; US Letter para `academic`) y PDFs canónicos del arnés `typst` para los tres temas con el CV completo y cada especialidad del banco.
- **`cv theme install <origen>`** (T-8.3, segundo sprint): instala en `themes/<nombre>/` un tema de la comunidad desde una URL `https://` a un `.zip` o `.tar.gz` (anuncio con host y límite de 8 MiB, consentimiento explícito o `--yes`; sin terminal y sin `--yes`, cancela sin tocar la red; solo https también tras redirecciones) o desde un archivo o directorio local. El archivo se lee **en el propio proceso** (zip «store»/«deflate» y tar ustar con `zlib`, sin `tar` del sistema) con una política de entradas cerrada (un directorio raíz opcional; solo `theme.toml`, `template.typ`, `README.md`, `LICENSE` y `fonts/<nombre>.ttf|otf`; sin `..`, rutas absolutas, enlaces ni dispositivos; límites por fichero, por fuente, totales y de entradas). `theme.toml` se valida antes de escribir; `--as` renombra, `--sha256` contrasta la huella publicada por el autor, `--dry-run` muestra el plan sin escribir y `--replace` aparta el tema anterior a `themes/<nombre>.<marca>.bak/`; la escritura es atómica (directorio temporal y renombrado).
- **Origen y huellas**: `themes/<nombre>/.origin.json` registra origen, huella del archivo y de cada fichero; **`cv theme verify [<nombre>]`** las recalcula (intacto, modificado localmente con cada fichero, o sin origen; código 1 si hay diferencias) y `cv theme list` muestra el origen de cada tema instalado (`--verify` añade su estado). La API expone el origen en el inventario de temas.
- Arnés `theme`: instalación desde archivos y directorios locales del banco (zip y tar.gz deterministas generados por `npm run acceptance:bench`), `--dry-run`, `--replace`, `--sha256`, `verify`, y los errores (archivo que sale del tema, sin plantilla, nombre inválido, huella distinta, tema existente, `http://` rechazado, `https://` sin terminal cancelado sin red); arnés `typst`: PDF con el tema instalado.
- API: `POST /api/v1/themes/install` (archivo o directorio del espacio de trabajo, o URL https con `--allow-remote` y consentimiento en dos pasos: `409 consent-required` con `estimateId`, `host` y `limitBytes`, repetir con `consent.estimateId`; `dryRun` → 200 con el plan, instalado → 201) y `POST /api/v1/themes/{name}/verify`; `GET /api/v1/themes` expone el origen de cada tema instalado.
- Interfaz web: en Generar, junto a «Crear tema», **Instalar tema…** (origen, nombre y huella opcionales, «Ver el plan», reemplazar) con el diálogo de consentimiento para las URL; el selector de tema muestra la autoría y marca los instalados.

## [1.5.0] - 2026-08-30

Configuración avanzada del co-piloto (T-8.2): `cv.toml`, claves desde la terminal, registro de proveedores con evidencia, cuota visible sin telemetría y la pantalla «Ajustes». La adición de proveedores externos gratuitos se pospone: Groq queda registrado como candidato **pendiente de verificación humana** y no se puede seleccionar en esta versión.

### Añadido

- `cv.toml` gana la tabla `[llm]` (T-8.2): proveedor **local** (`ollama` u `openai-compatible`), `base_url` en loopback y `model`, más `[llm.models]` con el modelo por defecto de cada proveedor remoto. Precedencia explícita y visible: `--provider`/`--model` > variables `CHAMELEON_LLM_*` > `cv.toml` > valores por defecto; `cv llm status` dice de dónde sale cada valor y si `cv.toml` existe, tiene la tabla o es inválido (un `cv.toml` inválido bloquea al co-piloto con su mensaje).
- `cv llm key set|remove|list`: las claves de los proveedores remotos se guardan en el fichero de claves (`0600`, directorio `0700`) desde la terminal —pregunta sin eco, o entrada estándar sin terminal—; nunca como argumento, nunca por HTTP, nunca se imprimen.
- **Registro de proveedores remotos** (`src/llm/registry.ts`): cada remoto entra como datos —API, host (de ahí la lista blanca), modelo por defecto, plan, cuota publicada con fuente y fecha y **evidencia C7** (URL, fecha y cita literal de la política de no entrenamiento)—. **Groq** entra en el registro tras el *spike* documentado en `docs/copilot-providers.md`, pero con estado **`pending-verification`**: hasta que una persona complete el protocolo de verificación al alta (§9), `--provider groq`, `POST /config/llm/check` y el selector del Co-piloto lo rechazan y `cv llm status` y Ajustes lo muestran como pendiente (la clave sí se puede guardar con `cv llm key set groq`, que es el paso 2 del protocolo). `cv llm status` describe cada remoto con su plan, cuota y clave.
- **Cuota viva, sin telemetría**: las cabeceras de límite que devuelven los proveedores (`x-ratelimit-*`, `anthropic-ratelimit-*`, `retry-after`) se guardan en memoria del proceso y se muestran en `cv llm status`, tras un trabajo remoto («Cuota según groq: quedan 28/30 peticiones…») y en la API. Un 429 es `quota-exceeded`: no se reintenta y un lote de `improve` se detiene.
- API: `GET /api/v1/config/llm` (configuración efectiva con orígenes, `cv.toml` y su huella, proveedores del registro sin claves, cuota viva), `PUT /api/v1/config/llm` (la tabla `[llm]` con `If-Match` y sustitución quirúrgica) y `POST /api/v1/config/llm/check` (una llamada de salud explícita; los remotos exigen `--allow-remote`).
- Interfaz web: pantalla **Ajustes** (proveedor local, URL y modelo guardados en `cv.toml`, con el origen de cada valor y los campos fijados por el entorno en solo lectura; proveedores externos con clave, plan, cuota publicada y viva, evidencia y «Comprobar»); el selector de proveedor del Co-piloto ofrece los remotos utilizables. Guía «Configurar el co-piloto».

## [1.4.0] - 2026-08-30

Portabilidad del perfil (T-8.1): el perfil canónico entra y sale del producto, y la importación regenera las fuentes Markdown/CSV —la inversa de `cv build`— comprobándose a sí misma antes de escribir.

### Añadido

- `cv export [-d <dir>] [-o <fichero>]`: el perfil canónico (el mismo JSON que `data/dist/profile.json`) desde las fuentes, por la salida estándar o a un fichero `0600`, sin necesitar `cv build`.
- `cv import <fichero|-> [-d <dir>] [--replace] [--dry-run]`: regenera las fuentes a partir de un perfil canónico con las convenciones de `cv init` (ids conservados, `id:` solo cuando no se deriva del nombre, colisiones con sufijo), valida el perfil con todas las líneas, rechaza lo que las fuentes no pueden representar y **vuelve a leer lo generado con el parser real antes de escribir**: a la primera diferencia no escribe nada. Solo sobre un directorio vacío o, con `--replace`, tras apartar el existente entero como copia `<dir>.<fecha-hora>.bak`; avisa cuando el orden de las entidades cambia.
- API: `GET /api/v1/export` y `POST /api/v1/import` (`dryRun` por defecto; 409 con el destino ocupado; 422 con el perfil inválido), en la referencia generada.
- Interfaz web: en Estado, **Exportar perfil (JSON)** (descarga) e **Importar perfil…** (plan con auto-chequeo, casilla de sustitución con copia y confirmación).
- Guía «Exportar e importar el perfil», sección «Fuentes regeneradas por `cv import`» en el formato del dataset, ejemplos de `export` e `import` en la referencia; el arnés determinista gana el escenario `portability` con la ida y vuelta en vivo (`export` tras `import` byte a byte idéntico).

### Cambiado

- Clarificación del canon C9: `cv import` es la segunda orden que escribe fuentes, bajo el mismo régimen que `improve apply` (acción explícita del usuario, sin IA, con copia).

## [1.3.0] - 2026-08-30

La interfaz web completa (T-7.5b): el co-piloto de IA y las revisiones también en el navegador, con las mismas garantías que la CLI —consentimiento de coste antes de enviar nada a un proveedor remoto, marcas que solo cambian `[ ]`↔`[x]`, escritura en las fuentes solo tras confirmar y con copias `.bak`—.

### Añadido

- Interfaz web (T-7.5b): pantalla **Co-piloto** —mejorar logros, resumen profesional y sugerir etiquetas como trabajos con progreso en directo, cancelación y consentimiento de coste para proveedores remotos— y el doble local del proveedor para las pruebas de extremo a extremo.
- Interfaz web (T-7.5b): pantalla **Revisiones** —cada ítem con su «antes» y sus propuestas (las rechazadas por la verificación C2, tachadas), marcas `[ ]`↔`[x]` que se guardan con `If-Match` sin tocar el resto del fichero, plan de aplicación y escritura en las fuentes con confirmación y copias `.bak`, y borrado— (`#/revisiones/<nombre>`, enlazada desde el resultado de un trabajo).

### Corregido

- El resultado de un trabajo de `improve`/`summarize` en la API devolvía la ruta absoluta de la revisión; ahora es `output/<nombre>`, como el resto del contrato.

## [1.2.0] - 2026-08-30

La interfaz web (T-7.5a): `cv serve --open` abre en el navegador las mismas tareas que la CLI, servidas desde el propio ejecutable y la imagen, sin nada externo. Hito 7 (T-7.5a) del [ROADMAP](ROADMAP.md).

### Añadido

- Interfaz web: `cv serve` sirve en `/` la aplicación de `gui/` (Svelte 5 + Vite) que viaja como assets dentro del ejecutable y de la imagen Docker, por lista cerrada y con CSP estricta; sesión por el fragmento de la URL guardada en la pestaña; pantallas **Estado** (artefacto, Typst, co-piloto, temas; validar, compilar y apagar), **Fuentes** (explorador, editor CodeMirror cargado bajo demanda, guardado con `If-Match` y diálogo de conflicto, validación tras guardar, creación de ficheros), **Generar** (especialidad, oferta por texto, PDF subido o fichero, formato y motor, tema, límites; análisis de adecuación a la oferta; PDF en el visor del navegador o Markdown con descarga; informe de decisiones; creación de temas) y **Salidas** (los ficheros de `output/` con vista previa y descarga). Contrato tipado de la API (`src/serve/contract.ts`) compartido con la GUI. Pruebas de extremo a extremo con Playwright contra `cv serve` real y contra el ejecutable empaquetado; guía «La interfaz web» con capturas generadas.
- `cv serve --open` abre la interfaz; `cv serve --api-only` la desactiva. El escenario `serve` del arnés de aceptación y las pruebas de humo del ejecutable y de la imagen comprueban que la interfaz viaja dentro.

## [1.1.1] - 2026-08-29

El núcleo como producto y la imagen Docker publicada: la API local (`cv serve`) completa —incluidos los trabajos del co-piloto—, el portal de documentación, el ecosistema Docker y la primera imagen oficial en GitHub Container Registry. Hito 7 (T-7.1 a T-7.4) del [ROADMAP](ROADMAP.md). La versión 1.1.0 no llegó a publicarse: sus cambios se distribuyen aquí.

### Añadido

- Portal de documentación (`website/`, VitePress) publicado en GitHub Pages: guía de usuario, referencia de comandos generada desde la ayuda de la CLI, tutoriales ejecutables verificados en la integración continua, sección para desarrolladores (arquitectura y cánones C1–C15, contribuir, pruebas, extender, empaquetado) y notas de diseño sincronizadas desde `docs/`. `CONTRIBUTING.md`. README reducido a puerta de entrada.
- Cánones C14, «El núcleo es el producto», y C15, «La documentación es código verificable».
- `cv serve`: servidor local de la API (`/api/v1`) sobre el espacio de trabajo —solo `127.0.0.1`, token de sesión, `Host`/`Origin` comprobados, sin CORS— con estado, fuentes (huellas e `If-Match`), validar, compilar, perfil, generar, salida, análisis de ofertas, extracción de PDF y temas; la CLI y el servidor comparten la capa de casos de uso `src/app/`.
- El co-piloto en la API como **trabajos**: `POST /jobs/improve`, `/jobs/summarize` y `/jobs/suggest-tags` (202 con `Location` y qué saldrá hacia dónde), estado y eventos en directo (`GET /jobs/{id}/events`, Server-Sent Events), cancelación (`DELETE /jobs/{id}`: la petición en curso al modelo se aborta), consentimiento de coste en dos pasos para proveedores remotos (`cv serve --allow-remote` y `409 consent-required` con estimación y `estimateId` de un solo uso), y revisiones (`GET /reviews`, `GET`/`PUT` con `If-Match`/`DELETE /reviews/{name}`, `POST /reviews/{name}/apply` con plan por defecto).
- Referencia de la API generada desde el propio servidor (`/reference/api`), guía «La API local (cv serve)» y tutorial 6 «La API desde la terminal», ejecutable en la integración continua.
- `compose.serve.yml` y `compose.serve-ai.yml`: `cv serve` desde Docker con el puerto publicado solo en el loopback del anfitrión.
- Ecosistema Docker: `Dockerfile` multi-etapa (runtime sin Node; variante distroless), `compose.yml` sin red y endurecido, `compose.ai.yml` con Ollama en loopback compartido (`network_mode: service:ollama`) y `compose.gpu.yml`; prueba de humo de la imagen (`npm run docker:smoke`), trabajo `docker` en la integración continua, guía «Chameleon CV en Docker» y tutorial 5.
- Imagen Docker publicada en GitHub Container Registry (`ghcr.io/nunzi00/chameleon-cv`) desde el flujo de release, con etiquetas `X.Y.Z`, `X.Y`, `X` y `latest` (sin alias en prereleases), variante `-distroless`, `linux/amd64` y `linux/arm64` construidas en runners nativos, SBOM y procedencia de BuildKit en el registro y atestación de procedencia de GitHub sobre cada índice (`gh attestation verify oci://…`); la imagen solo se publica tras pasar la prueba de humo en cada arquitectura. `workflow_dispatch` para ensayar sin publicar o (re)publicar la imagen de una release existente. Análisis semanal e informativo de la imagen publicada con Trivy (Code scanning).
- `compose.yml` descarga por defecto la versión exacta publicada (`CHAMELEON_CV_IMAGE` la cambia); una prueba de la suite exige que coincida con `package.json`. Prueba de humo con `--user` (variante distroless) y trabajo `docker` de la CI en `amd64` y `arm64` con las dos variantes.

### Cambiado

- `cv improve`, `cv summarize`, `cv suggest tags` y `cv improve apply` son clientes de los casos de uso de `src/app/` (planificar sin red → proveedor y consentimiento → ejecutar con progreso y cancelación), con la misma salida byte a byte. Toda petición al modelo admite una señal de cancelación (`AbortSignal`), combinada con el tiempo máximo.
- Los flujos de integración continua y de release generan las notas con `npm run --silent`, para que la cabecera de npm no se cuele en la release.

### Corregido

- El arnés de aceptación compara los PDF de forma canónica (flujos descomprimidos): una compilación de Node con zlib-ng produce bytes distintos pero documentos idénticos, y la integración continua en GitHub lo señalaba como diferencia.
- Los flujos de CI y release invocaban un script `lint` inexistente.
- El flujo de documentación ya no intenta activar GitHub Pages con el token de la acción (no tiene permiso): Pages se activa una vez desde los ajustes del repositorio.

## [1.0.0] - 2026-08-29

Primera versión estable. Chameleon CV genera CV dinámicos a partir de un único conjunto de fuentes (Markdown y CSV): una versión por especialidad o adaptada a una oferta de empleo, en Markdown o PDF, con un co-piloto de IA que sugiere y nunca decide. Todo se procesa en local y sin telemetría. Se distribuye como ejecutable autónomo para linux-x64 (plataforma de referencia) y desde el repositorio. Resume el trabajo de los Hitos 1 a 6 del [ROADMAP](ROADMAP.md), del 2026-08-28 al 2026-08-29.

### Añadido

**Perfil y fuentes (Hito 1)**

- Esquema `MasterProfile` con validación estricta en tiempo de ejecución (zod): datos personales, especialidades, experiencias, proyectos, formación, logros, skills, certificaciones e idiomas.
- Fuentes en Markdown (frontmatter YAML para los datos y cuerpo para el texto; logros como viñetas con `impact`, `date` y etiquetas `#tag`) y en CSV (`skills.csv` con alias y categorías, `certifications.csv`). Ninguna clave, sección o fichero desconocido se ignora en silencio.
- `cv validate` y `cv build`: el artefacto canónico `data/dist/profile.json`, validado y escrito de forma atómica con permisos 0600; todos los errores a la vez, con fichero y línea.
- `SelectorEngine`: selección por especialidad con una sola regla —sin etiquetas, siempre; con etiquetas, solo si alguna coincide— y entrada de experiencias y proyectos a través de sus logros. `--explain` cuenta cada decisión.
- `cv generate-cv` en Markdown con Handlebars a partir de una vista ya formateada (fechas por idioma, periodos, skills por categoría), plantillas propias con `--template`, castellano e inglés.

**Adaptación a ofertas de empleo y PDF (Hitos 2 y 2.5)**

- Extractor determinista de palabras clave de una oferta con el vocabulario del propio perfil (tags, nombres y alias de skills) y puntuación transparente por secciones (`Requisitos` 1.0 · resto 0.75 · `Deseable` 0.5, con refuerzo por repetición).
- `cv analyze-offer` (adecuación, evidencias y carencias; `--explain`, `--json`) y `cv generate-cv --from-job-offer` (texto, entrada estándar o PDF).
- Recorte «N mejores»: `--top-n`, `--max-skills`, `--max-projects`, `--max-certifications` y el preset `--compact`.
- Lectura de ofertas en PDF en un *worker* aislado con límites (10 MiB, 50 páginas, 20 s, 512 MB) y salida `--format pdf` con pdfkit y la fuente Source Sans 3 embebida, sin dependencias externas.
- `cv build --check` como puerta de calidad para CI, `--build` en `generate-cv` y `analyze-offer`, `cv init` con un dataset de ejemplo y la etiqueta reservada `#pin`, que ancla un ítem en toda especialidad u oferta.

**Motor Typst de calidad editorial (Hito 3)**

- `--engine typst`: la misma vista estructurada que pdfkit, maquetada con Typst 0.15.1 en un proceso contenido (stdin/stdout sin ficheros intermedios, `--root` limitado, sin red, solo las fuentes del proyecto, 20 s y 32 MiB de límite); PDF etiquetado y determinista.
- `cv typst install`, la única operación de red del producto: descarga del release oficial verificada contra un manifiesto de SHA-256 fijado al versionar; `cv typst status`.
- Diseño tipográfico de referencia: jerarquía con versalitas, fechas alineadas, tabla de skills y pie de página solo cuando hay varias páginas.

**Co-piloto de IA (Hitos 4 y 4.5)**

- Doctrina canonizada (C1–C13, `docs/llm-integration.md`): la IA sugiere y el usuario decide; sin invención; local por defecto; minimización y seudonimización de lo que sale; prompts transparentes y versionados; salida validada; inmutabilidad de las fuentes.
- Proveedores locales (Ollama y servidores compatibles con OpenAI en loopback), `cv llm status` y caché local de respuestas (`cv llm cache clear`).
- `cv improve`: reescrituras con más impacto para los logros seleccionados, cada una verificada por código (integridad semántica: ninguna cifra ni entidad añadida u omitida) y recogidas en un fichero de revisión.
- `cv summarize`: propuestas de resumen profesional a partir del perfil filtrado, verificadas en modo síntesis e indicando los hechos clave que mencionan.
- `cv suggest tags`: etiquetas solo del diccionario cerrado de las especialidades, con la evidencia de cada una calculada por código.
- Proveedores remotos `openai` y `anthropic` solo con `--provider` explícito: claves desde variable o fichero 0600 (nunca interactivas), lista blanca de hosts sin redirecciones, aviso de coste y confirmación (`--yes` para scripts).
- `cv improve apply`: aplica a las fuentes lo marcado `[x]` en una revisión, con procedencia y huella SHA-256 del original, copia `.bak` previa y cambio mínimo; `--dry-run` y `--delete-review`. Es la única orden que escribe en `data/sources/`.

**Temas (Hito 5)**

- Sistema de temas para Typst: `themes/<nombre>/` con `theme.toml` (colores, tipografías, tamaños, espaciados y página, validados con la ruta de cada error) y `template.typ` (contrato `cv(d, theme)`); `--theme` busca primero en el proyecto y después entre los distribuidos.
- Temas distribuidos `default` y `classic`; `cv.toml` con `[theme]` para elegir el tema por defecto del proyecto y anular valores en cascada con la misma validación.
- `cv theme list | path | create --from`.

**Validación integral (Hito 5.5)**

- Banco de pruebas sintético (sin datos reales) con 260 artefactos esperados versionados; arnés determinista (`npm run test:acceptance:deterministic`: 77 pasos contra el binario, comparación byte a byte, omisiones visibles y autocomprobaciones) y arnés de IA (`npm run test:acceptance:ai`: 16 comprobaciones del proceso con un modelo local real). Guía en `docs/acceptance-testing.md`.

**Distribución (Hito 6)**

- Capa unificada de assets: los recursos viajan dentro del ejecutable (`node:sea`) y los que deben ser ficheros reales se materializan en la caché de usuario con su SHA-256 comprobado en cada uso.
- `npm run package`: ejecutable autónomo (Node SEA + esbuild) con prueba de humo y archivo `tar.gz` reproducible con su `.sha256`, que incluye la licencia, este registro y los avisos de licencias de terceros (`THIRD-PARTY-NOTICES.md`) generados a partir de lo que de verdad contiene el bundle.
- Integración continua y flujo de release en GitHub Actions (linux-x64): verificación completa, empaquetado, aceptación del binario, `SHA256SUMS.txt`, atestación de procedencia SLSA y notas de la release tomadas de este fichero.
- Licencia MIT.

[Unreleased]: https://github.com/nunzi00/chameleon-cv/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/nunzi00/chameleon-cv/releases/tag/v1.0.0
