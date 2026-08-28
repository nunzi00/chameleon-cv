# Plantillas Typst propias

| | |
|---|---|
| **Tarea** | T-3.4 · [RENDER] Diseño tipográfico y documentación final (Hito 3); T-5.1 · [RENDER] Sistema de temas (Hito 5) |
| **Estado** | Guía de usuario vigente desde el 2026-08-28; actualizada el 2026-08-29 con los temas (T-5.1). |
| **Autor** | Claude (Director Técnico) |
| **Base** | `docs/typst-integration.md` (§3.3 contención, §4 lenguaje), `themes/default/template.typ` y `themes/default/theme.toml` (tema de referencia), `src/themes/` (cargador y validación), `src/renderers/structured/view.ts` (contrato de datos). |

## 1. Qué es una plantilla y qué recibe

Con `--engine typst`, Chameleon CV no interpreta tu Markdown en Typst ni le pasa el perfil crudo: construye una **vista estructurada** (`StructuredView`), la serializa a JSON y genera un documento principal de dos líneas que importa tu plantilla y llama a su función `cv`:

```typst
#import "/template.typ": cv
#cv(json(bytes("…JSON de la vista…")), json(bytes("…JSON del tema…")))
```

Tu plantilla, por tanto, debe **exportar una función `cv(d, theme)`** que reciba la vista (§2) y el tema (§2.1) y devuelva contenido. Con `--theme <nombre>` eliges el tema —`themes/<nombre>/template.typ` más su `theme.toml`, buscado primero en `themes/` de tu proyecto y después entre los distribuidos—; con `-t` puedes usar una plantilla suelta, que recibe el mismo `theme`. Todo lo demás (página, fuentes, colores, orden de secciones) lo decides tú.

```bash
cv generate-cv -s backend --format pdf --engine typst --theme mio
cv generate-cv -s backend --format pdf --engine typst -t plantillas/mi-plantilla.typ   # plantilla suelta (recibe el tema default)
```

## 2. Contrato de datos (`d`)

Claves siempre presentes salvo las marcadas como opcionales (ausentes, no `null`: usa `d.at("clave", default: none)`).

| Clave | Tipo | Contenido |
|---|---|---|
| `locale`, `lang` | str | Idioma de la vista (`es-ES`) y código de dos letras (`es`) para `set text(lang:)`. |
| `labels` | dict | Etiquetas ya traducidas: `experience`, `projects`, `skills`, `achievements`, `education`, `certifications`, `languages`, `technologies`, `link`, `present`… |
| `fullName` | str | Nombre completo. |
| `headline` | str, opcional | Titular (el de la especialidad, si la hay). |
| `contact` | runs | Línea de contacto ya compuesta (`Madrid · ada@…`) con enlaces como runs con `link`. |
| `summary` | blocks | Resumen (párrafos y listas). |
| `experience[]` | `role`, `company`, `period`, `location?`, `summary` (blocks), `achievements[]`, `technologies` (str, puede ser `""`) | Experiencias en el orden del perfil. |
| `projects[]` | `name`, `role?`, `meta` (periodo · URL, puede ser `""`), `summary`, `achievements[]`, `technologies` | Proyectos. |
| `skillGroups[]` | `label`, `names` | Skills agrupadas por categoría, ya ordenadas (con oferta: por puntuación; ancladas primero). |
| `achievements[]` | `runs`, `impact?` | Logros transversales. |
| `education[]` | `degree`, `field?`, `institution`, `period` | Formación. |
| `certifications[]` | `name`, `issuer?`, `date` (puede ser `""`), `url?` | Certificaciones. |
| `languages[]` | `name`, `level` | Idiomas (nivel ya traducido). |

Tipos compuestos:

- **run**: `{ text: str, bold: bool, italic: bool, code: bool, link?: str }`. Es el Markdown en línea ya descompuesto: tu plantilla solo aplica `strong`, `emph`, `raw` y `link`.
- **blocks**: lista de `{ runs: [run], bullet: bool, code: bool }`; `bullet: true` es un ítem de lista.
- **achievement**: `{ runs: [run], impact?: str }`.

El JSON exacto del CV de ejemplo está en [`docs/poc/typst/cv-backend.json`](poc/typst/cv-backend.json). Los tabuladores llegan ya convertidos en espacios; nada lleva Markdown sin procesar.

## 2.1 Contrato del tema (`theme`)

El segundo argumento es el `theme.toml` del tema, ya validado por la CLI (`src/themes/schema.ts`): claves fijas, colores `#rrggbb` en minúsculas, números sin unidad (la plantilla los convierte: `theme.sizes.body * 1pt`, `theme.page.margins.top * 1mm`, `theme.spacing.leading * 1em`).

| Clave | Contenido |
|---|---|
| `theme` | `name?` (debe coincidir con el directorio), `description?`, `version` (1). |
| `colors` | `text` (cuerpo), `primary` (nombre y títulos de entrada), `secondary` (metadatos, fechas, etiquetas de sección), `accent` (enlaces), `rule` (reglas). |
| `fonts` | `body`, `heading`, `mono`: familias disponibles en `templates/fonts`, embebidas en Typst o en `themes/<nombre>/fonts/`. |
| `sizes` | `name`, `headline`, `contact`, `section`, `title`, `meta`, `body`, `footer`, `code`, en puntos (4–72). |
| `spacing` | `leading`, `paragraph`, `list`, en em (0.1–4). |
| `page` | `paper` (`a4`, `a5`, `a3`, `us-letter`, `us-legal`) y `margins.top/right/bottom/left` en milímetros (0–80). |

Una clave desconocida o un valor fuera de rango se rechaza con su ruta antes de arrancar Typst; una plantilla que ignore el tema sigue siendo válida (solo tiene que aceptar el argumento).

## 3. Cómo empezar: copia el tema de referencia

La forma recomendada es copiar el tema [`themes/default`](../themes/default) a tu proyecto y editarlo:

```bash
cp -r /ruta/a/chameleon-cv/themes/default themes/mio
cv generate-cv -s backend --format pdf --engine typst --theme mio
```

`template.typ` está organizado en cuatro partes reutilizables: **estilos derivados del tema** (`styles(theme)`: colores, fuentes, tamaños, espaciados y márgenes ya convertidos a unidades Typst), **runs y bloques** (`run`, `runs`, `blocks`, `achievement`: no necesitas tocarlas), **piezas** (`section`, `entry`, `technologies`, `container`, `row`; todas reciben `s`, los estilos) y el **documento** (`cv(d, theme)`), donde está la página, la tipografía y el orden de las secciones. Cambiar colores, fuentes, tamaños, espaciados o márgenes es editar `theme.toml`; reordenar o suprimir secciones, la última parte de `template.typ`.

Reglas del diseño de referencia, por si quieres conservarlas: jerarquía por tamaño y peso (nombre 24 pt, títulos de entrada 10,8 pt semibold, cuerpo 10 pt), secciones en versalitas espaciadas sobre una regla fina, fechas alineadas a la derecha en la misma línea que el título, skills en tabla de dos columnas, ubicación e impacto en gris, sin justificar ni partir palabras, y pie de página con nombre y `n / total` solo cuando hay más de una página. Los títulos de entrada y sección son «pegajosos» (`sticky: true`): nunca quedan huérfanos al final de una página.

## 4. Lo que tu plantilla puede y no puede hacer

La plantilla se ejecuta dentro del **contenedor** de `docs/typst-integration.md` §3.3, que no se relaja para plantillas propias:

- **Root = el directorio de tu plantilla** (`--root`). Puedes `#import` o `#read` ficheros que estén ahí (por ejemplo, otro `.typ` con tus helpers o una imagen), y nada fuera: `read("../…")` falla con «would escape the project root».
- **Sin paquetes**: `#import "@preview/…"` falla en milisegundos (sin red y sin caché de paquetes). Copia lo que necesites a tu directorio.
- **Fuentes**: solo las de `templates/fonts` (Source Sans 3 Regular, Semibold e Italic), las de `themes/<nombre>/fonts/` si el tema las trae, y las embebidas en Typst (Libertinus Serif, New Computer Modern, DejaVu Sans Mono). No se leen fuentes del sistema; para reproducibilidad, si nombras otra familia obtendrás la sustitución de Typst. Con Source Sans 3, `set strong(delta: 200)` hace que la negrita use Semibold.
- **Tiempo y tamaño**: 20 s y 32 MiB de PDF. Una plantilla que no compila devuelve el diagnóstico de Typst con código 1.
- **Reproducibilidad**: la fecha del PDF la fija la CLI (`meta.updatedAt` del perfil o una constante); no la sobrescribas en `set document`.

## 5. Iterar rápido sobre el diseño

Para ver el resultado sin pasar por la CLI cada vez, usa el JSON de ejemplo y un documento principal como el de [`docs/poc/typst/main.typ`](poc/typst/main.typ) apuntando a tu plantilla, y compila a PNG:

```bash
typst compile main.typ pagina-{p}.png --format png --ppi 110 \
  --root . --font-path /ruta/a/chameleon-cv/templates/fonts --ignore-system-fonts
```

(`--root .` y `--ignore-system-fonts` reproducen las condiciones reales.) Cuando te guste, genera el CV de verdad con `cv generate-cv … -t mi-plantilla.typ`. Para comprobar que no se ha perdido texto por el camino, la suite del proyecto extrae el texto del PDF (T-2.5) y lo compara con un golden (`tests/fixtures/golden/cv-backend.typst.txt`); puedes hacer lo mismo con tu plantilla desde Node: `require('./dist/pdf').extractPdfText(bytes)`.

## 6. Ejemplo mínimo

Una plantilla completa y válida en veinte líneas (sin runs de resumen ni logros, solo para ver el contrato):

```typst
#let cv(d, theme) = {
  set page(paper: theme.page.paper, margin: 2cm)
  set text(font: theme.fonts.body, size: theme.sizes.body * 1pt, lang: d.lang)
  text(size: 22pt, weight: "semibold")[#d.fullName]
  linebreak()
  d.contact.map(r => if r.at("link", default: none) != none { link(r.link, r.text) } else { r.text }).join()
  if d.experience.len() > 0 {
    heading(level: 2, d.labels.experience)
    for e in d.experience [
      *#e.role* · #e.company #h(1fr) #e.period \
      #for a in e.achievements [- #a.runs.map(r => r.text).join()]
    ]
  }
}
```
