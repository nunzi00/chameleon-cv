---
title: Typst and themes
---
# A publication-quality PDF engine: Typst and themes

`--format pdf` uses `pdfkit` by default: zero dependencies and a correct result. For a **publication-quality**
CV, `--engine typst` lays out the same content with [Typst](https://typst.app) (0.15.1): careful typographic
hierarchy, professional kerning and hyphenation, a tagged (accessible) and deterministic PDF, with the same
embedded Source Sans 3. Both engines start from the **same structured view** of your profile: the layout changes,
never the content.

## Installing Typst

```bash
cv typst install                                            # 1. downloads the official release for your platform and verifies it (once)
cv typst status                                             # 2. which binary would be used, its version and where it comes from (exit 0 if usable)
cv generate-cv -s backend --format pdf --engine typst       # 3. output/cv-<name>-backend.pdf with the reference design
cv generate-cv -f offer.pdf --compact --format pdf --engine typst   # everything else (offers, trimming, #pin, --explain) works the same
```

`cv typst install` is `cv`'s **only network operation**, and it only happens when you ask for it: an https
download with a size limit, a streaming SHA-256 compared against the manifest pinned at release time (a tampered
file is deleted without installing), extraction with the system `tar` into a temporary directory, a `--version`
check and only then the binary lands in your user cache (`~/.cache/chameleon-cv/typst/0.15.1/typst`, mode 0700;
`~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows). A Typst 0.15.1 already installed on the `PATH`, in the
`CHAMELEON_TYPST` variable or via `--typst-path` works too (`--typst-any-version` accepts another version at your
own risk).

## A contained process

When generating, Typst runs as a **contained** child process: stdin/stdout with no intermediate files (your data
never travels through arguments or disk), `--root` limited to the theme's directory, an empty environment with
the network switch off (no `@preview` package is ever downloaded), only the project's and the theme's fonts, 20 s
and 32 MiB of limits. With no binary, exit code 2 and the instruction; a template that doesn't compile, exit code
1 with Typst's diagnostics. Design: [Integración de Typst (es)](/design/typst-integration).

## Themes

The look is decided by a **theme**: a `themes/<name>/` directory with `theme.toml` —the design variables:
colours, typefaces, sizes, spacing and page, **validated** before Typst is started— and `template.typ`, the
layout, which receives the structured view and those variables. `--theme <name>` picks the theme, looking first
in your project's `themes/` and then among the distributed ones.

Five themes ship with the product, all with the same content and the same contract: **`default`** (Source Sans 3,
a sober hierarchy with small caps and aligned dates), **`classic`** (Libertinus serif, a centred header under a
double rule, uppercase sections and justified body), **`modern`** (an accent band in the header, a side column
with contact, skills and languages, periods in pills), **`academic`** (a single-column serif for long careers:
numbered sections, dates in the margin and a «Name · page X of Y» footer) and **`minimal`** (monochrome, no rules
or columns, meant for applicant tracking systems). Look at them in the [theme gallery (es)](/guide/theme-gallery)
and start from any of them with `cv theme create mine --from <theme>`.

A theme can declare in `[theme]` who signs it: `author`, `license` (an SPDX identifier is suggested) and
`homepage` (an `https` URL); `cv theme list` shows them next to the description. It can also declare what it
contributes, with `kind`: `organization` changes the order and grouping of sections (`chronological`,
`functional`, `hybrid`, `skills-first`, `project-portfolio`, `one-page`, `education-first`,
`achievements-first`, `unified-timeline`) and `style` keeps reverse-chronological order and changes the layout
(eighteen styles: `default`, `classic`, `academic`, `awesome`, `executive`, `minimal`, `modern`, `tech`,
`timeline`, `elegant`, `bold`, `compact-grid`, `monochrome`, `warm`, `europass-like`, `swiss`, `newspaper`,
`pastel`). `cv theme list`, the [gallery (es)](/guide/theme-gallery) and the web interface's selector group by
it; a theme without `kind` shows up as «sin clasificar».

```bash
cv theme list                                                         # which themes exist, where they come from and which is the default
cv theme create mine --from classic                                   # 1. themes/mine/ in your project, from an existing theme
$EDITOR themes/mine/theme.toml                                        # 2. colours, fonts, sizes, margins or paper, without touching code
cv generate-cv -s backend --format pdf --engine typst --theme mine    # 3. generate with your theme
cv theme path classic                                                 # where a theme lives, to look at it or copy its files
```

An extract from `themes/default/theme.toml` (the full file is commented):

```toml
[colors]
primary = "#1b1b1b"      # name and entry titles
secondary = "#5c5c5c"    # metadata, dates and section labels
accent = "#1f4e79"       # links

[fonts]
body = "Source Sans 3"   # Source Sans 3 (templates/fonts), those embedded in Typst, or .ttf/.otf in themes/mine/fonts/

[sizes]                  # in points
name = 24
body = 10

[page]
paper = "a4"             # a4, a5, a3, us-letter, us-legal

[page.margins]           # in millimetres
top = 17
```

An unknown key, a colour that isn't `#rrggbb` or a size out of range are rejected with the error's path
(`colors.primary: …`) before Typst is started.

## Community themes: `cv theme install` and `cv theme verify`

A theme is shared as a `.zip` or `.tar.gz` archive with `theme.toml`, `template.typ` and, if needed, `fonts/`,
`README.md` and `LICENSE` (optionally inside a single root directory named after the theme). It is installed into
your project's `themes/<name>/` from an `https://` URL or from a local archive or directory:

```bash
cv theme install https://example.org/themes/community.zip --sha256 <hash>   # 1. asks for consent, downloads (8 MiB max), reads the archive in-process and checks the hash published by its author
cv theme install ~/Downloads/community.zip --as my-community --dry-run      # the plan only: accepted entries, sizes, hashes and name; nothing is written
cv theme install ../other-project/themes/mine                               # a local directory works too (no network, no question)
cv theme verify community                                                   # 2. intact, locally modified (which file) or with no origin; exit 1 on differences
cv theme list --verify                                                      # the origin of each installed theme and its state
cv generate-cv --format pdf --engine typst --theme community                # 3. it runs contained, like every theme
```

Before downloading, `cv` announces the URL, the host and the limit, and asks for confirmation (`--yes` gives it
in advance; with no terminal and no `--yes` it cancels without touching the network). `https://` only, redirects
included. The archive is read **without `tar` and without processes**, under a closed policy: a single optional
root directory, only a theme's files (`theme.toml`, `template.typ`, `README.md`, `LICENSE`,
`fonts/<name>.ttf|otf`, with names in lowercase, digits and hyphens), no `..`, absolute paths, links or devices,
and with limits (2 MiB per file, 8 MiB per font, 16 MiB in total, 40 entries); anything else is an error that
names the entry. `theme.toml` is validated before anything is written, and a theme is never overwritten:
`--replace` moves the previous one to `themes/<name>.<stamp>.bak/`.

The installation leaves `themes/<name>/.origin.json` with the origin, the archive's SHA-256 and each file's
(trust on first use: check the hash against the one the author publishes, with `--sha256`). `cv theme verify`
recomputes them; a theme created with `cv theme create` or copied by hand has no origin and isn't suspicious: it
simply doesn't have one. An installed theme runs with the same containment as the distributed ones (no network,
no packages, no leaving its directory, with time and memory limits); the residual risk is one of content —a theme
that lays out badly or misleads visually— and that's why `--dry-run`, the origin and the hash are kept in plain
sight.

**Publishing a theme**: pack the directory (`zip -r community.zip community/` or
`tar czf community.tar.gz community/`), publish the archive over https next to its hash
(`sha256sum community.zip`) and explain in `README.md` what it changes and which typefaces it uses (any that
don't come with Typst or Chameleon CV go in `fonts/`).

## `cv.toml`: the project's configuration hub

An optional file at the project root whose `[theme]` section picks the default theme (`name`; `--theme` wins) and
**overrides** values of the theme's `theme.toml` —with the same vocabulary and the same validation— for that run
only, without forking the theme. `--explain` says which theme is used and what it overrides.

```toml
[theme]
name = "classic"          # the project's default theme

[theme.colors]
primary = "#7a1f1f"       # overrides only this key of classic's theme.toml
```

## Your own templates

To change the **layout**, edit the theme's `template.typ`: it must export `cv(d, theme)`, which receives the
structured view (name, contact, summary, experience, projects, skills, achievements, education, certifications
and languages, with inline Markdown already decomposed) and the already-validated theme; `-t template.typ` still
works for a standalone template. The full contract, the container's rules and a minimal example:
[Plantillas Typst propias (es)](/design/plantillas-typst). Tutorial:
[Your own theme](/en/tutorials/own-theme).

::: warning A typographic detail that matters to ATSs
High `tracking` on uppercase makes text extractors (pdf.js and any ATS) read «E X P E R I E N C E». The
distributed themes fix it at 0.05 em and the suite checks with the real binary that the extracted text keeps the
words exactly.
:::
