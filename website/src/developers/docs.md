---
title: Documentación (Docs-as-Code)
---
# Documentación como código

El portal vive en `website/` (VitePress, con su propio `package.json` aislado del producto) y se publica en GitHub Pages en cada push a `main`. Es un canon del proyecto (**C15, «La documentación es código verificable»**): la documentación se genera desde el código cuando puede y se ejecuta cuando describe un flujo. Especificación: [Portal de documentación](/design/docs-portal).

## Órdenes

```bash
npm run docs:dev          # servidor local con recarga (genera antes la referencia y sincroniza)
npm run docs:build        # generación + build estático (falla con enlaces internos muertos)
npm run docs:tutorials    # ejecuta los tutoriales contra dist/index.js (o -- --binary build/sea/cv)
npm run docs:check        # todo lo anterior: es lo que ejecuta la CI
```

## Qué se genera y qué se escribe a mano

| Contenido | Origen |
|---|---|
| Referencia de comandos (`/reference/`) | Generada por `scripts/docs/reference.ts` desde la ayuda de commander (`cv <comando> --help`) con ancho fijo; los ejemplos de cada comando se escriben a mano en `website/examples/<comando>.md` y son obligatorios para cada comando hoja. |
| Notas de diseño (`/design/`), `CHANGELOG`, `CONTRIBUTING`, `ROADMAP`, licencia | Sincronizadas por `scripts/docs/sync.ts` desde su ubicación en el repositorio, con los enlaces relativos reescritos (páginas del portal o ficheros en GitHub). Se editan en el original. |
| Guía, tutoriales y sección de desarrolladores | A mano, en `website/src/`. |

Los ficheros generados no se versionan (`website/.gitignore`): cada build parte del código.

## Tutoriales ejecutables

Una página es un tutorial ejecutable si su cabecera declara `verify:` (ficheros o patrones que deben existir al terminar). Sus bloques ```` ```bash tutorial ```` se ejecutan en orden, cada uno con `sh -e`, en un espacio de trabajo temporal vacío con entorno mínimo y `cv` resuelto al binario:

````markdown
---
title: Mi tutorial
verify:
  - data/dist/profile.json
  - output/cv-*.md
---

```bash tutorial
cv init
cv build
```

```bash tutorial needs-typst
cv generate-cv --format pdf --engine typst
```
````

- `needs-typst`: el bloque solo corre si hay un Typst utilizable (`CHAMELEON_TYPST` o la caché de usuario); si no, se **omite de forma visible**.
- `needs-llm`: solo con `CHAMELEON_DOCS_LLM=1` y un modelo local en marcha; la CI nunca lo ejecuta.
- `needs-docker`: solo con `CHAMELEON_DOCS_DOCKER=1`, un demonio de Docker y la imagen `chameleon-cv:local` (`npm run docker:build`); el trabajo `docker` de la CI lo ejecuta.
- `files:` en la cabecera copia ficheros del repositorio al espacio de trabajo (los ficheros de Compose del tutorial 5); `cleanup:` ejecuta órdenes al terminar (`docker compose down -v`).
- Los bloques sin la palabra `tutorial` son ilustrativos y no se ejecutan (instalación, órdenes con proveedores remotos…).
- Cada bloque parte del directorio raíz del espacio de trabajo (un `cd` no persiste entre bloques).

## Añadir una página

1. Escríbela en `website/src/<sección>/` y enlázala en la barra lateral (`website/.vitepress/config.mts`).
2. Enlaces internos absolutos (`/guide/offers`), sin extensión; el build falla con un enlace muerto.
3. Sin HTML crudo: el portal lo desactiva para que `<nombre>` en prosa sea texto.
4. `npm run docs:check` antes de la PR.

## Despliegue

`.github/workflows/pages.yml` construye el portal en cada pull request y lo despliega en GitHub Pages en cada push a `main` (`https://nunzi00.github.io/chameleon-cv/`). La ruta base se fija con `DOCS_BASE`; el nombre del repositorio se lee de `package.json` (`repository.url`), única fuente de verdad, y `docs:check` falla si algún enlace a GitHub no coincide.
