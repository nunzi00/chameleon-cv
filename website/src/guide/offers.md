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

## Generar con la adecuación

Analizar y generar están conectados (T-8.9):

- **Especialidad sugerida.** `cv analyze-offer` imprime la especialidad real del perfil cuyas tags más pesan entre los
  requisitos reconocidos («Especialidad sugerida: backend (…; cubre 5 de 8 requisitos con peso)»). En la CLI solo
  se imprime; en la pantalla Generar, si el paso 1 estaba vacío, se rellena con ella y se avisa.
- **Evidencias conservadas.** Al generar con oferta, los ítems que demuestran algún requisito (logros, skills,
  proyectos y certificaciones con términos coincidentes) **no se recortan por los límites de cantidad**
  (`--top-n`, `--compact`, `--max-*`): cuentan para el límite y se cortan los demás. `--explain` los lista
  («evidencias conservadas por la oferta (no se recortan): …») y la API los devuelve en `report.kept`.
  `--no-keep-evidence` (CLI) o `keepEvidence: false` (API) recuperan el recorte puro por puntuación.
- **Un gesto en la interfaz.** El panel de adecuación tiene «Generar con esta adecuación»: conserva la oferta, usa la
  especialidad (sugerida o elegida) y genera; el aviso de éxito dice cuántas evidencias se conservaron.

## Ofertas en PDF

El PDF se procesa en un *worker* aislado con límites (10 MiB, 50 páginas, 20 s, 512 MB), sin cargar fuentes ni renderizar; solo se extrae el texto. Un PDF escaneado sin capa de texto no aporta nada: pega el texto a mano.

Tutorial paso a paso: [Un CV para tres ofertas](/tutorials/three-offers).

## Historial de ofertas procesadas

Cada `cv analyze-offer` y cada `cv generate-cv --from-job-offer` deja una entrada en `output/historial-ofertas.json` (fecha, acción, especialidad y CV escrito) identificada por la **huella del texto** de la oferta. Al volver a usar la misma oferta —pegada, extraída de su PDF o desde un fichero— el producto te lo dice antes del resultado:

```text
Esta oferta ya se procesó 2 veces:
  2026-08-30T12:10:33.000Z · generate-cv (backend) → output/cv-ada-backend-nexo.pdf
  2026-08-29T09:00:00.000Z · analyze-offer (backend)
```

En la interfaz web el aviso aparece en Generar en cuanto añades la oferta; en la API, `POST /api/v1/offers/history` consulta el historial sin efectos y las respuestas de `/analyze-offer` y `/generate` lo incluyen (`history`). El fichero es tuyo: puedes borrarlo o editarlo; se conservan las 500 entradas más recientes.
