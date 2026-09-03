---
title: Generar el CV
---
# Generar el CV

`cv generate-cv` lee el artefacto (`data/dist/profile.json`), aplica la selección y escribe el CV. Referencia completa de opciones: [`cv generate-cv`](/reference/generate-cv).

```bash
cv generate-cv --specialty backend            # output/cv-<nombre>-backend.md
cv generate-cv                                # CV completo, sin selección
cv generate-cv -s backend --explain           # además, explica en stderr qué se incluyó y por qué
cv generate-cv -s backend --stdout            # imprime el Markdown en lugar de escribir un fichero
cv generate-cv -s backend --format pdf        # output/cv-<nombre>-backend.pdf (pdfkit, fuente embebida)
cv generate-cv -s backend --format odt        # documento abierto, para seguir editándolo a mano
cv generate-cv -s backend -o cv/backend.md    # otra ruta de salida
```

## El fichero de salida

Por defecto, `output/cv-<nombre>[-<especialidad>][-<oferta>].md` (o `.pdf`, o `.odt`), con permisos 0600. `<nombre>` sale de `fullName`, `<especialidad>` de `-s` y `<oferta>` del nombre del fichero de la oferta. `-o` fija otra ruta; `--stdout` imprime el Markdown (solo Markdown).

## Artefacto al día

Si editas las fuentes y olvidas recompilar, `generate-cv` te avisa: `Aviso: experience/acme.md es más reciente que el artefacto; ejecuta «cv build»`. Con `--build`, `generate-cv` (y `analyze-offer`) recompilan el artefacto antes de trabajar. `-d` indica dónde están las fuentes solo para ese aviso.

## ODT: el CV para seguir editándolo

`--format odt` da un **documento abierto** (OpenDocument, estándar ISO) que abren **LibreOffice, Word y Google
Docs**. Es la salida para cuando alguien te pide el CV «en un documento» y quieres retocarlo a mano: el PDF es
para entregar y el Markdown para versionar.

Está pensado para editarse, no para imprimirse. Usa **estilos con nombre**, así que cambiar el aspecto de todas
las secciones es tocar **un** estilo (Formato → Estilos en LibreOffice) en vez de repasar el documento; la
estructura es plana, sin cajas ni columnas, para poder reordenar sin pelearse con el maquetado; y las negritas,
cursivas y enlaces llegan como estilos y enlaces de verdad.

Es el **mismo CV** que las demás salidas: misma especialidad, misma oferta, mismos recortes. `--engine` y
`--template` no aplican (la plantilla es código Typst) y `--stdout` tampoco, porque es binario.

### Y hereda el tema

```bash
cv generate-cv --format odt --theme functional   # otra organización, en un documento editable
cv generate-cv --format odt --theme elegant      # otra tipografía y otro color
cv theme list                                    # los temas, con su clase
```

`--theme` **sí** vale con `--format odt`. El documento hereda del tema los **colores**, las **tipografías**, los
**tamaños**, el **interlineado** y la **página** —todo en estilos con nombre, que es lo que después tocas— y,
de su `[layout]`, la **organización**: qué sección va antes, si los logros se consolidan fuera de su puesto (con
la empresa de origen) y si la experiencia se cuenta en una línea por puesto.

Ocho temas del catálogo declaran su organización: `functional`, `achievements-first`, `skills-first`, `hybrid`,
`education-first`, `project-portfolio`, `ats-plain` y `chronological`. El resto sí aporta su tipografía y su
color al ODT, pero mantiene el orden por defecto, porque **su** organización vive en la maquetación —columnas
laterales, tablas a dos columnas, ejes temporales fusionados— y eso no se reproduce en un documento pensado para
editarse a mano. Se dice en vez de fingirlo.

En la web, el selector «Formato» de **Generar** tiene la opción «ODT (documento editable)» y el selector «Tema»
queda activo con ella; en **Salidas** se descarga (no se previsualiza: no es texto ni PDF).

## Markdown y plantillas propias

El Markdown se renderiza con Handlebars a partir de un **modelo de vista ya formateado**: fechas según el idioma, periodos, skills agrupadas por categoría, línea de contacto. La plantilla base es [`templates/cv.md.hbs`](https://github.com/nunzi00/chameleon-cv/blob/main/templates/cv.md.hbs); cópiala, adáptala y pásala con `--template mi-plantilla.hbs`. Las etiquetas de sección (`labels.experience`, `labels.present`…) salen del idioma (`locale` del perfil o `--locale`): hay tablas en castellano e inglés.

## PDF

`--format pdf` usa **pdfkit** por defecto: cero dependencias externas, la fuente Source Sans 3 embebida (licencia OFL) y un resultado correcto, maquetado con código a partir del mismo modelo de vista (no admite `--template` ni `--stdout`). Para un CV de **calidad de publicación** —jerarquía tipográfica, kerning y silabación profesionales, PDF etiquetado y determinista—, `--engine typst` con sus temas: [Typst y temas](/guide/typst-themes).

Ambos motores parten de la **misma vista estructurada** del perfil: cambia la maquetación, nunca el contenido (la suite lo comprueba extrayendo el texto de los dos PDF).

## `--explain`

Cuenta cada decisión, por sección e ítem, en stderr: qué entró y por qué (`universal`, `match`, `via-achievements`, `pinned`), qué quedó fuera (`no-match`), qué puntuó cuánto con una oferta y qué se recortó. Es la herramienta para entender un CV que no es el que esperabas: casi siempre la respuesta es una etiqueta que falta o que sobra.

## Códigos de salida

`0` correcto · `1` datos inválidos (fuentes, artefacto o especialidad desconocida) · `2` uso incorrecto o fallo del entorno (permisos, disco, plantilla ilegible, Typst ausente).

## Evidencias de la oferta conservadas

Con `--from-job-offer`, lo que demuestra un requisito de la oferta no se recorta por `--top-n`, `--compact` ni
`--max-*` (cuenta para el límite; se cortan los demás). `--explain` lo lista y `--no-keep-evidence` lo desactiva.
Más en [Ofertas → Generar con la adecuación](./offers#generar-con-la-adecuacion).

## Elegir skills y proyectos a mano

Además de los límites por cantidad (`--max-skills`, `--max-projects`), puedes decir exactamente qué skills y qué proyectos van al CV: `--skills` y `--projects` admiten nombres o ids separados por comas (sin distinguir mayúsculas ni acentos) y se aplican **antes** del límite por cantidad; los nombres que no existen en el perfil se avisan y se ignoran. En la interfaz web, Generar ofrece dos selectores múltiples alimentados por tu perfil.

```bash
cv generate-cv -s backend --skills "PHP,Kubernetes,Kafka" --projects proj-kafka-guardian --explain
```
