---
title: Source format
---
# Source format

A dataset is a directory shaped like this (full specification in the design notes
[Formato del dataset (es)](/design/formato-dataset) and [Formato CSV (es)](/design/formato-csv); `cv init` creates
a sample one):

```
data/sources/
├── profile.md            # personal data, languages and the default summary (required)
├── specialties/*.md      # one «version» of your CV per file: backend.md, engineering-manager.md…
├── experience/*.md       # one job per file
├── projects/*.md         # one project per file
├── education/*.md        # one qualification per file
├── achievements.md       # cross-cutting achievements (awards, talks…)
├── skills.csv            # skills
└── certifications.csv    # certifications
```

Rules worth knowing: the keys are the schema's (in English); an unknown key, section or file is an **error**
(nothing is ignored silently); dates are `YYYY`, `YYYY-MM` or `YYYY-MM-DD`; the YAML is strict (no implicit typing
or aliases); only `.md`/`.csv` files inside the dataset are read, and symbolic links pointing outside are an
error.

## `profile.md`

Front matter with your personal data, body with the default summary (Markdown):

```markdown
---
schemaVersion: 1
locale: es-ES
updatedAt: 2026-08-28
fullName: Ada Ejemplo
headline: Ingeniera de software
email: ada@example.com
phone: +34 600 000 000
location:
  city: Madrid
  region: Comunidad de Madrid
  country: España
links:
  - label: GitHub
    url: https://github.com/ada-ejemplo
languages:
  - { name: Español, level: native }
  - { name: Inglés, level: C1 }
---

Software engineer with **10 years** building payment platforms.
```

`fullName` is the only required field; the output file's name comes from it (`cv-ada-ejemplo-…`). URLs accept
`http(s)` only.

## Specialties: `specialties/<id>.md`

```markdown
---
title: Senior Backend Engineer
tags: [php, symfony, kubernetes, kafka]
---

A summary written for this kind of role (optional; without it, the one in profile.md is used).
```

The `id` is the file name (`backend`); a specialty may not be called `pin`, nor use that tag.

## Jobs, projects and education

Each entity is a Markdown file with **YAML front matter for the data and the body for the prose**:

```markdown
---
company: ACME Corp
role: Senior Backend Engineer
location: Madrid (remoto)
start: 2021-03
end: 2024-06                 # empty or absent = ongoing
tags: [php, symfony]
technologies: [PHP 8.3, Symfony 6.4]
---

A summary of the job, in Markdown.

## Logros

- Reduje la latencia p95 un **40 %**. #performance #php
  - impact: -40 % p95
  - date: 2023-05
- Lideré la migración a Kubernetes sin ventana de parada. #kubernetes #pin
  - id: exp-acme-k8s
```

- **Projects** (`projects/<id>.md`): `name`, `role`, `url`, `start`, `end`, `technologies`, `tags`; the
  achievements section may be called `## Logros` or `## Achievements`.
- **Education** (`education/<id>.md`): `institution`, `degree`, `field`, `start`, `end`.
- **Cross-cutting achievements** (`achievements.md`): a bullet list with the same syntax, no front matter.

### Achievement bullet syntax

- The text accepts inline Markdown (bold, italics, code, links).
- **Tags** go at the end: `#performance #php`. `#pin` anchors the achievement.
- Optional sub-lines carry metadata: `impact:` (shown in brackets in the CV), `date:` and `id:` (an explicit
  identifier; by default `exp-acme-1`, `exp-acme-2`…).

## `skills.csv`

```csv
name,category,level,years,aliases,tags
PHP,language,expert,10,,php|backend
Kubernetes,platform,advanced,5,k8s,kubernetes|devops|platform
Liderazgo técnico,soft,advanced,,tech lead|team lead,liderazgo
```

`|` separates several values in `aliases` and `tags`. **Aliases** matter when reading job offers: if an offer says
«k8s» and your skill carries that alias, it counts as evidence. Categories group the skills section of the CV.

## `certifications.csv`

```csv
name,issuer,date,url,tags
CKA,CNCF,2022-05-10,https://example.com/cert/cka,kubernetes|devops
```

## Errors

`cv validate` and `cv build` show **all** the problems at once, with file, line and key:

```
experience/acme.md:4: start: Fecha inválida: «2021-13»
skills.csv:3: level: valor desconocido «guru» (expert, advanced, intermediate, beginner)
```

Exit code 1 while there is any error; 0 once the dataset is clean.
