---
title: 4 · The co-pilot with Ollama
verify:
  - data/dist/profile.json
---
# Tutorial 4 · The co-pilot with Ollama

The co-pilot proposes and you decide: rewrites of achievements, summaries and tags, always **verified by code**
and always in review files, never in your sources. In this tutorial you set it up with a local model and walk the
whole cycle through to applying what you tick.

The commands are kept exactly as in the Spanish tutorial, so that continuous integration runs both pages against
the real binary.

## 1. A local model

Install [Ollama](https://ollama.com) and pull the model the product is validated against:

```bash
ollama pull qwen3:8b
ollama serve            # if it isn't running already (it listens on http://127.0.0.1:11434)
```

Nothing needs configuring: `ollama` and `qwen3:8b` are the defaults (`cv llm models` lists the local catalogue
with what's downloaded; `cv llm up` downloads it and starts Ollama for you, using the Hugging Face mirror if
Ollama's registry fails). With another OpenAI-compatible server (llama.cpp's `llama-server`, LM Studio…):
`CHAMELEON_LLM_PROVIDER=openai-compatible`, `CHAMELEON_LLM_BASE_URL=http://127.0.0.1:8080` and
`CHAMELEON_LLM_MODEL=<name>`. Any non-local address is rejected.

```bash tutorial needs-llm
cv llm status
```

## 2. What would leave, without sending anything

```bash tutorial
cv init
printf -- '- Migré la plataforma de pagos a Kubernetes sin ventana de parada, coordinando a tres equipos.\n' >> data/sources/achievements.md
cv build
cv improve --only exp-acme-1 --show-payload --dry-run
cv improve --show-prompt
```

Along the way we've added a cross-cutting achievement to `achievements.md` **with no tags**: in step 4 the
co-pilot will propose some. Neither `improve` command contacts the model. The first shows **exactly** the
payload: the achievement's text and its immediate context, with the name replaced by `[NOMBRE]` (and
`--redact-companies` would replace the companies); never email, phone, location or links. The second prints the
versioned prompt (`prompts/improve.v1.md`).

## 3. Verified rewrites

```bash tutorial needs-llm
cv improve -s backend --top-n 2 --max-items 2
ls output
```

With a 7B model on CPU count on 20–40 s per achievement; `--only`, `--top-n` and `--max-items` keep the batch
small. The result is an `output/revision-improve-<date>-backend.md` file with, per achievement, the original,
each proposal and its **verification**: the code checks —without trusting the model— that no proposal adds
figures, entities or context that weren't in the original, and that it omits no figure or entity that was there.
The ones that fail appear struck through with the reason (`VIOLATION_C2_FACT_OMITTED (40)`…).

## 4. The summary and the tags

```bash tutorial needs-llm
cv summarize -s backend
cv suggest tags "Migré la plataforma de pagos a Kubernetes sin ventana de parada" -s backend --explain
cv suggest tags --untagged --explain
```

`summarize` proposes two or three summaries from the profile **already filtered** by the specialty, verified in
synthesis mode (no figure or entity that isn't in the profile; each proposal states which key facts it mentions).
`suggest tags` only returns tags from the **closed dictionary** —your specialties' tags— and each one carries its
evidence computed by code; standard output gives the line ready to paste at the end of the bullet (`--untagged`
walks the profile's achievements that still have no tags, like the one we added; if they all have some, it says
so and exits with code 1).

## 5. Apply what you tick

Open the review, tick with `[x]` the proposals you want to adopt (you can edit their text) and apply them:

```bash
$EDITOR output/revision-improve-*-backend.md        # change «- [ ]» to «- [x]» on whatever you want to adopt
cv improve apply output/revision-improve-*-backend.md --dry-run
cv improve apply output/revision-improve-*-backend.md
```

With nothing ticked there is nothing to apply: the command says so and exits with code 1 (which is why this step
doesn't run on its own in continuous integration; the acceptance harness covers it with ticked reviews).
`--dry-run` shows the plan. Without it, `cv improve apply` is the only command that writes to `data/sources/`:
only what is ticked, minimal change (the `#hashtags`, the metadata and the rest of the file stay byte for byte
identical), a `<file>.bak` copy first and a fingerprint check (if the original changed since the review was
generated, nothing is written). Afterwards, `cv build`.

## 6. Remote providers, only if you say so

```bash
cv improve -s backend --provider openai            # shows the estimated cost and asks for confirmation before sending
cv llm status --provider anthropic                 # key, allowlist and available models; never prints the key
```

Without `--provider` on the command, nothing leaves your machine. Keys are read from
`CHAMELEON_OPENAI_API_KEY` / `CHAMELEON_ANTHROPIC_API_KEY` or from `~/.config/chameleon-cv/keys.json` (0600).
All the detail: [AI co-pilot](/en/guide/copilot).
