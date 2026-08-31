---
title: Security and privacy
---
# Security and privacy

A CV is a document full of personal data. Chameleon CV is designed so that **nothing leaves your machine** unless
you ask for it, and so that whatever is written to disk stays within your reach alone.

## What leaves your machine (and what does not)

| Situation | Network |
|---|---|
| `cv build`, `generate-cv`, `analyze-offer`, `theme`, `validate`, `init` | **No** connection at all. |
| `cv typst install` | The **only network operation the product performs**: it downloads the official Typst release from GitHub, verified by SHA-256 against a manifest pinned at release time; only when you run it. |
| Co-pilot with a local provider (`ollama`, `openai-compatible`) | Loopback only (`127.0.0.1`/`localhost`); any other address is rejected. |
| Co-pilot with `--provider openai\|anthropic\|groq\|gemini` | Only with the explicit option on each command, towards an allow-list of hosts over `https`, after showing the estimated cost and asking for confirmation. |
| Telemetry, automatic updates, «product improvement» | They do not exist. |

Whatever goes to a model is **minimised and pseudonymised**: the text of the achievement and its immediate
context, the profile filtered for a summary, or a piece of text to tag; your name replaced by `[NOMBRE]`,
companies by `[EMPRESA-n]` with `--redact-companies`; never your email, phone, location or links.
`--show-payload --dry-run` shows you exactly what would leave, without sending anything.

## What is written to disk

- `data/dist/profile.json` and the CVs in `output/` contain personal data: they are written with **0600**
  permissions (your user only) and both directories are in the `.gitignore` that `cv init` creates. If you version
  your workspace, remember that `data/sources/` holds your data too: keep it in a private repository or exclude it.
- The co-pilot's review files (`output/revision-*.md`) and the response cache (in your user cache) are 0600.
- `cv improve apply` (and `cv history restore`) are the only commands that write into `data/sources/`: only with
  your `[x]` mark, after saving the whole previous version under `output/historial-fuentes/` (0600) and checking by
  digest that the original has not changed; a tampered review cannot point outside the sources directory.
- Remote provider keys are read from environment variables or from a file with 0600 permissions. They are never
  printed, and they are never read back — not even masked — by the API or by the web interface, which only report
  *whether* there is a key and *where* it comes from.

## How input is handled

- Only `.md`/`.csv` files inside the dataset are read; symbolic links pointing outside are an error; YAML without
  implicit typing or aliases; every input goes through a strict schema (lengths, control characters, `http(s)` URLs
  only).
- PDF offers are processed in an isolated worker with limits (10 MiB, 50 pages, 20 s, 512 MB), without loading
  fonts or rendering; the PDF that gets generated contains no code or automatic actions and is produced with no
  network and no external binaries.
- Typst runs as a contained child process: empty environment, no network, `--root` limited to the theme, time and
  memory limits; your data travels over stdin, never through arguments or temporary files.
- The artefact is **re-validated** every time it is read: a file on disk is not trusted, not even one we wrote.

## Supply chain

- The executable is built in continuous integration from the official Node.js binary, with dependencies pinned by
  `package-lock.json` and CI actions pinned by SHA.
- Every release publishes the `.sha256` of each archive, a `SHA256SUMS.txt` and a **provenance attestation**
  (SLSA), verifiable with `gh attestation verify <archive> --owner nunzi00`.
- The archive includes `THIRD-PARTY-NOTICES.md` with the licences of everything the executable bundles. Details in
  [Packaging and release (es)](/developers/packaging).

## Reporting a vulnerability

Do not open a public issue: use the repository's private security advisories on GitHub
(*Security → Report a vulnerability*).
