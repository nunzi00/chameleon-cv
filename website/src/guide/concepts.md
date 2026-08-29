---
title: Conceptos
---
# Conceptos

Chameleon CV separa **lo que sabes de ti** de **cómo lo presentas**. Cinco ideas bastan para entender todo lo demás.

## Fuentes, artefacto y CV

```
data/sources/ (tú editas)  ──cv build──►  data/dist/profile.json  ──cv generate-cv──►  output/cv-<nombre>-<especialidad>.md | .pdf
```

- **Fuentes** (`data/sources/`): ficheros Markdown y CSV que escribes y versionas tú. Son la única fuente de verdad: una experiencia por fichero, logros como viñetas, skills en una tabla.
- **Artefacto** (`data/dist/profile.json`): el perfil compilado y validado por `cv build`. Es la puerta de calidad: si las fuentes tienen un error, no hay artefacto. Se re-valida cada vez que se lee y nunca se versiona (contiene datos personales en claro).
- **CV** (`output/`): lo que genera `cv generate-cv` a partir del artefacto: Markdown (a través de una plantilla) o PDF (pdfkit o Typst). Tampoco se versiona.

Hay una segunda capa, opcional, encima de la primera: el [co-piloto de IA](/guide/copilot), que solo **propone** cambios sobre las fuentes y nunca los aplica sin tu marca.

## Especialidades

Una especialidad es una «versión» de tu CV: `specialties/backend.md`, `specialties/engineering-manager.md`… Cada una define el **titular**, un **resumen** opcional y su **vocabulario** de etiquetas:

```markdown
---
title: Senior Backend Engineer
tags: [php, symfony, kubernetes, kafka]
---

Resumen específico para este tipo de puesto.
```

`cv generate-cv -s backend` produce el CV de esa versión. Sin `-s`, el CV completo.

## Etiquetas y la regla de selección

Las etiquetas (`#php`, `#kubernetes`…) van al final de cada logro, o en `tags` del frontmatter de una experiencia, proyecto o skill. La regla de selección cabe en una frase:

> **Sin etiquetas, siempre; con etiquetas, solo si alguna coincide** con el vocabulario de la especialidad (o con su id: `#backend` fija un ítem a esa especialidad).

Consecuencias prácticas:

- Un dataset sin etiquetar genera el CV completo para cualquier especialidad. Cada etiqueta que añades es una restricción: el etiquetado es progresivo y nunca «rompe» un CV.
- **Etiqueta los logros, no las experiencias.** Una experiencia sin etiquetas aparece en todos los CV (continuidad de la carrera); los logros etiquetados adaptan las viñetas a cada especialidad. Etiqueta una experiencia solo cuando *todo* el puesto sea irrelevante para alguna especialidad.
- Una experiencia o proyecto cuyas etiquetas no coinciden entra igualmente si alguno de sus logros coincide de forma explícita (solo con los logros relevantes).
- `--explain` muestra cada decisión: `+ experience exp-acme: universal`, `    - exp-acme-3: no-match`, `+ projects proj-platform: via-achievements`.

## `#pin`: anclar lo imprescindible

La etiqueta reservada `#pin` fija un ítem por encima de cualquier algoritmo: aparece en **toda** especialidad u oferta, va **primero** en su sección y **nunca se recorta**. Sirve para logros, experiencias, proyectos, skills y certificaciones. Anclar no cambia la adecuación medida: `pin` no puntúa ni forma parte del vocabulario de las ofertas, y `--explain` lo muestra como razón `pinned`. Un anclado consume plaza del límite; si hay más anclados que plazas, sobreviven todos ellos.

## Ofertas de empleo

Una oferta (texto, entrada estándar o PDF) afina un CV: **`--specialty` elige la versión, `--from-job-offer` la afina y los límites la condensan.** La oferta se lee buscando tu propio vocabulario —tags, nombres y alias de tus skills— y cada requisito pesa según dónde aparece. Detalle en [Adaptar el CV a una oferta](/guide/offers).

## Idioma

Las etiquetas de sección del CV (`Experiencia`, `Actualidad`…) salen del idioma: `locale` en `profile.md` o `--locale` al generar. Hay tablas en castellano e inglés. El contenido es siempre el que tú escribiste.

## Identificadores

El `id` de cada entidad sale del nombre del fichero (`experience/acme.md` → `exp-acme`; `projects/chameleon.md` → `proj-chameleon`) y el de cada logro, de su posición (`exp-acme-1`) salvo que declares `id:` en la viñeta. Los verás en `--explain` y los usarás en `--only` del co-piloto.
