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
cv generate-cv -s backend -o cv/backend.md    # otra ruta de salida
```

## El fichero de salida

Por defecto, `output/cv-<nombre>[-<especialidad>][-<oferta>].md` (o `.pdf`), con permisos 0600. `<nombre>` sale de `fullName`, `<especialidad>` de `-s` y `<oferta>` del nombre del fichero de la oferta. `-o` fija otra ruta; `--stdout` imprime el Markdown (solo Markdown).

## Artefacto al día

Si editas las fuentes y olvidas recompilar, `generate-cv` te avisa: `Aviso: experience/acme.md es más reciente que el artefacto; ejecuta «cv build»`. Con `--build`, `generate-cv` (y `analyze-offer`) recompilan el artefacto antes de trabajar. `-d` indica dónde están las fuentes solo para ese aviso.

## Markdown y plantillas propias

El Markdown se renderiza con Handlebars a partir de un **modelo de vista ya formateado**: fechas según el idioma, periodos, skills agrupadas por categoría, línea de contacto. La plantilla base es [`templates/cv.md.hbs`](https://github.com/nunzi00/chameleon-cv/blob/main/templates/cv.md.hbs); cópiala, adáptala y pásala con `--template mi-plantilla.hbs`. Las etiquetas de sección (`labels.experience`, `labels.present`…) salen del idioma (`locale` del perfil o `--locale`): hay tablas en castellano e inglés.

## PDF

`--format pdf` usa **pdfkit** por defecto: cero dependencias externas, la fuente Source Sans 3 embebida (licencia OFL) y un resultado correcto, maquetado con código a partir del mismo modelo de vista (no admite `--template` ni `--stdout`). Para un CV de **calidad de publicación** —jerarquía tipográfica, kerning y silabación profesionales, PDF etiquetado y determinista—, `--engine typst` con sus temas: [Typst y temas](/guide/typst-themes).

Ambos motores parten de la **misma vista estructurada** del perfil: cambia la maquetación, nunca el contenido (la suite lo comprueba extrayendo el texto de los dos PDF).

## `--explain`

Cuenta cada decisión, por sección e ítem, en stderr: qué entró y por qué (`universal`, `match`, `via-achievements`, `pinned`), qué quedó fuera (`no-match`), qué puntuó cuánto con una oferta y qué se recortó. Es la herramienta para entender un CV que no es el que esperabas: casi siempre la respuesta es una etiqueta que falta o que sobra.

## Códigos de salida

`0` correcto · `1` datos inválidos (fuentes, artefacto o especialidad desconocida) · `2` uso incorrecto o fallo del entorno (permisos, disco, plantilla ilegible, Typst ausente).

## Elegir skills y proyectos a mano

Además de los límites por cantidad (`--max-skills`, `--max-projects`), puedes decir exactamente qué skills y qué proyectos van al CV: `--skills` y `--projects` admiten nombres o ids separados por comas (sin distinguir mayúsculas ni acentos) y se aplican **antes** del límite por cantidad; los nombres que no existen en el perfil se avisan y se ignoran. En la interfaz web, Generar ofrece dos selectores múltiples alimentados por tu perfil.

```bash
cv generate-cv -s backend --skills "PHP,Kubernetes,Kafka" --projects proj-kafka-guardian --explain
```
