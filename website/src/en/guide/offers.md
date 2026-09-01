---
title: Tailoring the CV to a job offer
---
# Tailoring the CV to a job offer

Save the offer in a text file **or a PDF** (the text is extracted in an isolated process, with limits of 10 MiB
and 50 pages), or pipe it through standard input, and:

```bash
cv analyze-offer offers/acme-backend.txt           # do I fit? what I prove, what I don't, what I'm missing
cv generate-cv -f offers/acme-backend.txt          # tailored CV: output/cv-<name>-acme-backend.md
cv generate-cv -f offers/acme-backend.txt -s backend --top-n 4 --max-skills 12
cv generate-cv -f - --compact < offer.txt          # offer on stdin, one-page preset
```

How it works, in one sentence: **`--specialty` picks the version of your CV, `--from-job-offer` tunes it and the
limits condense it.**

## Your profile is the dictionary

The offer is read looking for your own vocabulary: tags, skill names and aliases (`k8s`, `tech lead`). Whatever
the offer asks for and your profile doesn't even have tagged comes out as a *gap*. If you do have something and
it isn't recognised, tag it or add an alias in `skills.csv`. There's no magic: requirements are never invented,
and synonyms you haven't declared are never assumed.

## Transparent scoring

Each requirement is weighted by where it appears —`Requirements` 1.0 · elsewhere 0.75 · `Nice to have` 0.5, with
a boost for repetition— and each item adds up the weights of its tags. Achievements within each job and the
skills are reordered by score; experience, education, projects and certifications stay chronological. `--explain`
shows every number. Specification: [Extracción de palabras clave y puntuación (es)](/design/scoring).

## «Top N» trimming

- `--top-n` limits achievements per job/project and the cross-cutting ones; `--max-skills`, `--max-projects` and
  `--max-certifications` handle the rest.
- `--compact` is short for `--top-n 4 --max-skills 12 --max-projects 4 --max-certifications 5`: the one-page
  preset.
- Items with no tags score 0: they go last and are the first to be cut. With no offer everything scores 0 and
  `--top-n` keeps the first N exactly as you wrote them.
- `#pin` is never trimmed. Specification:
  [Recorte «N mejores» y CLI de adaptación (es)](/design/trimming-cli).

## Choosing by hand what goes in and what doesn't

Beyond the quantity limits, you can decide the skills and projects yourself, **both ways round**:

```bash
cv generate-cv --skills "PHP,Kubernetes"          # only these
cv generate-cv --exclude-skills "COBOL"           # all but these
cv generate-cv --projects proj-a,proj-b           # only these
cv generate-cv --exclude-projects old-proj        # all but these
```

They are named **by id or by name**, and anything you name that doesn't exist is reported instead of failing
silently. «Only these» is applied first and «all but these» second, so the two lists can be combined
(`--skills php,kubernetes --exclude-skills php` leaves Kubernetes). All of this happens **before** the quantity
limits (`--max-skills` and friends).

Removing a skill takes it out of your skills section; what a job declares in its «Technologies» is a fact about
that job and is not rewritten.

In the web interface, under «Afinar el contenido», each picker has its **«Solo estas» / «Todas menos estas»**
switch: the same list, read forwards or backwards.

## `cv analyze-offer`

Analyses without generating: overall fit, evidence (which profile items prove each requirement) and gaps.
`--explain` gives the per-item audit; `--json` the same in JSON for scripts; `-s` narrows the analysis to one
specialty; `<offer>` can be `-` (stdin). Reference: [`cv analyze-offer` (es)](/reference/analyze-offer).

## Refining how the offer is read, with the co-pilot

Matching is **literal**: if the offer asks for «event-driven architecture» and your skills say «Kafka», there is
no match unless an alias exists. `--copilot` adds a second reading of the offer by a model:

```sh
cv analyze-offer offers/acme-backend.txt --copilot            # local co-pilot (Ollama and friends)
cv analyze-offer offers/acme-backend.txt --copilot --provider groq --yes
```

What it does, and what it doesn't:

- **The model reads the offer; it does not decide your CV.** It returns the same requirements table as always
  and, from there, selection, scoring and the report are exactly today's. Without `--copilot` there is no
  network and no change whatsoever in the result.
- **It can only ADD tags that are already yours.** It receives the offer text —which is public— and the list of
  your tags; nothing else from your profile. It cannot invent a skill for you: if it proposes a tag that isn't
  on that list, the code rejects it.
- **Every proposal needs a phrase from the offer**, and the code checks that the phrase **is literally** in it.
  Whatever can't be verified is rejected and counted.
- **You always see what it contributed, with its evidence**: `arquitectura (desirable) ← «sistemas de
  mensajería»`. The code can verify that the phrase exists; whether it *supports* the tag is your call, and
  that's why you're shown it.
- **It never outweighs the literal.** A tag added by the co-pilot counts as a single piece of evidence, with no
  boost for repetition: a term the offer names three times always weighs more.
- `--explain` marks its origin: `sistemas de mensajería (desirable, 0.75, co-piloto)`. Without that you wouldn't
  know how much of your fit rests on a model.
- With a remote provider, a cost notice and confirmation before anything is sent (`--yes` in scripts).

In the web interface it's the **«Refinar la lectura con el co-piloto»** checkbox next to «Analizar oferta», with
its provider selector: the contribution appears inside the fit panel, with the same evidence and the same count
of rejections, and a remote provider opens the cost dialog first. In the API, `POST /analyze-offer` accepts
`copilot` (403 `remote-disabled` without `--allow-remote`, 409 `consent-required` with an `estimateId`).

### Making the bridge unnecessary

If the phrase the co-pilot had to bridge has already served you once, the cheap and permanent fix is for it to
become an **alias** of your skill. `--save-aliases` does it for you:

```sh
cv analyze-offer offers/acme-backend.txt --copilot --save-aliases
#   alias guardado en Apache Kafka: «sistemas de mensajería» (kafka)
#   1 alias en data/sources/skills.csv: la próxima oferta que lo diga así se reconocerá sin modelo.
cv build
```

From then on, **that offer and any that phrase it the same way are resolved with no network and no model**:
literal matching recognises them.

**You choose which ones.** In the terminal you're asked **one by one**; with `--yes`, or with no terminal, every
one the code approved goes in, which is what a script expects. On the web, each of the co-pilot's contributions
carries its own checkbox and **none comes ticked**: tick the ones you want and press «Guardar N como alias».

Two more guards: only what the code verified is saved, and only when the tag belongs to **exactly one** skill —if
it belongs to several, the alias isn't any one skill's and you're told so you can choose—. What was already
recognised isn't duplicated either. The phrase is stored **normalised** (lowercase, no diacritics), which is how
matching looks it up and the only shape `skills.csv` accepts; anything that doesn't fit as an alias is reported
and not written. The write is surgical: it is appended to that row's `aliases` column and **the rest of the file
stays byte for byte identical**.

## Generating from the fit

Analysing and generating are connected:

- **Suggested specialty.** `cv analyze-offer` prints the profile's real specialty whose tags weigh most among the
  recognised requirements («Especialidad sugerida: backend (…; cubre 5 de 8 requisitos con peso)»). In the CLI
  it's only printed; on the Generar screen, if step 1 was empty, it is filled in and you're told.
- **Preserved evidence.** When generating with an offer, the items that prove some requirement (achievements,
  skills, projects and certifications with matching terms) **are not trimmed by the quantity limits**
  (`--top-n`, `--compact`, `--max-*`): they count towards the limit and the others are cut instead. `--explain`
  lists them («evidencias conservadas por la oferta (no se recortan): …») and the API returns them in
  `report.kept`. `--no-keep-evidence` (CLI) or `keepEvidence: false` (API) restore pure trimming by score.
- **One gesture in the interface.** The fit panel has «Generar con esta adecuación»: it keeps the offer, uses the
  specialty (suggested or chosen) and generates; the success notice says how many pieces of evidence were kept.

## Offers in PDF

The PDF is processed in an isolated *worker* with limits (10 MiB, 50 pages, 20 s, 512 MB), loading no fonts and
rendering nothing; only the text is extracted. A scanned PDF with no text layer contributes nothing: paste the
text by hand.

Step-by-step tutorial: [One CV for three offers](/en/tutorials/three-offers).

## History of processed offers

Every `cv analyze-offer` and every `cv generate-cv --from-job-offer` leaves an entry in
`output/historial-ofertas.json` (date, action, specialty and the CV written) identified by the **fingerprint of
the offer's text**. When you use the same offer again —pasted, extracted from its PDF or from a file— the product
tells you before the result:

```text
Esta oferta ya se procesó 2 veces:
  2026-08-30T12:10:33.000Z · generate-cv (backend) → output/cv-ada-backend-nexo.pdf
  2026-08-29T09:00:00.000Z · analyze-offer (backend)
```

In the web interface the notice appears in Generar as soon as you add the offer; in the API,
`POST /api/v1/offers/history` queries the history with no side effects and the `/analyze-offer` and `/generate`
responses include it (`history`). The file is yours: you can delete or edit it; the 500 most recent entries are
kept.

## From a URL

An offer published on the web is fetched with **a single https request, with no cookies and none of your data**
(2 MiB and 15 s maximum, with a guard against internal addresses). Extraction prefers the page's `JSON-LD
JobPosting` (LinkedIn, Jobgether, Manfred…), falls back to the main content when the description is a summary,
and to the `og:*` metadata as a last resort; the **provenance** and any warnings are always shown.

```bash
cv analyze-offer "https://company.com/jobs/backend" --allow-remote        # asks for confirmation (or --yes in scripts)
cv generate-cv -f "https://company.com/jobs/backend" --allow-remote --yes --save-offer
cv analyze-offer --list                                                   # what's saved in offers/
```

`--save-offer [path]` saves the text in `offers/` with an origin header (`--replace` to overwrite). In the **web
interface**, the «URL» tab of Generar's Offer step does the same with a consent dialog (host and limit in plain
sight) and a «Guardar en offers/ como…»; the «Del espacio» tab offers a picker with what you already saved.
