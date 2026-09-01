---
title: Importing a CV you already have
---

# Importing a CV you already have

If you arrive with a CV in PDF or DOCX, `cv import-cv` turns it into a **draft dataset** so you don't start from
scratch. The draft is written to `import/<name>/` and **never** to `data/sources/`: you review it, adjust it and
move it yourself when you're happy with it.

```bash
cv import-cv old-cv.pdf                  # draft in import/<name>/ with its report
cv build --data import/old-cv            # validates the draft as is, before moving it
```

In the web interface (`cv serve`) the same import lives under **Perfil → Importar CV**.

## What it does, and what it doesn't

- **Deterministic**: it rebuilds the reading order from the layout (columns, tables with dates in the margin,
  split bullets), recognises sections by their Spanish and English headings, and validates every entry against
  the profile schema **entity by entity**: whatever doesn't fit is downgraded with a reason, not dropped in
  silence.
- **It invents nothing**: what doesn't fit goes into the draft's `README.md`, under «Degradado o avisado» (with
  the source line) and «Sin situar (revísalo a mano)».
- **No network and no model** unless you ask for the co-pilot with `--copilot`.

## A whole folder

If you have several versions of your CV —and almost everyone does—, `--all` imports them all and compares them:

```bash
cv import-cv ~/my-cvs --all
```

```text
Fichero                   Borrador                Exp.  Form.  Hab.  Avisos  Sin situar
CV Lucas.pdf              import/cv-lucas           11      7     0      15           4
CV-Lucas-2020.pdf         import/cv-lucas-2020      12      6     0      14          41
Profile.pdf               import/profile             6      3     3       0           0
```

Each CV goes to **its own draft, named after the file** and not after the profile: if they're all yours the
profile name would be the same for every one and only the first would land; this way you also see at a glance
where each draft came from. A file that fails is reported and **doesn't stop the others**. The table is the map
for deciding which one is worth reviewing: the row with fewest warnings and fewest unplaced lines is usually the
best starting point.

`--all` doesn't combine with `--copilot` —the co-pilot is asked draft by draft, with its cost— or with `--name`,
which would make no sense with several.

In the web interface, under **Perfil → Importar CV**, the **«Origen»** selector has a third option: a folder with
several CVs. You type the folder (relative to the workspace) and you get the same table; if a draft already
existed, what failed shows up with its reason and a button to **reimport replacing them**, which is a second
action of yours and never something automatic.

## The draft report

The draft's `README.md` is the map for your review. It opens with quality warnings that tell you whether it's
worth going on:

| Warning | What it means |
| --- | --- |
| «el texto extraído es muy corto» | the PDF is an image with no text layer: there is nothing to import |
| «parece un escaneo con OCR de baja calidad» | the text arrives with debris (`201&` for `2018`): check dates and institutions |
| «parece una plantilla sin rellenar» | the file is a template or a guide, not a CV |
| «no se reconoció ninguna entrada con fechas» | it may not be a CV, or its layout isn't recognised |
| «formación con una sola fecha» | the graduation date was taken as the start: adjust it if needed |

## Asking the co-pilot for help

With `--copilot`, the lines left **unplaced** are sent to the model —pseudonymised, without your name or contact
details— so that it can **propose** which section they belong to:

```bash
cv import-cv old-cv.pdf --copilot
```

The proposals appear in the `README.md` under «Propuestas del co-piloto (no aplicadas)» with their rationale. The
model **only classifies within a closed vocabulary** (experience, education, project, certification, skill,
language, achievement, summary, contact, discard) and the code verifies every proposal before showing it: it
rejects invented sections, lines that were never sent, and duplicates. **Nothing is written to the draft**: you
move whatever convinces you.

If you pick a remote provider (`--provider`), you'll see the cost notice first and you'll have to confirm it
(`--yes` in scripts).

### From the web interface

In **Perfil → Importar CV**, when the draft leaves unplaced lines a **«Refinar con el co-piloto»** button appears
with a provider selector. Refining is a co-pilot job like any other: you can follow its progress, a remote
provider asks you to confirm the cost first, and the verified proposals are added to the draft's `README.md`
—which the page reloads— without being applied. It works with any draft in `import/`, not only the one you just
uploaded.

### Moving a proposal into the draft

Every proposal comes with a **«Mover al borrador»** button. The co-pilot still writes nothing: the button moves
it, and only the line you point at. Before anything is touched a confirmation opens with the line in plain sight
and, when the section demands it, the fields the schema requires and the line cannot supply:

| Proposed section | What you're asked for |
| --- | --- |
| skill, achievement, summary, project, certification, discard | nothing: the line is enough |
| language | the CEFR level, pre-filled if the line declares it («Inglés — C1») |
| contact | which field it goes to: email, phone, location or link |
| experience | company, role and start date (an empty end means «current») |
| education | institution and degree; dates are optional |

On confirmation the line is written to the file it belongs to (`skills.csv`, `experience/<entry>.md`…), leaves
«Sin situar» and is recorded in the `README.md` under **«Aplicado»** with its destination. That record is what
lets you undo it by hand. If something wouldn't satisfy the schema, nothing is written and the dialog tells you
what's missing: the draft that comes out of applying a proposal still validates with `cv build --data`.

## From LinkedIn

If your CV lives on LinkedIn, the way in is its **official data export**, not the profile URL: that URL returns
the login wall, and LinkedIn's `robots.txt` forbids automated access. The export also gives a better result,
because it hands over **structured** data in CSV and there is no layout left to guess.

### How to request the export

1. Sign in to LinkedIn from a browser (this can't be done from the mobile app).
2. Click your photo, top right → **Settings & Privacy**.
3. In the left-hand column, **Data privacy**.
4. Open **Get a copy of your data**.
5. Choose the **second** option, «Want something in particular?», and tick at least: **Positions**,
   **Education**, **Skills**, **Languages**, **Certifications**, **Projects**, **Profile**, **Email Addresses**
   and **Phone Numbers**. The first option (the larger archive) works too, but it takes longer and brings dozens
   of files of messages and connections that are not a CV.
6. **Request archive** and confirm with your password.
7. LinkedIn emails you: the specific selection is usually ready in **about ten minutes**; the full archive can
   take **up to 24 hours**. Download the zip from that email or from the same screen.

::: tip Check what you got before importing
`unzip -l ~/Downloads/Basic_LinkedInDataExport.zip` lists the CSVs. If you don't see `Positions.csv`, go back to
step 5: the selection fell short.
:::

Then just hand it to `cv`:

```bash
cv import-linkedin ~/Downloads/Basic_LinkedInDataExport.zip
```

File names inside the zip vary with the interface language and the version, so `cv` looks them up by base name
and **doesn't mind them being inside a folder**.

### From the web interface

In **Perfil → Importar CV**, the **«Origen»** selector switches between a laid-out CV and the LinkedIn export.
Pick the second one and the field starts accepting the `.zip`, with a reminder of where to request it. The draft
lands in the same place with the same report; the difference shows when you read it: **there are no «unplaced»
lines**.

It reads `Profile.csv` (name, headline, summary, location, links), `Positions.csv` (experience; with no end date
the role is left «current»), `Education.csv`, `Certifications.csv`, `Projects.csv`, `Skills.csv`,
`Languages.csv` —with LinkedIn's five levels mapped to CEFR— and your email and phone. Whatever isn't in the zip
simply doesn't show up.

The draft lands in `import/<name>/` just like a PDF's, with the same report and the same validation, so from here
on the path is the one below.

### The PDF LinkedIn exports

If instead of the data export you use the profile's own **«Save as PDF»**, `cv` recognises it by its URL and its
page footer, and applies that format's rules: the company goes above and the role below, education comes with no
dates —and none is invented for it—, and the name is checked against your URL's *slug*. You get a clean draft,
but **the data export is still better**: structured data instead of a layout that has to be guessed.

## After importing

1. Read the `README.md` and fix what it points at.
2. Validate: `cv build --data import/<name>`.
3. Move the sources to `data/sources/` when they're to your liking and carry on with
   [Generating the CV](/en/guide/generate).
