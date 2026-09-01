---
title: Exporting and importing the profile
---
# Exporting and importing the profile

Since version 1.4.0 the canonical profile —the same JSON `cv build` writes to `data/dist/profile.json`— comes in
and out of the product with two commands: `cv export` and `cv import`. They're for keeping a structured copy,
editing it or querying it with other tools (`jq`, a JSON editor, a script), and for starting a project from an
existing profile. The Markdown and CSV sources remain the single source of truth: importing **regenerates** the
sources, it doesn't replace them with the JSON.

## Exporting

```bash
cv export > profile.json                 # to standard output
cv export -o backups/profile-2026.json   # to a file (mode 0600)
cv export | jq '.skills[].name'          # query it
```

- It comes from the sources, not from the artifact: no `cv build` needed and never out of date. If the sources
  have problems it shows all of them at once —like `cv validate`— and exports nothing.
- The JSON is exactly the one in `data/dist/profile.json` (same keys, same order, two spaces, trailing newline),
  with `meta.schemaVersion` so you know which schema version it speaks.
- It contains what you put in `profile.md`, email and phone included: it only goes where you send it, and never
  over the network.

## Importing

```bash
cv import profile.json --dry-run         # the plan and the self-check, writing nothing
cv import profile.json                   # regenerates data/sources/ (only if empty or missing)
cv import profile.json -d data/new       # into another sources directory
cv import profile.json --replace         # replaces the current sources; the old ones go to data/sources.<date-time>.bak/
cv export | cv import - -d data/copy     # from one project to another
cv build                                 # after importing, rebuild the artifact
```

`cv import` is the inverse of `cv build`: from the profile it writes `profile.md`, `specialties/`, `experience/`,
`projects/`, `education/`, `achievements.md`, `skills.csv` and `certifications.csv` with the layout and
conventions of `cv init` (see [Fuentes regeneradas (es)](/design/formato-dataset#15-fuentes-regeneradas-por-cv-import)).
Before touching the disk it does three things:

1. **Validates** the profile against the strict schema: every problem at once, with its path
   (`experience[2].dates.start: …`), and rejects schema versions it doesn't understand.
2. **Checks it can be represented**: an achievement with line breaks, or whose last word starts with `#` (it
   would be read as a tag), doesn't fit in the sources as is; it says so and writes nothing.
3. **Checks itself**: it re-reads the sources it is about to write with the same parser `cv build` uses and
   compares the resulting profile with the imported one. At the first difference it writes nothing and lists the
   paths that differ. That's the guarantee that `cv build` will rebuild exactly what you imported.

Only then does it write, and only into a sources directory that is **empty or missing**. If the directory has
content, `--replace` is required: the whole directory is renamed first as a copy
(`data/sources.20260830-120102.bak/`, never overwritten) and then the new sources are written, with mode `0600`.
If a write failed halfway, the summary says what was written and where the copy is.

### What is preserved and what isn't

- **The whole profile is preserved**: entity and achievement ids, tags, impacts, dates, summaries with their
  paragraphs, aliases and levels. So is the order of achievements, skills and certifications.
- **The order of entities** (experience, projects, education, specialties) becomes the order of their files —the
  id without its default prefix, so `exp-acme` → `acme.md`—, which is the order `cv build` reads them in. If the
  profile carried them in a different order, `import` says so.
- **The formatting of the previous sources is not preserved**: comments, front-matter line breaks, key order.
  Importing regenerates canonical sources; it is not an edit. To change a sentence, edit the source (or use the
  web interface); to merge two profiles, import into a new directory and copy across by hand.

### From the web interface and the API

On `cv serve`'s **Estado** screen, **Exportar perfil (JSON)** downloads the profile and **Importar perfil…**
picks a file, shows the plan (files, sizes, warnings, self-check) and only writes after you confirm, with a
«sustituir las fuentes actuales» checkbox when the directory isn't empty. In the API, `GET /api/v1/export` and
`POST /api/v1/import` (`dryRun` by default: the plan first) do the same; see the
[API reference (es)](/reference/api).

## Exit codes

| Situation | Code |
|---|---|
| Invalid, unrepresentable or different-after-regenerating profile; non-empty destination without `--replace` | 1 |
| Missing or unreadable file; couldn't write or move the directory aside | 2 |
