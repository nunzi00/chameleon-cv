---
title: Generating the CV
---
# Generating the CV

`cv generate-cv` reads the artefact (`data/dist/profile.json`), applies the selection and writes the CV. The full
option reference is in [`cv generate-cv` (es)](/reference/generate-cv).

```bash
cv generate-cv --specialty backend            # output/cv-<name>-backend.md
cv generate-cv                                # the full CV, no selection
cv generate-cv -s backend --explain           # also explains on stderr what went in and why
cv generate-cv -s backend --stdout            # prints the Markdown instead of writing a file
cv generate-cv -s backend --format pdf        # output/cv-<name>-backend.pdf (pdfkit, embedded font)
cv generate-cv -s backend -o cv/backend.md    # a different output path
```

## The output file

By default, `output/cv-<name>[-<specialty>][-<offer>].md` (or `.pdf`), with 0600 permissions. `<name>` comes from
`fullName`, `<specialty>` from `-s` and `<offer>` from the offer file's name. `-o` sets another path; `--stdout`
prints the Markdown (Markdown only).

## Keeping the artefact current

If you edit the sources and forget to rebuild, `generate-cv` warns you: *«Aviso: experience/acme.md es más
reciente que el artefacto; ejecuta cv build»*. With `--build`, `generate-cv` (and `analyze-offer`) rebuild the
artefact before working. `-d` tells it where the sources are, just for that warning.

## Markdown and your own templates

The Markdown is rendered with Handlebars from an **already formatted view model**: dates in the right language,
periods, skills grouped by category, contact line. The base template is
[`templates/cv.md.hbs`](https://github.com/nunzi00/chameleon-cv/blob/main/templates/cv.md.hbs); copy it, adapt it
and pass it with `--template my-template.hbs`. The section labels (`labels.experience`, `labels.present`…) come
from the locale (the profile's `locale` or `--locale`): there are tables in Spanish and English.

## PDF

`--format pdf` uses **pdfkit** by default: zero external dependencies, the Source Sans 3 font embedded (OFL
licence) and a correct result, laid out in code from that same view model (it accepts neither `--template` nor
`--stdout`). For a **publication-quality** CV — typographic hierarchy, professional kerning and hyphenation,
tagged and deterministic PDF — use `--engine typst` with its themes:
[Typst and themes (es)](/guide/typst-themes).

Both engines start from the **same structured view** of the profile: the layout changes, never the content (the
test suite checks this by extracting the text from both PDFs).

## `--explain`

It accounts for every decision, by section and item, on stderr: what went in and why (`universal`, `match`,
`via-achievements`, `pinned`), what stayed out (`no-match`), what scored how much against an offer and what was
trimmed. This is the tool for understanding a CV that is not the one you expected: almost always the answer is a
tag that is missing, or one too many.

## Exit codes

`0` fine · `1` invalid data (sources, artefact or unknown specialty) · `2` wrong usage or environment failure
(permissions, disk, unreadable template, Typst missing).

## Offer evidence is kept

With `--from-job-offer`, whatever proves a requirement of the offer is not trimmed by `--top-n`, `--compact` or
`--max-*` (it counts towards the limit; the rest get cut). `--explain` lists it and `--no-keep-evidence` turns it
off. More in [Offers → Generar con la adecuación (es)](/guide/offers#generar-con-la-adecuacion).

## Picking skills and projects by hand

Besides the quantity limits (`--max-skills`, `--max-projects`), you can say exactly which skills and which
projects go into the CV: `--skills` and `--projects` accept comma-separated names or ids (case- and
accent-insensitive) and are applied **before** the quantity limit; names that do not exist in your profile are
reported and ignored. In the web interface, Generate offers two multi-selects fed from your profile.

```bash
cv generate-cv -s backend --skills "PHP,Kubernetes,Kafka" --projects proj-kafka-guardian --explain
```
