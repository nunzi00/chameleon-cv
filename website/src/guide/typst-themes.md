---
title: Typst y temas
---
# Motor PDF de calidad editorial: Typst y temas

`--format pdf` usa `pdfkit` por defecto: cero dependencias y un resultado correcto. Para un CV de **calidad de publicación**, `--engine typst` maqueta el mismo contenido con [Typst](https://typst.app) (0.15.1): jerarquía tipográfica cuidada, kerning y silabación profesionales, PDF etiquetado (accesible) y determinista, con la misma fuente Source Sans 3 embebida. Ambos motores parten de la **misma vista estructurada** del perfil: cambia la maquetación, nunca el contenido.

## Instalar Typst

```bash
cv typst install                                            # 1. descarga el release oficial para tu plataforma y lo verifica (una sola vez)
cv typst status                                             # 2. qué binario se usaría, su versión y de dónde sale (código 0 si es utilizable)
cv generate-cv -s backend --format pdf --engine typst       # 3. output/cv-<nombre>-backend.pdf con el diseño de referencia
cv generate-cv -f oferta.pdf --compact --format pdf --engine typst   # todo lo demás (ofertas, recortes, #pin, --explain) funciona igual
```

`cv typst install` es la **única operación de red** de `cv`, y solo ocurre cuando tú la pides: descarga por https con límite de tamaño, calcula el SHA-256 en streaming y lo compara con el manifiesto fijado al versionar (un fichero alterado se elimina sin instalarse), extrae con el `tar` del sistema en un directorio temporal, comprueba `--version` y solo entonces coloca el binario en tu caché de usuario (`~/.cache/chameleon-cv/typst/0.15.1/typst`, permisos 0700; `~/Library/Caches` en macOS, `%LOCALAPPDATA%` en Windows). También sirve un Typst 0.15.1 ya instalado en el `PATH`, la variable `CHAMELEON_TYPST` o `--typst-path` (`--typst-any-version` acepta otra versión bajo tu responsabilidad).

## Un proceso contenido

Al generar, Typst se ejecuta como proceso hijo **contenido**: stdin/stdout sin ficheros intermedios (tus datos nunca pasan por argumentos ni por disco), `--root` limitado al directorio del tema, entorno vacío con interruptor de red (ningún paquete `@preview` se descarga jamás), solo las fuentes del proyecto y del tema, 20 s y 32 MiB de límite. Sin binario, código 2 y la instrucción; una plantilla que no compila, código 1 con el diagnóstico de Typst. Diseño: [Integración de Typst](/design/typst-integration).

## Temas

El aspecto lo decide un **tema**: un directorio `themes/<nombre>/` con `theme.toml` —las variables de diseño: colores, tipografías, tamaños, espaciados y página, **validadas** antes de arrancar Typst— y `template.typ`, la maquetación, que recibe la vista estructurada y esas variables. `--theme <nombre>` elige el tema, buscándolo primero en `themes/` de tu proyecto y después entre los distribuidos.

Se distribuyen cinco temas, todos con el mismo contenido y el mismo contrato: **`default`** (Source Sans 3, jerarquía sobria con versalitas y fechas alineadas), **`classic`** (serif Libertinus, cabecera centrada bajo un doble filete, secciones en mayúsculas y cuerpo justificado), **`modern`** (franja de acento en la cabecera, columna lateral con contacto, skills e idiomas, periodos en pastillas), **`academic`** (serif de una columna para trayectorias largas: secciones numeradas, fechas al margen y pie «Nombre · página X de Y») y **`minimal`** (monocromo, sin filetes ni columnas, pensado para los sistemas de filtrado de candidaturas). Míralos en la [galería de temas](./theme-gallery) y parte de cualquiera con `cv theme create mio --from <tema>`.

Un tema puede declarar en `[theme]` quién lo firma: `author`, `license` (se sugiere un identificador SPDX) y `homepage` (URL `https`); `cv theme list` los muestra junto a la descripción. También qué aporta, con `kind` (T-8.12): `organization` cambia el orden y la agrupación de las secciones (`chronological`, `functional`, `hybrid`, `skills-first`, `project-portfolio`, `one-page`) y `style` mantiene la cronológica inversa y cambia la maquetación (los nueve estilos: `default`, `classic`, `academic`, `awesome`, `executive`, `minimal`, `modern`, `tech`, `timeline`). `cv theme list`, la [galería](./theme-gallery) y el selector de la interfaz web agrupan por él; un tema sin `kind` sale como «sin clasificar».

```bash
cv theme list                                                        # qué temas hay, de dónde salen y cuál es el de por defecto
cv theme create mio --from classic                                   # 1. themes/mio/ en tu proyecto a partir de un tema existente
$EDITOR themes/mio/theme.toml                                         # 2. colores, fuentes, tamaños, márgenes o papel, sin tocar código
cv generate-cv -s backend --format pdf --engine typst --theme mio    # 3. genera con tu tema
cv theme path classic                                                # dónde vive un tema, para mirarlo o copiar sus ficheros
```

Un extracto de `themes/default/theme.toml` (el fichero completo está comentado):

```toml
[colors]
primary = "#1b1b1b"      # nombre y títulos de entrada
secondary = "#5c5c5c"    # metadatos, fechas y etiquetas de sección
accent = "#1f4e79"       # enlaces

[fonts]
body = "Source Sans 3"   # Source Sans 3 (templates/fonts), las embebidas en Typst o .ttf/.otf en themes/mio/fonts/

[sizes]                  # en puntos
name = 24
body = 10

[page]
paper = "a4"             # a4, a5, a3, us-letter, us-legal

[page.margins]           # en milímetros
top = 17
```

Una clave desconocida, un color que no sea `#rrggbb` o un tamaño fuera de rango se rechazan con la ruta del error (`colors.primary: …`) antes de arrancar Typst.

## Temas de la comunidad: `cv theme install` y `cv theme verify`

Un tema se comparte como un archivo `.zip` o `.tar.gz` con `theme.toml`, `template.typ` y, si hace falta, `fonts/`, `README.md` y `LICENSE` (opcionalmente dentro de un único directorio raíz con el nombre del tema). Se instala en `themes/<nombre>/` de tu proyecto desde una URL `https://` o desde un archivo o directorio local:

```bash
cv theme install https://ejemplo.org/temas/comunidad.zip --sha256 <huella>   # 1. pide consentimiento, descarga (máximo 8 MiB), lee el archivo en el propio proceso y contrasta la huella publicada por su autor
cv theme install ~/Descargas/comunidad.zip --as mi-comunidad --dry-run       # solo el plan: entradas admitidas, tamaños, huellas y nombre; nada se escribe
cv theme install ../otro-proyecto/themes/mio                                 # un directorio local vale igual (sin red, sin pregunta)
cv theme verify comunidad                                                    # 2. intacto, modificado localmente (qué fichero) o sin origen; código 1 si hay diferencias
cv theme list --verify                                                       # el origen de cada tema instalado y su estado
cv generate-cv --format pdf --engine typst --theme comunidad                 # 3. se ejecuta contenido, como todos los temas
```

Antes de descargar, `cv` anuncia la URL, el host y el límite, y pide confirmación (`--yes` la da por adelantado; sin terminal y sin `--yes`, cancela sin tocar la red). Solo `https://`, también tras redirecciones. El archivo se lee **sin `tar` ni procesos**, con una política cerrada: un único directorio raíz opcional, solo los ficheros de un tema (`theme.toml`, `template.typ`, `README.md`, `LICENSE`, `fonts/<nombre>.ttf|otf`, con nombres en minúsculas, dígitos y guiones), sin `..`, rutas absolutas, enlaces ni dispositivos, y con límites (2 MiB por fichero, 8 MiB por fuente, 16 MiB en total, 40 entradas); cualquier otra cosa es un error que nombra la entrada. `theme.toml` se valida antes de escribir nada y nunca se sobrescribe un tema: `--replace` aparta el anterior a `themes/<nombre>.<marca>.bak/`.

La instalación deja `themes/<nombre>/.origin.json` con el origen, la huella SHA-256 del archivo y la de cada fichero (confianza en el primer uso: contrasta la huella con la que publica el autor con `--sha256`). `cv theme verify` las recalcula; un tema creado con `cv theme create` o copiado a mano no tiene origen y no es sospechoso: simplemente no lo tiene. Un tema instalado se ejecuta con la misma contención que los distribuidos (sin red, sin paquetes, sin salir de su directorio, con límites de tiempo y memoria); el riesgo residual es de contenido —un tema que maquete mal o engañe visualmente—, y por eso `--dry-run`, el origen y la huella quedan a la vista.

**Publicar un tema**: empaqueta el directorio (`zip -r comunidad.zip comunidad/` o `tar czf comunidad.tar.gz comunidad/`), publica el archivo por https junto a su huella (`sha256sum comunidad.zip`) y explica en `README.md` qué cambia y qué tipografías usa (las que no vengan con Typst o con Chameleon CV van en `fonts/`).

## `cv.toml`: el centro de configuración del proyecto

Un fichero opcional en la raíz del proyecto cuya sección `[theme]` elige el tema por defecto (`name`; `--theme` prevalece) y **anula** valores del `theme.toml` del tema en uso —con su mismo vocabulario y su misma validación— solo para esa ejecución, sin bifurcar el tema. `--explain` dice qué tema se usa y qué anula.

```toml
[theme]
name = "classic"          # tema por defecto del proyecto

[theme.colors]
primary = "#7a1f1f"       # anula solo esta clave del theme.toml de classic
```

## Plantillas propias

Para cambiar la **maquetación**, edita `template.typ` del tema: debe exportar `cv(d, theme)`, que recibe la vista estructurada (nombre, contacto, resumen, experiencias, proyectos, skills, logros, formación, certificaciones e idiomas, con el Markdown en línea ya descompuesto) y el tema ya validado; `-t plantilla.typ` sigue sirviendo para una plantilla suelta. El contrato completo, las reglas del contenedor y un ejemplo mínimo: [Plantillas Typst propias](/design/plantillas-typst). Tutorial: [Tu propio tema](/tutorials/own-theme).

::: warning Un detalle tipográfico que importa a los ATS
Un `tracking` alto en mayúsculas hace que los extractores de texto (pdf.js y cualquier ATS) lean «E X P E R I E N C I A». Los temas distribuidos lo fijan en 0,05 em y la suite comprueba con el binario real que el texto extraído conserva exactamente las palabras.
:::
