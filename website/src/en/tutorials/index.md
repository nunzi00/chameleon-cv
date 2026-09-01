---
title: Tutorials
---
# Tutorials

Six guided walkthroughs, start to finish, over a real workspace. Each one starts in an empty directory and needs
nothing `cv` doesn't bring, except where noted (Typst for publication-quality PDFs; a local model for the
co-pilot).

| Tutorial | What you'll learn | Needs |
|---|---|---|
| [1 · Your profile from scratch](./profile-from-scratch) | The shape of each file, how to validate, build and generate your first CV in Markdown and PDF, and how to read `--explain`. | Nothing |
| [2 · One CV for three offers](./three-offers) | Analysing three different offers, tailoring the CV to each one, trimming it and understanding the scoring. | Nothing |
| [3 · Your own theme](./own-theme) | Creating a theme from `classic`, changing its variables, fixing it in `cv.toml` and generating a PDF with Typst. | `cv typst install` |
| [4 · The co-pilot with Ollama](./copilot-ollama) | Setting up a local model, seeing exactly what would leave, getting verified rewrites and summaries, tagging and applying what you tick. | Ollama with a model |
| [5 · Everything in a container](./docker) | Using Chameleon CV with Docker Compose: your data in `my-profile`, PDFs with Typst without installing anything, and the AI overlay with Ollama. | Docker |
| [6 · The API from the terminal](./api) | Starting `cv serve`, using it with `curl` (status, sources, generation, co-pilot jobs with live events and reviews) and stopping it: everything a client needs. | `curl`; a local model for the real job |

::: tip The tutorials run themselves
The command blocks marked as tutorial are executed in continuous integration against the real binary, in a
temporary workspace, and are checked to produce the files each page promises. **The English pages run too**: their
executable blocks are byte-identical to the Spanish ones, so if a translation drifts from the commands it
documents, CI catches it. Steps that need Typst, a model or Docker are skipped visibly when they aren't
available.
:::
