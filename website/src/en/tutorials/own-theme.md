---
title: 3 · Your own theme
verify:
  - themes/mio/theme.toml
  - themes/mio/template.typ
  - cv.toml
---
# Tutorial 3 · Your own theme

A theme is a `themes/<name>/` directory with two files: `theme.toml` (colours, typefaces, sizes, spacing and
page, validated before Typst is started) and `template.typ` (the layout). You're going to create yours from
`classic`, change a colour, set it as the project's default theme and generate the PDF with Typst.

The commands are kept exactly as in the Spanish tutorial —theme name included— so that continuous integration
runs both pages against the real binary.

## 1. Typst, once

```bash
cv typst install    # downloads the official 0.15.1 release, verifies its SHA-256 and installs it in your user cache
```

It is `cv`'s only network operation. Afterwards:

```bash tutorial needs-typst
cv typst status
```

## 2. The project and the available themes

```bash tutorial
cv init
cv build
cv theme list
```

Two distributed themes: `default` (Source Sans 3, a sober hierarchy) and `classic` (serif, centred header, an
academic air).

## 3. Create yours from `classic`

```bash tutorial
cv theme create mio --from classic
ls themes/mio
cv theme list
```

`themes/mio/theme.toml` already carries the new name; `template.typ` is a copy of `classic`'s layout. Now `mio`
appears as a project theme.

## 4. Change a design variable

Open `themes/mio/theme.toml` in your editor and change the primary colour, or do it from the terminal:

```bash tutorial
sed -i -E 's/^primary = "#[0-9a-fA-F]{6}"/primary = "#7a1f1f"/' themes/mio/theme.toml
grep -n 'primary' themes/mio/theme.toml
```

An unknown key, a colour that isn't `#rrggbb` or a size out of range are rejected with the error's path
(`colors.primary: …`) before Typst is started: `cv theme list` would tell you.

## 5. Set it as the default and override a value without touching the theme

`cv.toml`, at the project root, picks the default theme and can **override** values of the `theme.toml` for that
run only, with the same vocabulary and the same validation:

```bash tutorial
cat > cv.toml <<'EOF'
[theme]
name = "mio"

[theme.sizes]
name = 22
EOF
cv theme list
```

## 6. Generate with Typst

```bash tutorial needs-typst
cv generate-cv -s backend --format pdf --engine typst
cv generate-cv -s backend --format pdf --engine typst --theme classic -o output/classic.pdf
cv generate-cv -s backend --format pdf --engine typst --explain -o output/mio-explain.pdf
ls output
```

The first uses `mio` (through `cv.toml`); the second forces `classic` with `--theme`, which wins; `--explain`
says which theme is used and which keys `cv.toml` overrides. Both PDFs lay out exactly the same content.

## 7. Changing the layout

To go beyond the variables, edit `themes/mio/template.typ`: it must export `cv(d, theme)`, which receives the
structured view of the profile and the already-validated theme. Typst runs contained (no network, `--root`
limited to the theme, time and memory limits), so a template can only read what is in its directory. Full
contract and a minimal example: [Plantillas Typst propias (es)](/design/plantillas-typst).

## 8. Install a community theme

A theme shared by someone else arrives as a `.zip` or a `.tar.gz` (or as a directory). It is installed into
`themes/<name>/` without touching anything else, runs with the same containment as the distributed ones and keeps
its origin and hashes in plain sight:

```bash
cv theme install https://example.org/themes/community.zip --sha256 <published hash>   # asks for confirmation before downloading
cv theme install ~/Downloads/community.zip --dry-run                                  # the plan only
cv theme verify community                                                             # intact, locally modified or with no origin
cv generate-cv -s backend --format pdf --engine typst --theme community
```

The guide [Typst and themes](/en/guide/typst-themes#community-themes-cv-theme-install-and-cv-theme-verify)
explains the entry policy, the limits and how to publish your own.

## Next

[The co-pilot with Ollama](./copilot-ollama): code-verified improvements on your own achievements.
