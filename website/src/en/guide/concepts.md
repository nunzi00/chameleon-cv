---
title: Concepts
---
# Concepts

Chameleon CV separates **what you know about yourself** from **how you present it**. Five ideas are enough to
understand everything else.

## Sources, artefact and CV

```
data/sources/ (you edit)  ──cv build──►  data/dist/profile.json  ──cv generate-cv──►  output/cv-<name>-<specialty>.md | .pdf
```

- **Sources** (`data/sources/`): Markdown and CSV files that you write and version yourself. They are the single
  source of truth: one job per file, achievements as bullets, skills in a table.
- **Artefact** (`data/dist/profile.json`): the profile compiled and validated by `cv build`. It is the quality
  gate: if the sources have an error, there is no artefact. It is re-validated every time it is read and never
  committed (it holds personal data in the clear).
- **CV** (`output/`): what `cv generate-cv` produces from the artefact — Markdown (through a template) or PDF
  (pdfkit or Typst). Not committed either.

There is a second, optional layer on top of the first: the [AI co-pilot (es)](/guide/copilot), which only
**proposes** changes to your sources and never applies them without your mark.

## Specialties

A specialty is a «version» of your CV: `specialties/backend.md`, `specialties/engineering-manager.md`… Each one
defines the **headline**, an optional **summary** and its tag **vocabulary**:

```markdown
---
title: Senior Backend Engineer
tags: [php, symfony, kubernetes, kafka]
---

A summary written for this kind of role.
```

`cv generate-cv -s backend` produces the CV for that version. Without `-s`, you get the full CV.

## Tags and the selection rule

Tags (`#php`, `#kubernetes`…) go at the end of each achievement, or in the `tags` field of the front matter of a
job, project or skill. The selection rule fits in one sentence:

> **No tags, always in; with tags, only if one of them matches** the specialty's vocabulary (or its id: `#backend`
> pins an item to that specialty).

What that means in practice:

- An untagged dataset produces the full CV for any specialty. Every tag you add is a constraint: tagging is
  progressive and never «breaks» a CV.
- **Tag the achievements, not the jobs.** A job with no tags shows up in every CV (your career is continuous);
  tagged achievements adapt the bullets to each specialty. Tag a job only when the *whole* role is irrelevant to
  some specialty.
- A job or project whose tags do not match still gets in if one of its achievements matches explicitly (with only
  the relevant achievements).
- `--explain` shows every decision: `+ experience exp-acme: universal`, `    - exp-acme-3: no-match`,
  `+ projects proj-platform: via-achievements`.

## `#pin`: anchoring what must not be dropped

The reserved `#pin` tag fixes an item above any algorithm: it appears in **every** specialty or job offer, goes
**first** in its section and is **never trimmed**. It works for achievements, jobs, projects, skills and
certifications. Anchoring does not change the measured fit: `pin` does not score and is not part of an offer's
vocabulary, and `--explain` reports it as reason `pinned`. An anchored item still takes a slot from the limit; if
there are more anchored items than slots, all of them survive.

## Job offers

An offer (text, standard input or PDF) tailors a CV: **`--specialty` picks the version, `--from-job-offer` tunes
it and the limits condense it.** The offer is read by looking for *your own* vocabulary — tags, names and aliases
of your skills — and each requirement weighs according to where it appears. The details are in
[Tailoring to a job offer (es)](/guide/offers).

## Language

The CV's section labels (`Experiencia`, `Actualidad`…) come from the locale: `locale` in `profile.md`, or
`--locale` when generating. There are tables in Spanish and English. The content is always what you wrote.

## Identifiers

Each entity's `id` comes from its file name (`experience/acme.md` → `exp-acme`; `projects/chameleon.md` →
`proj-chameleon`), and each achievement's from its position (`exp-acme-1`) unless you declare `id:` on the
bullet. You will see them in `--explain` and use them in the co-pilot's `--only`.
