---
title: Troubleshooting
---
# Troubleshooting

Messages from `cv` are in Spanish, because the CLI speaks Spanish
([the decision is on the record](/en/guide/quickstart)). This page keeps them verbatim so you can search for the
one you got, and explains it in English.

## Exit codes

`0` fine · `1` invalid data (sources, artifact or unknown specialty; a Typst template that doesn't compile) ·
`2` incorrect usage or an environment failure (permissions, disk, unreadable template, missing binary or service,
confirmation declined). In scripts, check the code before using the output.

## Common messages

| Message | What it means and what to do |
|---|---|
| `experience/acme.md:4: start: Fecha inválida` (and other validation errors) | The sources don't satisfy the schema. Each line carries file, line and key; all of them are shown at once. Format: [Source format](/en/guide/sources). |
| `Aviso: experience/acme.md es más reciente que el artefacto; ejecuta «cv build»` | You edited the sources and didn't rebuild. `cv build`, or `--build` on the command. |
| `No existe el artefacto` / `artefacto inválido` | `data/dist/profile.json` is missing or doesn't pass validation (it is re-validated every time). `cv build`. |
| `especialidad desconocida «x»` | There is no `specialties/x.md`. `cv build -v` lists the specialties it loaded. |
| `ya existe … no se escribe nada` (in `cv init`) | `init` never overwrites. Use another directory (`cv init my-cv`) or move the conflicting files away. |
| `No se encuentra Typst` | `--engine typst` with no binary. `cv typst install` (the only network operation), or `CHAMELEON_TYPST=/path/typst`, or `--typst-path`. `cv typst status` says what would be used. |
| `SHA-256 no coincide` (in `cv typst install`) | The download isn't the expected official release; the file is deleted without installing. Retry; if it persists, don't install: check your network or proxy. |
| `theme.toml: colors.primary: …` / `cv.toml: …` | A theme or configuration value fails validation; the path points at the key. `cv theme list` shows invalid themes with their reason. |
| `El proveedor local no responde` | There is no Ollama (or compatible server) listening on `CHAMELEON_LLM_BASE_URL`. Start the service, pull the model (`ollama pull qwen3:8b`) and check with `cv llm status`. |
| `dirección no local rechazada` | `CHAMELEON_LLM_BASE_URL` points outside loopback. Local providers can only be `127.0.0.1`/`localhost`; for remotes use `--provider`. |
| `permisos abiertos` (keys file) | `~/.config/chameleon-cv/keys.json` is readable by other users: `chmod 600` on the file. |
| `Operación cancelada: sin terminal interactiva, confirma con --yes` | A remote provider asks for confirmation and there's no TTY (script, CI). Add `--yes` if you accept the cost. |
| `VIOLATION_C2_…` in a review | The verifier rejected a proposal from the model (a figure or entity added or omitted). This is the expected behaviour: don't adopt it as is. |
| `el original cambió` (in `cv improve apply`) | The source file no longer matches the fingerprint recorded in the review (you edited it, or the review is old). Generate a new review. |
| `oferta en PDF: … límite` | The PDF is over 10 MiB or 50 pages, or takes more than 20 s. Trim it or paste the text. |

## Seeing what happens inside

- `--explain` on `generate-cv` and `analyze-offer`: every selection, scoring and trimming decision.
- `--show-payload --dry-run` on the co-pilot: exactly what would leave towards the model, sending nothing.
  `--show-prompt`: the versioned prompt.
- `cv build -v`: what was loaded. `cv typst status`, `cv llm status`, `cv theme list`: the state of the
  environment.

## Where the files are

| What | Where |
|---|---|
| Sources, artifact, CVs and reviews | `data/sources/`, `data/dist/profile.json`, `output/` in the workspace |
| Typst installed by `cv typst install` | `~/.cache/chameleon-cv/typst/0.15.1/typst` (`~/Library/Caches` on macOS, `%LOCALAPPDATA%` on Windows) |
| The co-pilot's response cache | user cache, `chameleon-cv` subdirectory; `cv llm cache clear` empties it |
| Executable assets (themes, fonts, sample dataset) | `~/.cache/chameleon-cv/assets/<version>/`, with its SHA-256 checked on every use |
| Remote provider keys | `~/.config/chameleon-cv/keys.json` (0600) or `CHAMELEON_*_API_KEY` variables |

Something that isn't here? Open an issue on
[GitHub](https://github.com/nunzi00/chameleon-cv/issues) with the exact command, the full message and
`cv --version`.
