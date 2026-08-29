# Portal de documentación (Docs-as-Code): plataforma, arquitectura de contenidos y despliegue

| | |
|---|---|
| **Tarea** | T-7.1 · [DOCS] Portal de documentación (Hito 7, pilar 1) |
| **Estado** | PROPUESTA v1 (2026-08-29) **APROBADA sin reservas** por el Director de Ingeniería y Producto el 2026-08-29, con las siete decisiones de §10 (VitePress; `website/` aislado; README puerta corta; castellano raíz y T-7.1b para el inglés; Docs-as-Code elevado a estándar de toda la documentación; repositorio `nunzi00/chameleon-cv`; canon C14). Implementación en curso (§11). |
| **Autor** | Claude (Director Técnico) |
| **Base** | Plan estratégico del Hito 7 (Director, 2026-08-29); `README.md` y `docs/*.md` de la 1.0.0; `docs/acceptance-testing.md` (cánones C12 y C13); `docs/packaging-and-release.md` §6 (acciones fijadas por SHA, permisos mínimos). Medición de las plataformas candidatas ejecutada en esta máquina el 2026-08-29 (§2). |

## 0. Resumen ejecutivo

- **Plataforma: VitePress 1.6** (fijado a `1.6.4`). Markdown-first (todo lo que ya tenemos entra tal cual), **búsqueda local integrada** (índice estático con `minisearch`: sin Algolia ni ningún servicio externo, coherente con «sin telemetría»), comprobación de **enlaces muertos en el build**, modo oscuro, `locales`, y una cadena de suministro de **173 paquetes** frente a 472 (Starlight, todavía 0.x) y 1 271 (Docusaurus). Misma familia (Vite) que Vitest.
- **Aislamiento**: el portal vive en `website/` con su propio `package.json` y `package-lock.json`. Ni un paquete más en el producto (`npm ci` de la raíz y el binario no cambian); Dependabot lo vigila como directorio aparte.
- **Una sola fuente de verdad, sin duplicar mantenimiento**: la **referencia de comandos se genera** desde la ayuda de la propia CLI (commander), los **tutoriales se ejecutan en CI** contra el binario real (canon C13 aplicado a la documentación: la documentación se prueba a sí misma), y las notas de diseño `docs/*.md`, el `CHANGELOG.md` y `CONTRIBUTING.md` se publican desde su ubicación actual, no copiados a mano.
- **Despliegue**: GitHub Pages con `.github/workflows/pages.yml` (push a `main`; en pull requests solo se construye), acciones fijadas por SHA y permisos mínimos. Ruta base configurable: el nombre del repositorio aún no está decidido.
- **Idioma**: castellano como raíz (todo el proyecto lo es). Inglés como segundo `locale` en una tarea posterior (T-7.1b) si el Director lo quiere: la estructura queda preparada.
- **README**: pasa a ser la «puerta corta» (qué es, instalación, inicio rápido, tabla de comandos, enlace al portal); el detalle largo migra al portal, que es la «puerta larga».

## 1. Objetivo y alcance

Un sitio estático, completo y navegable, versionado junto al código, con dos públicos:

- **Usuario**: instalar y generar el primer CV en menos de cinco minutos; entender cada comando y cada opción con ejemplos reales; tutoriales guiados de principio a fin.
- **Desarrollador y contribuidor**: entender la arquitectura (cánones, flujo de datos, módulos clave), montar el entorno, ejecutar las pruebas, proponer cambios y extender el producto (formatos de datos, proveedores de modelos, temas).

Fuera de alcance de T-7.1: la GUI (pilar 3), la traducción al inglés (T-7.1b), un dominio propio (más adelante, con `CNAME`) y cualquier cambio en el núcleo. Regla del hito: cada entrega termina con la suite y los arneses de aceptación en verde.

## 2. Elección de la plataforma

### 2.1 Criterios

| | Criterio | Peso | Por qué |
|---|---|---|---|
| C-a | Markdown-first y reutilización de lo existente | alto | `README.md` (310 líneas) y 14 notas de diseño ya están en Markdown con tablas y bloques de código. |
| C-b | Búsqueda **sin servicio externo** | alto | Un portal que llama a Algolia contradice «sin telemetría»; el índice debe ser estático. |
| C-c | Calidad en el build (enlaces muertos, fallo temprano) | alto | Docs-as-Code: la documentación rota rompe la CI. |
| C-d | Cadena de suministro: tamaño del árbol y madurez | alto | La misma disciplina que el producto (`docs/packaging-and-release.md` §6). |
| C-e | Modo oscuro, navegación lateral, i18n | medio | Pedidos por el Director; i18n para T-7.1b. |
| C-f | Toolchain Node conocida | medio | Un solo ecosistema (Node, npm, Vite) para todo el repositorio. |
| C-g | Diagramas | medio | Visión arquitectónica con diagramas. |
| C-h | Versionado de la documentación | bajo | Una sola línea 1.x por ahora. |
| C-i | Sitio estático desplegable en GitHub Pages | alto | Sin servidor, sin coste. |

### 2.2 Medición (2026-08-29, `npm install --package-lock-only`, registro público de npm)

| Plataforma | Versión (fecha) | Paquetes en el árbol | Búsqueda local | Enlaces muertos | i18n | Diagramas | Versionado |
|---|---|---|---|---|---|---|---|
| **VitePress** | 1.6.4 (2026-08-02) | **173** | integrada (`minisearch`) | integrada (el build falla; `ignoreDeadLinks` para excepciones) | `locales` | plugin (`vitepress-plugin-mermaid`) o SVG | no nativo |
| Starlight (Astro) | 0.41.10 + Astro 7.2.9 (2026-08-27/28) | 472 | integrada (Pagefind) | plugin | muy bueno | plugin | no nativo |
| Docusaurus | 3.10.2 (2026-07-10) | 1 271 | **no**: Algolia o plugin de terceros | integrada | bueno | `@docusaurus/theme-mermaid` | **nativo** |
| MkDocs Material | — | toolchain Python | integrada | plugin | bueno | integrado | plugin (`mike`) |

### 2.3 Decisión: VitePress

- Gana en C-a, C-b, C-c, C-d, C-f y C-i; empata en C-e; cede en C-g (plugin o SVG) y C-h (que no necesitamos en 1.x).
- Starlight es una alternativa seria (accesibilidad e i18n excelentes), pero sigue en **0.x** (API sin garantía de estabilidad) y triplica el árbol. Docusaurus multiplica por siete el árbol y exige un servicio externo o un plugin de terceros para buscar. MkDocs introduce Python en un repositorio Node.
- **Diagramas**: por defecto, **SVG versionados** en `website/src/public/diagrams/`, generados en local desde ficheros `.mmd` versionados junto a ellos (deterministas, sin navegador en CI, sin depender de un plugin de terceros); se evaluará `vitepress-plugin-mermaid` solo si los diagramas crecen. Los flujos sencillos siguen en bloques de texto, como en el README.
- **Versionado**: la documentación describe la última versión publicada; el `CHANGELOG.md` marca lo que cambia. Si en el futuro hiciera falta, cada tag publica su portal en una subruta (`/v1/`), sin cambiar de plataforma.

## 3. Arquitectura de la información (mapa del sitio)

```
Inicio                      qué es, tres comandos, enlaces a Inicio rápido · Guía · Desarrolladores
Guía de usuario
  Inicio rápido             binario desde Releases (sha256sum -c), cv init, cv build, cv generate-cv; < 5 min, verificado en CI
  Conceptos                 fuentes, artefacto, especialidades, etiquetas, #pin, idioma
  Formato de las fuentes    Markdown (frontmatter + cuerpo, logros), CSV (skills, certificaciones); reglas y errores típicos
  Generar el CV             Markdown y PDF (pdfkit), plantillas Handlebars, --explain, --stdout
  Adaptar a una oferta      analyze-offer, --from-job-offer (texto, stdin, PDF), puntuación, recortes, --compact
  Typst y temas             cv typst install/status, --engine typst, temas distribuidos, cv.toml, cv theme, plantillas propias
  Co-piloto de IA           local por defecto, improve / summarize / suggest tags / improve apply, revisión, verificación, caché, remotos y consentimiento
  Seguridad y privacidad    qué sale y qué no, permisos 0600, única operación de red, worker de PDF, claves
  Solución de problemas     códigos de salida, avisos habituales («es más reciente que el artefacto»…), Typst no encontrado, modelo no responde
Referencia de comandos      una página por comando, GENERADA desde la ayuda de la CLI (§4.2), con ejemplos y códigos de salida
Tutoriales                  1 Tu perfil desde cero · 2 Un CV para tres ofertas · 3 Tu propio tema · 4 El co-piloto con Ollama (guiones ejecutables, §4.3)
Desarrolladores
  Visión arquitectónica     cánones C1–C13, flujo parser → selector → renderer, módulos (SelectorEngine, scoring, artefacto, capa de assets, Typst contenido, LLM), diagramas SVG
  Contribuir                CONTRIBUTING.md (clonar, Node, npm ci, typecheck, coverage, arneses, convención de commits, PR)
  Pruebas                   unitarias (100 %), aceptación determinista y de IA (resumen de docs/acceptance-testing.md)
  Extender                  un formato de fuente nuevo (parsers + esquema) · un proveedor de modelos nuevo (LlmProvider, lista blanca, consentimiento) · un tema nuevo
  Empaquetado y release     resumen y enlace a la nota de diseño
  Diseño                    las notas docs/*.md publicadas tal cual (con su estado y fecha en cabecera)
Registro de cambios         CHANGELOG.md
Licencia                    MIT, OFL de las fuentes, avisos de terceros del ejecutable
```

## 4. Fuentes de contenido y no duplicación

### 4.1 Reparto entre README y portal

El README queda como puerta corta (qué es, instalación, inicio rápido, tabla de comandos, seguridad en cinco líneas, enlaces al portal); las secciones largas (formato, selección, ofertas, Typst y temas, co-piloto, proveedores remotos) migran al portal, reescritas como guía (más ejemplos, más contexto) y no como copia. El README enlaza a cada capítulo. Decisión para el Director (§10.3).

### 4.2 Referencia generada desde la CLI

`website/scripts/reference.ts` construye el programa con `createProgram` (`src/cli/program.ts`), recorre el árbol de comandos de commander (`improve apply`, `theme list|path|create`, `typst install|status`, `llm status|cache clear`, `suggest tags`…) y escribe una página por comando con `helpInformation()` (uso, descripción, opciones) más un bloque de ejemplos y códigos de salida mantenido a mano en `website/src/reference/_examples/<comando>.md`. Las páginas generadas no se versionan (se producen en `npm run docs:build` y en CI): **la ayuda de la CLI es la única fuente de verdad** y no puede desviarse de la documentación. La misma técnica alimentará, más adelante, la tabla de comandos del README (comprobación de frescura).

### 4.3 Tutoriales que se ejecutan

Cada tutorial declara en su cabecera qué produce (`verify:` con ficheros esperados) y marca sus órdenes en bloques ```` ```bash tutorial ````. `website/scripts/tutorials.ts` extrae esos bloques en orden, los ejecuta en un espacio de trabajo temporal con entorno mínimo (misma técnica que `tests/acceptance/runner.ts`) contra `dist/index.js` o `--binary`, y comprueba códigos de salida y ficheros. El tutorial 4 (co-piloto) se ejecuta hasta donde no hace falta un modelo (`cv llm status` sin servicio, `--dry-run`, `--show-payload`) y marca el resto como **omitido de forma visible**, nunca en silencio (como el arnés determinista). Así, un cambio en la CLI que rompa un tutorial rompe la CI.

### 4.4 Notas de diseño, CHANGELOG, CONTRIBUTING y LICENSE

`website/scripts/sync.ts` copia antes del build `docs/*.md` → `website/src/design/`, `CHANGELOG.md` → `website/src/changelog.md`, `CONTRIBUTING.md` → `website/src/developers/contributing.md` y `LICENSE` → `website/src/license.md`, reescribiendo los enlaces relativos (`docs/x.md` → `/design/x`, `README.md` → `/`). Los ficheros copiados no se versionan: los originales siguen siendo la fuente y se editan donde están.

## 5. Estructura del repositorio

```
website/
  package.json                 vitepress 1.6.4 fijado (sin ^); scripts: dev, build, preview, reference, tutorials, sync
  package-lock.json            árbol propio (173 paquetes), vigilado por Dependabot (directorio /website)
  .vitepress/config.mts        título, descripción, nav, sidebar, búsqueda local, base = process.env.DOCS_BASE ?? '/', lang es-ES, lastUpdated
  .vitepress/theme/            ajustes mínimos del tema por defecto (logo, colores)
  src/                         index.md, guide/, tutorials/, developers/, reference/ (generada), design/ (sincronizada), public/diagrams/
  scripts/                     reference.ts, tutorials.ts, sync.ts (ts-node con el tsconfig del proyecto)
CONTRIBUTING.md                en la raíz (GitHub lo enlaza en cada PR) y publicado en el portal
.github/workflows/pages.yml    construcción en PR, construcción + despliegue en push a main
.github/dependabot.yml         + directorio /website (npm, semanal)
package.json (raíz)            scripts docs:dev, docs:build, docs:check que delegan en website/ (sin dependencias nuevas en la raíz)
```

## 6. Despliegue: `.github/workflows/pages.yml`

- Disparadores: `push` a `main` con cambios en `website/**`, `docs/**`, `README.md`, `CHANGELOG.md`, `CONTRIBUTING.md`, `src/cli/**` (la ayuda cambia la referencia) y `workflow_dispatch`; `pull_request` solo construye (sin desplegar).
- `build` (`ubuntu-24.04`, `contents: read`): `npm ci` y `npm run build` en la raíz (la referencia y los tutoriales necesitan `dist/`), Typst desde la caché de Actions (los tutoriales 2 y 3 generan PDF con Typst), `npm run docs:check` (referencia + tutoriales + sincronización) y `npm run docs:build` (`DOCS_BASE=/<repositorio>/`), `actions/configure-pages` y `actions/upload-pages-artifact`.
- `deploy` (`needs: build`, solo en `main`; `pages: write`, `id-token: write`; entorno `github-pages`): `actions/deploy-pages`.
- Acciones fijadas por SHA con la versión anotada, `permissions: {}` por defecto, `concurrency` por rama, sin secretos.
- Activación: en la configuración del repositorio, Pages con origen «GitHub Actions». URL: `https://<propietario>.github.io/<repositorio>/` hasta que haya dominio propio.

## 7. Calidad (puertas en CI)

1. El build de VitePress falla con enlaces internos muertos.
2. La referencia se genera sin error para todos los comandos y los ejemplos manuales existen para cada uno.
3. Los tutoriales se ejecutan y sus verificaciones pasan (omisiones visibles).
4. La sincronización no deja enlaces relativos rotos (los reescritos se comprueban en el build).
5. El Inicio rápido se ejecuta literalmente contra el binario real (es un tutorial más).
6. Accesibilidad: tema por defecto de VitePress (contraste y navegación por teclado), imágenes con `alt`, un solo `h1` por página.

Sin `markdownlint` ni comprobadores de prosa por ahora: menos dependencias; el build y los guiones ejecutables son las puertas que importan.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Deriva entre README y portal | Reparto explícito (§4.1); la tabla de comandos del README se comprobará contra la ayuda de la CLI en una iteración posterior. |
| Plugin de Mermaid sin mantenimiento | SVG versionados por defecto (§2.3). |
| Ruta base de Pages dependiente del nombre del repositorio | `DOCS_BASE` en el workflow; un solo sitio que cambiar. |
| Solo castellano limita el alcance | T-7.1b (inglés) con `locales`; la estructura ya lo prevé. |
| 173 paquetes de toolchain | Solo en `website/`, solo en desarrollo y CI; versiones fijadas; Dependabot. |
| Tutoriales lentos en CI | Espacio temporal, Typst en caché, sin modelo de IA: del orden de un minuto. |

## 9. Plan de ejecución

| Paso | Contenido | Verificación |
|---|---|---|
| S1 | Andamiaje: `website/` con VitePress fijado, configuración, tema, búsqueda local, `DOCS_BASE`, scripts `docs:*` en la raíz. | `npm run docs:build` en verde con una página. |
| S2 | Guía de usuario e Inicio rápido (migración y reescritura del README), Seguridad y Solución de problemas. | Build sin enlaces muertos. |
| S3 | `reference.ts` (referencia generada + ejemplos), `tutorials.ts` (cuatro tutoriales ejecutables), `sync.ts`. | `npm run docs:check` en verde; fallo provocado en un tutorial detectado. |
| S4 | Sección de desarrolladores: visión arquitectónica con diagramas SVG, `CONTRIBUTING.md`, pruebas, guías de extensión. | Revisión del Director. |
| S5 | `pages.yml`, Dependabot, README reducido a puerta corta. | YAML validado, acciones fijadas, ensayo local de la secuencia. |
| S6 | Cierre: ROADMAP, esta nota (§11 Estado), informe. | Suite y arneses en verde (el núcleo no cambia). |

## 10. Decisiones que se piden al Director

1. **Plataforma**: VitePress (recomendado) frente a Starlight o Docusaurus.
2. **Aislamiento**: `website/` con su propio lockfile (recomendado) frente a dependencias en el `package.json` de la raíz.
3. **README**: puerta corta con migración del detalle al portal (recomendado) frente a README íntegro más portal.
4. **Idioma**: solo castellano en T-7.1, inglés en T-7.1b (recomendado).
5. **Docs-as-Code activo**: referencia generada desde `--help` y tutoriales ejecutados en CI (recomendado) frente a páginas redactadas y mantenidas a mano.
6. **Nombre del repositorio en GitHub** (ruta base de Pages, `repository` en `package.json`, enlaces del CHANGELOG): ¿`nunzi00/chameleon-cv`, como en el ejemplo de T-7.3?
7. **Canon C14**: el plan cita «Canon C12: The Core is the Product», pero C12 es «Validar el proceso, no el resultado»; se propone canonizar «El núcleo es el producto» (la GUI y cualquier cliente consumen la lógica central, nunca la reimplementan) como **C14**.

## 11. Estado de la implementación

Pendiente de aprobación.
