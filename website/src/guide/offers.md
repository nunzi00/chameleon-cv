---
title: Adaptar el CV a una oferta
---
# Adaptar el CV a una oferta de empleo

Guarda la oferta en un fichero de texto **o en PDF** (el texto se extrae en un proceso aislado, con límites de 10 MiB y 50 páginas), o pégala por la entrada estándar, y:

```bash
cv analyze-offer ofertas/acme-backend.txt          # ¿encajo? qué demuestro, qué no y qué me falta
cv generate-cv -f ofertas/acme-backend.txt         # CV afinado: output/cv-<nombre>-acme-backend.md
cv generate-cv -f ofertas/acme-backend.txt -s backend --top-n 4 --max-skills 12
cv generate-cv -f - --compact < oferta.txt         # oferta por stdin, preset de una página
```

Cómo funciona, en tres frases: **`--specialty` elige la versión del CV, `--from-job-offer` la afina y los límites la condensan.**

## El perfil es el diccionario

La oferta se lee buscando tu propio vocabulario: tags, nombres y alias de tus skills (`k8s`, `tech lead`). Lo que la oferta pide y tu perfil ni siquiera tiene etiquetado sale como *carencia*. Si tienes algo y no se reconoce, etiquétalo o añade un alias en `skills.csv`. No hay magia: no se inventan requisitos ni se interpretan sinónimos que tú no hayas declarado.

## Puntuación transparente

Cada requisito pesa según dónde aparece —`Requisitos` 1.0 · resto 0.75 · `Deseable` 0.5, con refuerzo por repetición— y cada ítem suma los pesos de sus etiquetas. Los logros dentro de cada experiencia y las skills se reordenan por puntuación; experiencias, formación, proyectos y certificaciones siguen cronológicos. `--explain` enseña cada número. Especificación: [Extracción de palabras clave y puntuación](/design/scoring).

## Recorte «N mejores»

- `--top-n` limita los logros por experiencia/proyecto y los transversales; `--max-skills`, `--max-projects` y `--max-certifications`, el resto.
- `--compact` equivale a `--top-n 4 --max-skills 12 --max-projects 4 --max-certifications 5`: el preset de una página.
- Los ítems sin etiquetas puntúan 0: van detrás y son los primeros en caer. Sin oferta, todos puntúan 0 y `--top-n` conserva los N primeros tal como los escribiste.
- `#pin` nunca se recorta. Especificación: [Recorte «N mejores» y CLI de adaptación](/design/trimming-cli).

## `cv analyze-offer`

Analiza sin generar: adecuación global, evidencias (qué ítems del perfil demuestran cada requisito) y carencias. `--explain` da la auditoría por ítem; `--json` lo mismo en JSON para scripts; `-s` acota el análisis a una especialidad; `<offer>` puede ser `-` (stdin). Referencia: [`cv analyze-offer`](/reference/analyze-offer).

## Ofertas en PDF

El PDF se procesa en un *worker* aislado con límites (10 MiB, 50 páginas, 20 s, 512 MB), sin cargar fuentes ni renderizar; solo se extrae el texto. Un PDF escaneado sin capa de texto no aporta nada: pega el texto a mano.

Tutorial paso a paso: [Un CV para tres ofertas](/tutorials/three-offers).
