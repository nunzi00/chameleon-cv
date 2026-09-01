---
title: The web interface
---
# The web interface

Since version 1.2.0, `cv serve` runs a **web interface** on your machine that does what the CLI does without
touching the terminal: maintaining the sources, validating and compiling, analysing offers and generating the CV.
It travels **inside the executable and the Docker image** —nothing is downloaded from the internet— and only your
browser sees it, on `127.0.0.1`. It is one more client of the [local API](/en/guide/api): everything it shows or
writes goes through it.

Its screens are labelled in Spanish, like the CLI; the names are quoted below as they appear.

## Starting it

```bash
cv serve --open      # starts the server and opens the browser with the URL and the session token
```

```text
Chameleon CV 1.8.1 · espacio de trabajo /home/ada/my-cv
API: http://127.0.0.1:4310/api/v1/ (Authorization: Bearer <token>)
Interfaz: http://127.0.0.1:4310/#token=4f6c…e2
Ctrl-C para parar (o POST /api/v1/shutdown)
```

The URL carries the **session token** in the fragment (`#token=…`): the browser never sends it to the server. On
load, the interface stores it in the tab (it lives as long as the tab does) and strips it from the URL, so it
doesn't end up in your history or in screenshots. If you open plain `http://127.0.0.1:4310/`, it will ask you to
paste it. Every `cv serve` start generates a new token.

## The interface

A sidebar with three groups —**Perfil** (Fuentes, Estado), **Producir** (Generar, Salidas) and **Co-piloto**
(Trabajos, Revisiones, Ajustes)— plus links to this portal; it collapses to icons (and remembers it) and below
1024 px it is always collapsed. The context header, present on every screen, shows the workspace and four chips
that answer without navigating: whether the artifact is up to date, whether Typst is there, whether the co-pilot
answers and whether the server allows remotes; on the right, the theme switch (light, dark or the system's, with
no flash on load) and **Apagar**, which stops `cv serve` after confirmation.

## Estado — artifact status

![The Estado screen: the artifact card with its badge, sources, specialties and themes; Typst and the co-pilot beside it; the table of installed themes and portability](/gui/estado.png)

The same as `cv build --check`, `cv typst status` and `cv llm status` at a glance: whether the artifact is
current, stale or not built (with its specialties), whether Typst is usable, whether a local AI provider is ready
and which themes exist. **Validar** and **Compilar** do what their commands do; **Exportar perfil (JSON)** and
**Importar perfil…** are `cv export` and `cv import` (see
[Exporting and importing the profile](/en/guide/portability)); the **Ajustes** screen configures the co-pilot
(see [Configuring the co-pilot](/en/guide/copilot-settings)); source problems come out with file and line, each
one linking to the editor. **Apagar el servidor** asks for confirmation.

## Fuentes — sources

![The Fuentes screen: the file tree with its filter and issue badges, and the editor with an experience file open, its fingerprint and the status bar](/gui/fuentes.png)

The `data/sources` tree on the left —with a filter, a «+» button to create a file and a red badge with each
file's validation issues— and an editor with highlighting (Markdown and YAML) on the right, showing the path, the
file's fingerprint, «cambios sin guardar» and a footer with the language, the line ending and the cursor
position. The editor reformats nothing. Below it, **Historial de esta fuente**: the previous versions left behind
by each review application or restore (`output/historial-fuentes/`), with «Ver diferencias» against the editor
and «Restaurar esta versión» (the current one goes into the history in turn). Nothing is written until you press
**Guardar**: the interface sends the file with the fingerprint it read and, if someone changed it in between
(another tab, your text editor), the server rejects it and a dialog lets you **reload** (discarding your changes)
or **overwrite** with your version. After saving, the sources are validated and you're told if the artifact
became stale. **Nuevo fichero** creates an empty one at the path you give (`experience/acme.md`).

## Generar — generating

![The Generar screen: the three-step form on the left and, on the right, the generated CV, the fit to the offer with its percentage and the decisions report](/gui/generar.png)

A three-step form —**Especialidad** (with a preview of the headline and how much of your profile it recognises),
**Oferta** (optional: pasted text, an uploaded PDF, a workspace file or a URL, in tabs) and **Salida** (format,
engine, theme, limits and more options)— and a fixed action bar with **Generar CV** and **Analizar oferta**. The
same options as `cv generate-cv` —including two tag pickers to choose by hand which skills and which projects go
in, each with its «Solo estas» / «Todas menos estas» switch, fed from your profile— and, when you add an offer,
the notice of whether it was already processed, when and with which CV (the history in
`output/historial-ofertas.json`).

The screen **remembers how you generate**: specialty, format, engine, theme, language, limits and compact come
back exactly as you left them the last time you generated (stored in your browser, never on the server). What
doesn't come back is what belongs to each search —the offer, the skills and projects you picked— or the co-pilot:
leaving something ticked that sends data would be deciding for you. If you delete a specialty or uninstall a
theme, what was stored is dropped by itself.

- **Analizar oferta** is `cv analyze-offer`: the percentage of requirements proven with its bar, which ones your
  profile proves (and with which achievements), which it doesn't, the gaps and the best evidence. The
  **«Refinar la lectura con el co-piloto»** checkbox beside it adds a second reading of the offer by a model,
  which can only add tags that are already yours and shows the phrase from the offer that justifies each one (see
  [Tailoring the CV to a job offer](/en/guide/offers)).
- **Generar CV** writes the file into `output/`. Markdown is shown as text with a download; the **PDF** opens in
  the browser's viewer (downloaded with your token and displayed from the tab's memory) with its download button.
- **Informe de decisiones** is `--explain`: the selection by specialty, the offer's coverage, the trimming and
  the theme, in the same words as the CLI.
- **Temas de Typst** (collapsible): creates a theme in your project's `themes/<name>/` from another one, like
  `cv theme create`; and **Instalar tema…**, like `cv theme install`: from an archive or directory in the
  workspace, or from an `https://` URL (the server must be started with `--allow-remote` and a dialog asks you to
  confirm the download, with the host and the limit). «Ver el plan» is `--dry-run`. The theme selector shows
  authorship and marks the installed ones.

## Salidas — outputs

![The Salidas screen: the table of files in output/ with type and size, and the preview of a CV in Markdown](/gui/salidas.png)

The files in `output/` —CVs in PDF and Markdown, co-pilot reviews— in a table with their type and size; each one
can be viewed (text or PDF viewer) and downloaded. If there's nothing, the screen points you to Generar.

## Co-piloto

![The Co-piloto screen: the chosen task and provider as cards, the limits, the «what leaves and where to» panel and a finished job with its progress and the link to the review](/gui/copiloto.png)

The three tasks of `cv improve`, `cv summarize` and `cv suggest tags` as **jobs**: you pick the task and its
limits (achievements per run, proposals per achievement, maximum length, an optional offer as text or file),
press **Lanzar** and follow the progress live —the same `[n/m]` lines as the terminal— with a button to cancel.
Before launching, the «qué sale y a dónde» panel says what is sent to the provider (the texts of the achievements
or of the profile, and the offer if there is one; never your whole files) and to which one. With a remote
provider (`cv serve --allow-remote`), the server first answers with an **estimate** of what would be sent and the
interface asks for your confirmation; only then is it launched. The result of improving and summarising is a
**review** in `output/`, linked from the job; the result of suggesting tags is the list of achievements
with their **new tags and a checkbox per tag**: none is ticked, and «Aplicar en mis fuentes» writes only the ones
you tick, at the end of the bullet and with a `.bak` copy beside it (then rebuild from «Estado»). No job writes
to your sources on its own: only that action of yours does.

## Revisiones — reviews

![The Revisiones screen: an item with its original on the left, the proposals with checkboxes on the right and the application plan with the whole file before and after](/gui/revisiones.png)

Each review shows, item by item, the **before** (the achievement as it stands in the source, with its impact and
its `file:line`) and the **after**: the model's proposals, with a checkbox on the ones that passed verification
(C2) and struck through on the rejected ones. You tick the one you want for each item and **Guardar marcas**
writes only `[ ]`→`[x]` into the review file (the rest stays intact: `cv improve apply` reads exactly the same).
**Plan de aplicación** shows which files and ids would change, touching nothing; **Escribir en las fuentes**
—after confirmation— applies the ticked ones leaving a `.bak` copy of each file, and if an original is no longer
exactly that in the source it writes nothing and explains why. Afterwards, rebuild the artifact from Estado.
**Eliminar** deletes only the review file.

## What the interface writes, and what it doesn't

It writes **only when you press a named button**: Guardar (a source), Compilar (the artifact), Generar CV (a file
in `output/`), Crear tema and Instalar tema (`themes/<name>/`), Lanzar (a review in `output/` when an improve or
summarize job finishes), Guardar marcas (the review file), Escribir en las fuentes (your sources, with a `.bak`
copy, after confirmation) and Eliminar (a review). It never writes on its own or on closing. Everything else is
reading. The server checks every source write against the file's fingerprint, exactly like the API.

## Security

- `127.0.0.1` only; a session token per start; the server rejects foreign `Host` headers and writes from other
  origins; no CORS.
- The interface loads nothing from outside (no fonts, no icons, no analytics) and its content policy forbids any
  script that doesn't come from the executable itself.
- None of your files' content becomes HTML: it is shown as text, and the PDF in the browser's viewer.
- In Docker: [`compose.serve.yml`](/en/guide/docker#the-api-from-the-container) publishes the port only on the
  host's loopback.

More detail in the [interface design note (es)](/design/gui-mvp) and in the
[API threat model (es)](/design/api-headless#_6-seguridad-modelo-de-amenazas-de-un-servidor-local).
