---
title: Quickstart
verify:
  - data/dist/profile.json
  - output/cv-*-backend.md
  - output/cv-*-backend.pdf
---
# Quickstart

In under five minutes: install `cv`, create a workspace with a sample profile, and generate your first CV in
Markdown and as a PDF. Everything is processed on your machine; no command on this page opens a network
connection.

## 1. Install the executable

From [the Releases page](https://github.com/nunzi00/chameleon-cv/releases) download the archive for your
architecture — `chameleon-cv-<version>-linux-x64.tar.gz` or `-linux-arm64.tar.gz` — together with its `.sha256`
(Linux with glibc ≥ 2.28, `libstdc++` and `libatomic`, present in any desktop distribution; Node is not needed).
Verify it and extract:

```bash
sha256sum -c chameleon-cv-1.0.0-linux-x64.tar.gz.sha256      # «OK» means the archive is exactly the published one
tar -xzf chameleon-cv-1.0.0-linux-x64.tar.gz
sudo install -m 755 chameleon-cv-1.0.0-linux-x64/cv /usr/local/bin/cv   # or any directory on your PATH
cv --version
```

Prefer the repository? Run `npm ci && npm run build` and use `node dist/index.js` (or `npm link` to get `cv` on
your `PATH`); the details are in [Contributing (es)](/developers/contributing).

::: tip On macOS or Windows?
The standalone executable is published **for Linux only**: signing and notarising it for the other two platforms
requires paid certificates and developer accounts, and the decision was not to (1 Sep 2026). There, the way in is
the **Docker image**, which is multi-architecture and carries signed provenance —see
[Chameleon CV in Docker](/en/guide/docker)—, or building from the repository, which needs nothing special.
:::

## 2. Create the workspace

In an empty directory:

```bash tutorial
cv init
```

`cv init` writes a sample dataset into `data/sources/` — the synthetic person «Ada Ejemplo», with two
specialties, two jobs, one project, skills and certifications — plus a `.gitignore` that excludes what must
never be committed (`data/dist/`, `output/`). It never overwrites anything: if something is already there, it
lists the conflicts and writes nothing.

## 3. Build the profile

```bash tutorial
cv build
```

`cv build` validates the sources and writes the canonical artefact `data/dist/profile.json` (mode 0600). This is
the quality gate for your profile: silent when everything is fine and, when it is not, it shows you **all** the
problems at once with file and line. `cv validate` does the same without writing.

## 4. Generate the CV

```bash tutorial
cv generate-cv -s backend                 # output/cv-ada-ejemplo-backend.md
cv generate-cv -s backend --format pdf    # output/cv-ada-ejemplo-backend.pdf
cv generate-cv -s backend --explain       # what was included and why, on stderr
```

`-s backend` picks the specialty: its headline, its summary and its tag vocabulary decide which jobs,
achievements and skills make it in. Without `-s` you get the full CV.

## Next steps

- Replace the sample with your own data: [Source format (es)](/guide/sources) or the tutorial
  [Your profile from scratch](/en/tutorials/profile-from-scratch).
- Tailor the CV to a specific job offer: [Tailoring to a job offer](/en/guide/offers).
- Editorial-quality PDFs with themes: [Typst and themes](/en/guide/typst-themes) (`cv typst install`, the only
  network operation the product performs).
- Let a local model propose verified improvements: [AI co-pilot](/en/guide/copilot).

::: tip This page runs in continuous integration
The commands above are executed against the real binary on every change to the project, checking that they
produce `data/dist/profile.json` and the CVs in Markdown and PDF — the English page as well as the Spanish one.
If a translation ever drifts from the commands it documents, CI catches it.
:::
