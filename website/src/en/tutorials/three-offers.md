---
title: 2 · One CV for three offers
verify:
  - output/cv-ada-ejemplo-backend-acme-backend.md
  - output/cv-ada-ejemplo-nube-platform.md
  - output/cv-ada-ejemplo-engineering-manager-lider-equipo.md
  - informes/acme-backend.json
---
# Tutorial 2 · One CV for three offers

Three different offers, a single profile. You'll see how `cv analyze-offer` measures the fit, what your profile
proves and what it lacks, and how `--from-job-offer` tailors the CV to each one. We start from the sample profile
(`cv init`), which already has two specialties: `backend` and `engineering-manager`.

The commands and the sample offers are kept exactly as in the Spanish tutorial, so that continuous integration
runs both pages against the real binary.

## 1. Workspace and three offers

```bash tutorial
cv init
cv build
mkdir -p ofertas informes
cat > ofertas/acme-backend.txt <<'EOF'
Senior Backend Engineer (PHP)

Requisitos:
- PHP 8 y Symfony en producción.
- Kubernetes: despliegues sin parada.
- Kafka o mensajería equivalente.

Deseable:
- Contract testing entre servicios.
EOF
cat > ofertas/nube-platform.txt <<'EOF'
Platform Engineer

Requisitos:
- k8s y automatización de infraestructura.
- Observabilidad: métricas, trazas y logs.
- Go o TypeScript.

Deseable:
- Certificación CKA.
EOF
cat > ofertas/lider-equipo.txt <<'EOF'
Engineering Manager

Requisitos:
- Liderazgo de equipos de 5 a 10 personas.
- Gestión de la entrega con metodologías ágiles.
- Mentoría y desarrollo de carrera.
EOF
```

The sections matter: whatever goes under `Requisitos` weighs 1.0, the rest 0.75 and whatever goes under
`Deseable` 0.5, with a boost if a term repeats.

## 2. Do I fit? Analyse without generating anything

```bash tutorial
cv analyze-offer ofertas/acme-backend.txt
cv analyze-offer ofertas/nube-platform.txt
cv analyze-offer ofertas/lider-equipo.txt
```

Each report gives the overall fit, the **evidence** (which items of your profile prove each requirement) and the
**gaps**: what the offer asks for and your profile doesn't even have tagged. Your profile is the dictionary: «k8s»
counts because the sample's Kubernetes skill carries that alias in `skills.csv`; «Terraform» doesn't appear in
Ada's profile and comes out as a gap. If you do have something and it isn't recognised, tag it or add an alias.

```bash tutorial
cv analyze-offer ofertas/acme-backend.txt --explain
cv analyze-offer ofertas/acme-backend.txt --json > informes/acme-backend.json
```

`--explain` audits item by item what scored how much; `--json` gives the same for scripts.

## 3. A CV for each offer

```bash tutorial
cv generate-cv -f ofertas/acme-backend.txt -s backend --top-n 4 --max-skills 12
cv generate-cv -f ofertas/nube-platform.txt
cv generate-cv -f ofertas/lider-equipo.txt -s engineering-manager --compact
ls output
```

Three rules in one sentence: **`--specialty` picks the version of your CV, `--from-job-offer` tunes it and the
limits condense it.**

- The first starts from the `backend` version and reorders achievements and skills according to what ACME asks
  for.
- The second fixes no specialty: it uses the whole profile, ordered by the offer.
- The third uses the `engineering-manager` version with the one-page preset (`--compact` = `--top-n 4
  --max-skills 12 --max-projects 4 --max-certifications 5`).

The file name says it all: `cv-<name>[-<specialty>][-<offer>].md`.

## 4. See why

```bash tutorial
cv generate-cv -f ofertas/acme-backend.txt -s backend --top-n 2 --explain --stdout > /dev/null
```

With `--top-n 2`, inside each job the two highest-scoring achievements survive; the ones that don't score (no
tags matching the offer) go last and are the first to be cut. Anything anchored with `#pin` is never trimmed.

## 5. The same from a PDF or from the clipboard

```bash
cv analyze-offer ofertas/acme-backend.pdf -s backend      # the text is extracted in an isolated process, with limits
cv generate-cv -f - --compact < oferta.txt                # offer on standard input
```

## 6. Save and reuse (offers/)

```bash tutorial
mkdir -p offers && cp ofertas/acme-backend.txt offers/acme-backend.txt
cv analyze-offer --list
cv generate-cv -f offers/acme-backend.txt -s backend --stdout > /dev/null
```

Everything living in `offers/` also shows up in the web interface's Generar picker. And if the offer is published
at a URL, `cv analyze-offer "https://…" --allow-remote` fetches it with a single confirmed request (no cookies)
and `--save-offer` leaves it saved here — [the guide](/en/guide/offers) tells the whole story.

## Next

[Your own theme](./own-theme): the same content, with the layout you decide.
