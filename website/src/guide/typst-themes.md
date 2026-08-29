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

Se distribuyen dos temas: **`default`** (Source Sans 3, jerarquía sobria con versalitas y fechas alineadas) y **`classic`** (serif Libertinus, cabecera centrada bajo un doble filete, secciones en mayúsculas y cuerpo justificado: aire académico o tradicional). Ambos maquetan exactamente el mismo contenido.

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
