---
title: 1 · Your profile from scratch
verify:
  - data/dist/profile.json
  - output/cv-marta-rio-backend.md
  - output/cv-marta-rio-backend.pdf
  - output/cv-marta-rio.md
---
# Tutorial 1 · Your profile from scratch

You are going to create a workspace, replace the sample profile with your own, add a job with tagged achievements
and a skill, and generate the CV in Markdown and PDF. By the end you'll be able to read `--explain` and
understand why the CV is what it is.

The commands and the sample data below are kept exactly as in the Spanish tutorial, so that continuous
integration runs both pages against the real binary.

## 1. The workspace

```bash
mkdir mi-cv && cd mi-cv
```

```bash tutorial
cv init
find data/sources -type f | sort
```

`cv init` creates `data/sources/` with the synthetic person «Ada Ejemplo» and a `.gitignore`. Look at any of the
files: each one is Markdown with YAML front matter for the data and a body for the prose.

## 2. Your personal details

Replace `profile.md` with yours. Only `fullName` is required; the rest describes the CV's header:

```bash tutorial
cat > data/sources/profile.md <<'EOF'
---
schemaVersion: 1
locale: es-ES
updatedAt: 2026-08-29
fullName: Marta Río
headline: Ingeniera de plataforma
email: marta@example.com
phone: +34 600 111 222
location:
  city: Valencia
  region: Comunidad Valenciana
  country: España
links:
  - label: GitHub
    url: https://github.com/marta-rio
languages:
  - { name: Español, level: native }
  - { name: Inglés, level: C1 }
---

Ingeniera de plataforma con **8 años** operando servicios en la nube para equipos de producto.
EOF
```

## 3. A job with tagged achievements

Each job is a file; achievements are bullets with their tags at the end and, if you want, `impact:` and `date:`:

```bash tutorial
cat > data/sources/experience/nube.md <<'EOF'
---
company: Nube SA
role: Platform Engineer
location: Valencia (híbrido)
start: 2019-01
end: 2023-12
tags: [kubernetes, devops]
technologies: [Kubernetes, Terraform, Go]
---

Plataforma interna para 40 equipos de producto.

## Logros

- Automaticé el aprovisionamiento con Terraform: de **3 días a 20 minutos** por entorno. #devops #kubernetes
  - impact: -99 % tiempo de aprovisionamiento
  - date: 2021-06
- Diseñé la observabilidad común (métricas, trazas y logs) de 120 servicios. #platform #devops
EOF
```

Look at the tags: `#kubernetes` is in the vocabulary of the sample's `backend` specialty (`specialties/backend.md`:
`php, symfony, kubernetes, kafka`); `#platform` and `#devops` are not. That will decide which achievement makes it
into the backend CV.

## 4. One more skill

`skills.csv` is a flat table; `|` separates multiple values:

```bash tutorial
printf 'Terraform,platform,advanced,4,,devops|platform\n' >> data/sources/skills.csv
tail -3 data/sources/skills.csv
```

## 5. Validate and build

```bash tutorial
cv validate
cv build
```

Silence is a good sign. If you get something wrong —try putting `start: 2019-13` in `nube.md`— you'll see **all**
the errors at once, with file, line and key, and there will be no artifact until you fix them:

```
experience/nube.md:5: start: Fecha inválida: «2019-13»
```

## 6. Generate

```bash tutorial
cv generate-cv -s backend
cv generate-cv -s backend --format pdf
cv generate-cv
ls output
```

Three files: the `backend` specialty's CV in Markdown and PDF, and the full CV. Open
`output/cv-marta-rio-backend.md`: the Nube SA job appears with **a single achievement**, the Terraform one.

## 7. Understand the selection

```bash tutorial
cv generate-cv -s backend --explain --stdout > /dev/null
```

On stderr you'll see something like:

```
+ experience exp-nube: match (kubernetes)
    + exp-nube-1: match (kubernetes)
    - exp-nube-2: no-match
```

The rule: **with no tags, always; with tags, only if one matches**. The second achievement (`#platform #devops`)
shares no tag with `backend`, so it doesn't go into that CV —but it does go into the full one—. If you want it to
appear in backend, add `#kubernetes` to the bullet or `platform` to the specialty's vocabulary. And if an item
must always show up, in every specialty and every offer: `#pin`.

## Next

[One CV for three offers](./three-offers): the same mechanics, guided by what each offer asks for.
