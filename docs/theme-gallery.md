# Galería de temas: temas nuevos distribuidos y `cv theme install` para temas de la comunidad

| | |
|---|---|
| **Tarea** | T-8.3 · [TEMAS] Galería (Hito 8) |
| **Estado** | PROPUESTA v1 (2026-08-30), pendiente de aprobación por el Director de Ingeniería y Producto |
| **Autor** | Claude (Director Técnico) |
| **Base** | `docs/plantillas-typst.md` y `docs/typst-integration.md` (el tema como código Typst y su contención: `--root` en el directorio del tema, sin paquetes, red cortada, 20 s y 32 MiB); `src/themes/` (esquema estricto de `theme.toml`, cargador con precedencia proyecto → distribuidos, `cv.toml [theme]`); `src/app/themes.ts` (`createTheme`, nunca sobrescribe); `src/typst/download.ts` e `install.ts` (descarga solo https con límites, SHA-256 en flujo, temporal 0600, instalación atómica); `src/cli/commands/remote.ts` (`consentToRemote`: `--yes`, `s/N`, cancelación sin terminal); `src/serve/consent.ts` (consentimiento en dos pasos de la API); nota del Director en `ROADMAP.md` (T-8.3) |

## 0. Resumen ejecutivo

- **Hoy** se distribuyen dos temas (`default` y `classic`), el usuario crea los suyos con `cv theme create --from` y los anula desde `cv.toml`; un tema es código Typst que se ejecuta contenido (raíz limitada a su directorio, sin paquetes, sin red, con límites de tiempo y tamaño), y hasta ahora ese código lo escribió o copió el propio usuario.
- **Propuesta**: (1) **tres temas nuevos distribuidos** —`modern`, `academic` y `minimal`— con el mismo contrato `cv(d, theme)`, sin fuentes nuevas que descargar, cada uno verificado con el banco de pruebas y **mostrado en una galería del portal** (una imagen por tema, generada con Typst a partir del CV del banco); (2) metadatos opcionales de autoría en `theme.toml` (`author`, `license`, `homepage`), que `cv theme list` y la galería enseñan; (3) **`cv theme install <origen>`**, donde el origen es una URL `https://` a un `.zip`/`.tar.gz` o una ruta local (archivo o directorio): consentimiento explícito antes de tocar la red (qué se descarga, de dónde, con qué límite), lectura del archivo **en el propio proceso** con una política estricta de entradas (solo `theme.toml`, `template.typ`, `fonts/*.ttf|otf`, `README.md`, `LICENSE`; sin rutas fuera del tema, sin enlaces simbólicos, con límites de tamaño), validación con el esquema de siempre, y **fijación del origen y las huellas** en `themes/<nombre>/.origin.json` (SHA-256 del archivo y de cada fichero); `--sha256` para contrastar con la huella que publique el autor y `cv theme verify` para comprobar después que el tema instalado sigue siendo el que se aceptó; nunca sobrescribe, nunca sale de `themes/` del proyecto, nunca amplía la contención de Typst; (4) `POST /themes/install` con el consentimiento en dos pasos de la API y el origen en `GET /themes`; GUI mínima en Generar como sprint opcional.
- Versión **1.6.0**; tres sprints (temas y galería; instalación; API/GUI y entrega).

## 1. Objetivo y alcance

**Objetivo.** Que el usuario tenga dónde elegir (una galería con temas de estilos distintos, verificados y sin dependencias externas) y que pueda traer un tema de terceros **sabiendo lo que trae**: de dónde viene, qué huella tiene y que se ejecuta con las mismas paredes que los temas propios.

**Dentro**: los tres temas con sus pruebas y sus imágenes en la galería; los metadatos de autoría; `cv theme install` (URL https o ruta local, consentimiento, `--dry-run`, `--sha256`, `--as`, `--replace`, `.origin.json`), `cv theme verify`; lectura de `.zip` y `.tar.gz` en proceso; `POST /themes/install` en dos pasos y `GET /themes` con origen; guía «Temas» ampliada y página «Galería»; CHANGELOG y 1.6.0.

**Fuera** (y por qué): una galería *en línea* consultada por el producto (C3: ninguna llamada de red sin orden explícita; la galería vive en el portal y en la documentación); un registro central de temas con búsqueda (`cv theme search`), que exigiría un servicio nuestro; `cv theme update` automático (una actualización es otra instalación con su consentimiento; `verify` dice si algo cambió); firmas criptográficas de autores (no hay infraestructura de claves; la huella publicada por el autor y contrastada con `--sha256` cubre el caso real); análisis estático del Typst de terceros (la contención del renderer es la garantía; un escáner daría una falsa sensación de seguridad); fuentes descargadas por el instalador (las del tema viajan dentro del archivo o no se usan).

## 2. Situación de partida

- **Tema** = `themes/<nombre>/theme.toml` + `template.typ` (+ `fonts/`), nombre `^[a-z0-9][a-z0-9-]*$`; esquema estricto con seis tablas (`theme`, `colors`, `fonts`, `sizes`, `spacing`, `page`), `theme.name` debe coincidir con el directorio; sin `author` ni `license`.
- **Cargador**: `themes/` del proyecto primero, distribuidos después (por la capa de assets, dentro del ejecutable y la imagen); `inventoryThemes` señala los que sombrean a un distribuido; `cv.toml [theme]` anula valores sin tocar ficheros.
- **Renderer**: documento de dos líneas que importa `/template.typ` y llama a `cv(vista, theme.toml)`; Typst con `--root` en el directorio del tema, `--font-path` del proyecto y del tema, sin fuentes del sistema, `--package-path` a un directorio inexistente, proxy a `127.0.0.1:9`, 20 s, 32 MiB, sin *shell*. Las sondas de `docs/typst-integration.md` §3.2 (lectura fuera de la raíz, paquetes, red) fallan como deben.
- **Comandos**: `cv theme list|path|create`; API `GET/POST /themes`; GUI: selector de tema y creación en Generar. Escenarios del arnés `theme` (sin Typst) y `typst` (con él).
- **Precedentes**: `cv typst install` descarga con https obligatorio tras redirecciones, límite anunciado y en flujo, SHA-256 comparado con un manifiesto **nuestro**, temporal 0600 e instalación atómica con limpieza; `cv typst extract` usa `tar` del sistema; `consentToRemote` pide `s/N` (o `--yes`) y cancela sin terminal; la API tiene `ConsentStore` (409 `consent-required` con `estimateId` de un solo uso).
- **Lo nuevo**: por primera vez un tema puede venir de **un tercero**. Hoy la plantilla es «código de confianza del usuario»; instalarla desde una URL exige hacer explícitos el origen, el consentimiento y la huella, sin cambiar las paredes de la contención.

## 3. Principios de diseño

1. **La contención no se toca** (`docs/typst-integration.md` §3). Un tema de la comunidad se ejecuta exactamente como uno propio: raíz en su directorio, sin paquetes, sin red, con límites. Instalar no da permisos nuevos.
2. **Ninguna llamada de red sin orden y sin consentimiento** (C3, C11). `cv theme install https://…` dice qué va a descargar, de dónde y con qué límite, y espera un «sí»; sin terminal y sin `--yes`, cancela. Una ruta local no toca la red y no pregunta.
3. **Origen fijado, huella comprobable** (nota del Director). Todo tema instalado deja `.origin.json` con la fuente, la fecha y las huellas; `--sha256` contrasta con la que publique el autor; `cv theme verify` detecta cambios. Es *confianza en el primer uso* con memoria, como las huellas de SSH, y así se documenta.
4. **El archivo se lee con lupa**. Solo entran los ficheros de un tema, con nombres seguros, sin enlaces ni rutas fuera de su directorio, con límites por fichero y totales; `theme.toml` se valida con el esquema estricto antes de escribir nada; nunca se sobrescribe un tema existente sin `--replace` y copia.
5. **La galería se mira, no se consulta**. Vive en el portal (imágenes generadas con Typst del CV del banco) y en `cv theme list`; el producto no consulta nada en línea.
6. **Núcleo agnóstico** (C14): descarga, lectura del archivo, validación, fijación y verificación en `src/themes` y `src/app`; CLI, API y GUI solo orquestan y preguntan.

## 4. Diseño

### 4.1 Los temas nuevos

| Tema | Estilo | Tipografías (sin descargas: distribuidas o embebidas en Typst) | Rasgos |
|---|---|---|---|
| `modern` | Contemporáneo, franja de acento y columna lateral | Source Sans 3 (distribuida) | Cabecera con nombre grande y banda de color; lateral con contacto, skills e idiomas; cuerpo con experiencia y proyectos; fechas en pastillas; A4 |
| `academic` | Sobrio, de una columna, pensado para trayectorias largas | Libertinus Serif (embebida en Typst) | Cabecera centrada, secciones numeradas con filete fino, fechas al margen, pie con «Nombre · página X de Y», silabación; A4 y US Letter |
| `minimal` | Monocromo, sin filetes, máximo aire; amable con los ATS | Source Sans 3 | Un solo color de texto, jerarquía solo por tamaño y peso, listas planas, sin tablas ni columnas |

Los tres implementan el contrato `cv(d, theme)` de los actuales, son autocontenidos (sin importar entre sí), respetan todas las variables de `theme.toml` (colores, tipografías, tamaños, espaciados, página) y se anulan desde `cv.toml` igual que `default` y `classic`. Verificación: cada tema compila el CV completo y cada especialidad del banco (arnés `typst`, PDFs canónicos), y una prueba unitaria común comprueba que todo tema distribuido carga, valida y se compila (con Typst real, como las cuatro pruebas existentes que exigen `CHAMELEON_TYPST`).

**Metadatos** (`[theme]`, todos opcionales, compatibles hacia atrás): `author` (≤ 120), `license` (≤ 60, texto libre; se sugiere un identificador SPDX), `homepage` (URL https). `cv theme list` los muestra; la galería también.

### 4.2 `cv theme install <origen> [--as <nombre>] [--sha256 <huella>] [--dry-run] [--replace] [--yes]`

**Orígenes**: una URL `https://` a un archivo `.zip` o `.tar.gz`, o una ruta local a un archivo o a un directorio de tema (para compartir sin red y para el arnés). Nada más (ni `http://`, ni abreviaturas de repositorios: la URL completa es la orden explícita).

**Pasos, en este orden, y ninguna escritura en `themes/` hasta el último:**

1. **Anuncio y consentimiento** (solo con URL): «Se descargará `<url>` (host `<host>`, máximo 8 MiB) para instalarlo como `themes/<nombre>/`; la huella se mostrará antes de instalar». `--yes` lo confirma; con terminal pregunta `s/N`; sin terminal y sin `--yes`, cancela con el mismo mensaje que el co-piloto remoto (código 2). Una ruta local no pregunta.
2. **Descarga contenida** (misma disciplina que `cv typst install`): solo https también tras redirecciones, límite anunciado y en flujo (8 MiB), 60 s, SHA-256 en flujo, fichero temporal 0600 borrado si algo falla.
3. **Lectura del archivo en el propio proceso** (`src/themes/archive.ts`): lector de `.zip` (directorio central, entradas *store*/*deflate* con `zlib`) y de `.tar.gz` (`gunzip` + cabeceras ustar), sin `tar` del sistema ni procesos. Política de entradas: se admite un único directorio raíz opcional; solo `theme.toml`, `template.typ`, `fonts/<nombre>.ttf|otf`, `README.md` y `LICENSE`; nombres con el mismo patrón que los temas; sin `..`, sin rutas absolutas, sin enlaces simbólicos ni duros, sin dispositivos; máximo 2 MiB por fichero salvo fuentes (8 MiB), 16 MiB descomprimidos en total, 40 entradas; cualquier otra cosa es un error que nombra la entrada. Un directorio local se lee con la misma política.
4. **Validación**: `theme.toml` con `ThemeConfigSchema`; el nombre del tema es `--as` si se dio, si no `theme.name`, si no el nombre del directorio raíz del archivo; debe cumplir el patrón y no ser el de un tema del proyecto ya existente (salvo `--replace`, que aparta el anterior a `themes/<nombre>.<marca>.bak/`). `template.typ` debe existir; no se analiza su contenido (principio 1: la contención es la garantía).
5. **Huellas**: SHA-256 del archivo (o, para un directorio local, de su contenido canónico) y de cada fichero. Con `--sha256 <huella>` se exige la coincidencia con la del archivo; sin él, la CLI la imprime y la deja fijada. Todo se escribe en `themes/<nombre>/.origin.json`: `{ source, kind: 'url' | 'archive' | 'directory', archiveSha256, files: { ruta: sha256 }, installedAt, tool: 'chameleon-cv <versión>' }`. El cargador ignora `.origin.json` (no forma parte del tema) y `cv theme create --from <instalado>` no lo copia (una copia es un tema nuevo del usuario).
6. **Escritura atómica**: directorio temporal dentro de `themes/`, ficheros 0644 como `createTheme`, `rename` al destino final, limpieza en `finally`.
7. **Resumen**: ficheros escritos, huella del archivo, origen fijado y el recordatorio «`cv generate-cv --theme <nombre>` para usarlo; `cv theme verify <nombre>` para comprobarlo; el tema se ejecuta contenido, como todos».

`--dry-run` hace 1–5 y muestra el plan (entradas admitidas, tamaños, huellas, nombre resultante) sin escribir nada; con URL sigue pidiendo consentimiento (descarga igualmente).

### 4.3 `cv theme verify [<nombre>]` y el origen en el inventario

`verify` recalcula las huellas de cada fichero de un tema con `.origin.json` y las compara: «intacto», «modificado localmente: `template.typ`» o «sin origen registrado» (temas creados o copiados a mano, que no son sospechosos: simplemente no tienen origen). Sin nombre, comprueba todos los del proyecto. Código 0 si todo está intacto o sin origen; 1 si hay diferencias. `cv theme list` y `GET /themes` añaden `origin: { source, installedAt, verified: 'intact' | 'modified' | 'none' }` por tema, sin recalcular huellas en el listado salvo que se pida (`--verify`).

### 4.4 La galería

Página «Galería de temas» en el portal (`website/src/guide/theme-gallery.md`): una imagen por tema distribuido —el CV del banco compilado con Typst y exportado a PNG (`typst compile --format png`, primera página)— con su descripción, tipografías, `cv theme create --from <tema>` para partir de él y la nota de contención. Las imágenes se generan con un guion (`npm run gui:screenshots` gana los temas, o un `docs:themes` propio que exige Typst) y se versionan en `website/src/public/themes/`. Sin nada en línea: la galería es documentación (C15).

### 4.5 API y GUI

- `POST /api/v1/themes/install` con `{ source, name?, sha256?, dryRun?, replace?, consent? }`: para un `source` https sin `consent.estimateId` válido responde **409 `consent-required`** con `{ estimateId, source, host, limitBytes }` (mismo `ConsentStore`, TTL 10 min, un solo uso); con él, descarga e instala como la CLI; una ruta local no exige consentimiento. Respuesta `200 { name, path, files: [{ path, sha256, bytes }], archiveSha256, origin }`; `409 conflict` si el tema existe sin `replace`; `422 invalid-data` con las líneas del archivo o del esquema; `403 remote-disabled` si el servidor no admite red (`--allow-remote` cubre también esto: es la única puerta de red de `cv serve`). `writes: true`.
- `GET /api/v1/themes`: cada tema con sus metadatos (`author`, `license`, `homepage`) y `origin`.
- `POST /api/v1/themes/{name}/verify` → el resultado de `verify`.
- **GUI** (S3, decisión 8): en Generar, junto a «Crear tema», **«Instalar tema…»** (origen, nombre, huella opcional) → diálogo de consentimiento con host y límite (como el de coste del co-piloto) → resultado con las huellas; el selector de tema muestra autor y origen; sin más.

## 5. Pruebas y verificación (C12, C13)

- **Unitarias al 100 %**: lector de `.zip` y `.tar.gz` (archivos construidos en la propia prueba con `zlib`: *store* y *deflate*, cabeceras ustar, un directorio raíz, sin él, entradas prohibidas —`..`, absolutas, enlaces, tipos raros, nombres fuera de patrón—, límites por fichero, totales y de entradas, archivos truncados o corruptos); política de entradas y validación del tema; nombre resultante (`--as`, `theme.name`, raíz); huellas y `.origin.json`; instalación atómica y `--replace` con copia; `verify` en sus tres estados; descarga con doble de `fetch` (https obligatorio tras redirección, límite superado, hash distinto con `--sha256`, temporal borrado); consentimiento (`--yes`, `s/N`, sin terminal); rutas de la API (409 en dos pasos, 403, 409 conflicto, 422, 200) y GUI si entra.
- **Temas nuevos**: prueba común «todo tema distribuido carga, valida y compila el banco» con Typst real; PDFs canónicos del arnés (`typst`) para los tres, en A4 y, para `academic`, en US Letter.
- **Arnés determinista**: escenario `theme` gana `install` desde un **archivo local del banco** (`themes/comunidad.zip`, versionado en el banco: un tema válido) → `list` con origen → `verify` intacto → `install --replace` desde un segundo archivo del banco con otra huella (nuevo origen, copia `.bak`) → `verify` sobre un tema creado con `create` informa «sin origen». Errores: archivo con `..`, sin `template.typ`, nombre inválido, `--sha256` que no coincide, tema existente sin `--replace`, `http://` rechazado, y una URL con red en el arnés **no se prueba** (sin red por diseño: la descarga se cubre con dobles). Escenario `typst`: `generate-cv --theme modern|academic|minimal` y con el tema instalado.
- Verificación final por sprint como siempre (typecheck, cobertura, arnés, `docs:build`; en el sprint de release, ejecutable y E2E contra él).

## 6. Documentación (C15)

Guía «Typst y temas» ampliada (los cinco temas, metadatos, `cv theme install` con el flujo de consentimiento y las huellas, `verify`, qué hace y qué no la contención con un tema de terceros, cómo publicar un tema: estructura del archivo y huella a publicar), página «Galería de temas» con imágenes, tutorial 3 actualizado, referencia generada, `docs/typst-integration.md` §3.3 (el tema de terceros bajo la misma contención) y `docs/plantillas-typst.md`, CHANGELOG `[1.6.0]`.

## 7. Seguridad

- **Red**: solo por orden explícita y con consentimiento; https obligatorio también tras redirecciones; sin cookies ni identidad; límites de tamaño y tiempo; nada en segundo plano.
- **Archivo**: lector propio en proceso (sin `tar` del sistema, sin *shell*), política de entradas cerrada, sin enlaces, sin rutas fuera de `themes/<nombre>/`, límites; un archivo malicioso no puede escribir fuera del tema ni agotar el disco.
- **Ejecución**: sin cambios en la contención de Typst; el tema de terceros no puede leer fuera de su directorio, usar paquetes ni red, ni pasar de 20 s o 32 MiB. El riesgo residual es **de contenido** (un tema que renderice mal o engañe visualmente), y por eso el origen y la huella quedan a la vista.
- **Procedencia**: `.origin.json` versionable junto al tema; `--sha256` para contrastar con el autor; `verify` para detectar cambios posteriores.
- **Datos del usuario**: el instalador no lee las fuentes ni el perfil; nada del usuario viaja en la descarga.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Un tema de terceros «feo» o engañoso | Vista previa con `--dry-run`, origen visible, `verify`; la galería enseña los distribuidos como referencia. |
| Lector de archivos propio con fallos | Pruebas con archivos construidos en la prueba y casos límite; política de entradas cerrada; límites duros. |
| Ausencia de infraestructura de firmas | Huella publicada por el autor + `--sha256`; documentado como confianza en el primer uso. |
| Temas nuevos que no cubran todos los datos del perfil | Compilación del banco completo y de cada especialidad en el arnés. |
| Crecimiento de la GUI | Solo «Instalar tema…» y el origen en el selector; el resto es CLI y docs. |

## 9. Plan de ejecución

- **S1 · Temas y galería**: `modern`, `academic`, `minimal`; metadatos de autoría; prueba común de temas distribuidos; goldens del arnés; imágenes de la galería y su guion; página «Galería». Informe y aprobación.
- **S2 · Instalación**: `src/themes/archive.ts` (zip, tar.gz, política), `src/themes/origin.ts` (huellas, `.origin.json`, `verify`), `src/app/themes.ts` (`installTheme`, `verifyTheme`), descarga contenida, `cv theme install` con consentimiento y `cv theme verify`, escenario del arnés con el archivo local del banco, referencia. Informe y aprobación.
- **S3 · API, GUI y entrega**: `POST /themes/install` en dos pasos, `GET /themes` con origen, `POST /themes/{name}/verify`; GUI «Instalar tema…» (si se aprueba); guía, `typst-integration.md`, tutorial, CHANGELOG `[1.6.0]`, versión 1.6.0, verificación completa y solicitud de la orden de etiquetado.

## 10. Decisiones que se piden al Director

1. **Tres temas** (`modern`, `academic`, `minimal`) con las tipografías distribuidas o embebidas en Typst; sin descargas de fuentes. *Recomendado.*
2. **Metadatos** opcionales `author`, `license` y `homepage` en `[theme]`, compatibles hacia atrás. *Recomendado.*
3. **Orígenes de `install`**: URL `https://` a `.zip`/`.tar.gz` o ruta local (archivo o directorio); sin `http://`, sin abreviaturas, sin lista blanca de hosts (la URL completa es la orden). *Recomendado.*
4. **Consentimiento** como el del co-piloto remoto (anuncio con host y límite; `--yes`; `s/N`; sin terminal, cancelar) y `--dry-run`. *Recomendado.*
5. **Huellas**: `.origin.json` con SHA-256 del archivo y de cada fichero; `--sha256` opcional para contrastar con el autor; `cv theme verify`; documentado como confianza en el primer uso. *Recomendado.*
6. **Lector de archivos en proceso** (zip y tar.gz con `zlib`) con política de entradas cerrada, en lugar de `tar` del sistema. *Recomendado.*
7. **Nunca sobrescribir**: `--replace` aparta el tema anterior a `themes/<nombre>.<marca>.bak/`. *Recomendado.*
8. **API en dos pasos** (`409 consent-required`, `--allow-remote` como puerta de red) y **GUI mínima** «Instalar tema…» en S3 — o aplazar la GUI. *Recomiendo incluirla.*
9. **Galería como documentación**: imágenes generadas con Typst y versionadas; nada en línea desde el producto. *Recomendado.*
10. **Versión 1.6.0** en tres sprints; la contención de Typst no cambia. *Recomendado.*

## 11. Estado de la implementación

- 2026-08-30: PROPUESTA v1 redactada y enviada al Director de Ingeniería y Producto. Sin implementación hasta su aprobación.
- 2026-08-30: **APROBADA** por el Director de Ingeniería y Producto (las diez decisiones de §10 tal como se recomendaban; la GUI «Instalar tema…» incluida en S3). Comienza el S1.
- 2026-08-30: **S1 entregado (temas y galería)**. Temas `modern`, `academic` y `minimal` en `themes/<tema>/` con el contrato `cv(d, theme)`, autocontenidos y anulables desde `cv.toml` (`minimal` sin espaciado entre letras: el extractor de texto leía «E X P E R I E N C I A», justo lo que un ATS no debe ver); metadatos `author`/`license`/`homepage` en `[theme]` (esquema estricto, inventario, `cv theme list` con «autor: … · licencia: …», expuestos por `GET /themes`); etiquetas `contact`, `page` y `of` (es/en) en la vista estructurada; `renderTypstPreview` sobre el mismo proceso contenido (`CompileRequest.output = { format: 'png', ppi }` → `--format png --ppi n --pages 1`, salida validada por su firma) y `npm run docs:themes`, que genera las cinco imágenes deterministas de `website/src/public/themes/` (A4 a 96 ppp, 1,3 MB en total) y reescribe las fichas de `website/src/guide/theme-gallery.md` desde los `theme.toml` (una prueba comprueba que la página publicada coincide); página «Galería de temas» en el portal y guía «Typst y temas» ampliada. Verificación: typecheck; 791 pruebas unitarias en 115 ficheros con cobertura 100 % en las cuatro métricas; prueba común de temas distribuidos con Typst real (`tests/themes/builtin.test.ts`: carga, metadatos, plantilla sin `#import`/`read`/paquetes, compilación es/en de los cinco temas, «CONTACTO»/«CONTACT» en `modern`, «página 1 de N»/«page 1 of N» y secciones numeradas en `academic`, `MediaBox` A4 y US Letter); arnés determinista 11 escenarios / 114 pasos idénticos (`typst` gana 12 pasos: los tres temas con el CV completo y cada especialidad del banco; `core`, `theme` y `serve` regenerados por los créditos y los metadatos); `docs:build` y `gui:check` (0 errores, 81 pruebas) en verde; revisión visual de las cinco imágenes. Desviación respecto a §5: el PDF canónico de `academic` en US Letter no está en el arnés —sus pasos son invocaciones de la CLI, no hay indicador de papel y el `cv.toml` del banco es único—; queda cubierto con Typst real en la prueba unitaria. Pendiente de aprobación del Director para pasar al S2.
