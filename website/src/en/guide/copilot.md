---
title: AI co-pilot
---
# AI co-pilot

The co-pilot **suggests** and never decides, nor writes to your sources: the full doctrine (canons C1–C15) lives
in the design note [Co-piloto de IA: diseño y principios (es)](/design/llm-integration). It is **local by
default** and only talks to a model server on your own machine (loopback); remote providers (`openai`,
`anthropic`) require an explicit `--provider` on every command, show the estimated cost and ask for confirmation
before anything is sent.

```bash
cv llm status                                   # which local provider and model would be used, and whether they answer (never sends data)
cv improve -s backend --top-n 3                 # proposes higher-impact rewrites for that version's achievements
cv improve -f offer.pdf --compact               # … for the ones that survive tailoring, using the offer's terms
cv improve --only exp-acme-1 --show-payload --dry-run   # shows exactly what would leave (pseudonymised) without sending anything
cv summarize -s backend                         # proposes the professional summary from the filtered profile
cv suggest tags "Migrated the platform to Kubernetes with no downtime"   # tags for a text, only from the closed dictionary
cv improve apply output/revision-improve-2026-08-29.md   # applies what is marked [x]: previous version to history, fingerprint checked
cv history                                               # the version history of your sources (output/historial-fuentes/)
cv history show latest experience/acme.md                # the last saved version of a source
cv history restore latest experience/acme.md             # writes it back (the current one also goes to the history)
cv llm cache clear                              # empties the local response cache
```

## Setting up a local model

Environment variables, nothing else: `CHAMELEON_LLM_PROVIDER` (`ollama` by default, or `openai-compatible` for
llama.cpp's `llama-server`, LM Studio…), `CHAMELEON_LLM_BASE_URL` (`http://127.0.0.1:11434` or `:8080` by
default; any non-local address is rejected) and `CHAMELEON_LLM_MODEL` (`qwen3:8b` by default, the model the
product is validated against). With a 7B model on CPU, count on 20–40 s per achievement: use `--only`, `--top-n`
and `--max-items` to keep the batch small. Tutorial: [The co-pilot with Ollama](/en/tutorials/copilot-ollama).

### Local models: catalogue, download and reasoning

`cv llm models` lists the catalogue of local models (`qwen3:8b` by default, `qwen2.5:7b-instruct`,
`deepseek-r1:8b`, `gpt-oss:20b`, `qwen3:4b`) with family, reasoning (none, switchable or always), size, minimum
RAM, licence, recommended tasks and mirror, and marks which ones are downloaded. `cv llm up --model <id>`
downloads them and starts Ollama with whatever the machine has —the `ollama` binary if it exists and, failing
that, Docker (container `chameleon-ollama`); if the chosen route fails to start, the other one is tried, and
`cv llm status` says which will be used and why—; if Ollama's registry fails and the model has a mirror on
Hugging Face, the mirror is downloaded (`hf.co/<repo>:<quantisation>`) and aliased to the short name
(`--source huggingface` goes straight to the mirror). `[llm] think = true` in `cv.toml` (or
`CHAMELEON_LLM_THINK=1`) asks for reasoning from models that can switch it on — but the tasks with a strict JSON
schema (all the co-pilot's) ignore it: while reasoning, the model exhausts its tokens and the answer arrives
empty; models that always reason (DeepSeek-R1) are accepted anyway, with their reasoning discarded before the
JSON is validated. In the web interface, «Ajustes» offers the same catalogue in a selector.

## `cv improve`: verified rewrites

It writes a **review file** (`output/revision-improve-<date>[-<specialty>][-<offer>].md`, mode 0600) with, per
achievement, the original, each proposal and its **verification**: the code checks —without trusting the model—
that no proposal adds figures, entities or context that weren't in the original, and that it omits no figure or
entity that was there (canon C2, semantic integrity); the ones that fail appear struck through with the reason
(`VIOLATION_C2_FACT_OMITTED (40)`, `VIOLATION_C2_ENTITY_ADDED (Kubernetes)`…). Before sending, the command says
what leaves and where to: only the achievement's text and its immediate context, with your name replaced by
`[NOMBRE]` (and companies by `[EMPRESA-n]` with `--redact-companies`); never email, phone, location or links.
Valid responses are stored in your user cache (0600) so repeating is free and identical (`--no-cache` skips it).

## `cv summarize`: the professional summary

It sends a textual, pseudonymised representation of the **already filtered** profile (with years of experience
computed by code, so the model doesn't have to invent them) and writes `output/revision-summarize-…md` with two
or three proposals verified in synthesis mode: any figure or entity not in the profile is rejected, as is any
proposal that mentions none of the key facts (the specialty's tags and the offer's terms that your profile
proves); each proposal states which key facts it mentions and which it doesn't.

## `cv suggest tags`: tags from the closed dictionary

This closes the loop with the deterministic engine: the selector and the scoring depend on tags, and this command
proposes —**only from the closed dictionary** made up of your specialties' tags— the ones that a text (`-` =
stdin) or your profile's achievements (`--only <ids>`, `--untagged`, `-s` to narrow the dictionary) demonstrate.
The code verifies every returned tag: anything outside the dictionary is rejected, `pin` is reserved, there are
no duplicates and no more than `--max-tags`, and each accepted tag carries its **evidence computed by code**
(`literal`, `contexto` or `inferida`; `--explain` shows it). Standard output gives you the line ready to paste
(`#php #kubernetes`).

With `--apply` there is nothing to paste: **the ones you approve are written to your sources**. On a terminal it
asks achievement by achievement (`--yes` accepts them all without asking), and only the tags the bullet didn't
have go in: they are appended at the end of its line, after any it already carried, with a `.bak` copy beside it
and nothing else touched. If the achievement changed by hand since it was suggested, that one isn't written and
you're told why. Then, `cv build`.

```bash
cv suggest tags --untagged --apply          # asks achievement by achievement and writes what you accept
cv suggest tags --only exp-acme-1 --apply --yes && cv build
```

The web does the same from **Co-piloto**: when the job finishes, each achievement shows its new tags with a
checkbox —none is ticked— and «Aplicar en mis fuentes» writes only the ticked ones, with the same report of what
wasn't written and why.

## Closing the loop: `cv improve apply`

Mark with `[x]` in the review file (from `improve` or `summarize`) the proposals you want to adopt —you can edit
their text— and apply them. It is the only command that writes to `data/sources/`, with four guarantees: **only
what is marked** (one proposal per item); **minimal change** (only the achievement's text or the summary;
`#hashtags`, metadata and the rest of the file stay byte for byte identical); **a backup first** (`<file>.bak`,
and `.bak.1`, `.bak.2`… if one already existed); and a **fingerprint check**: the review records file, line and
`sha256` of every original, and if the original is no longer exactly that, nothing is written. `--dry-run` shows
the plan, `--delete-review` removes the applied review, and afterwards you rebuild with `cv build`.

**Applying the same review twice is not an error.** If the source already holds the proposal's text, it is
reported —«2 propuestas ya aplicadas (…)»—, nothing is rewritten and the command exits with 0. To undo it, the
source history is there and the command reminds you: `cv history` lists the previous versions and
`cv history restore latest <source>` brings the earlier one back (the current one goes to the history in turn).
In the web interface, the same from **Fuentes → Historial de esta fuente**, with «Ver diferencias» and «Restaurar
esta versión».

And you don't have to apply to find out: in the web interface, **Revisiones** compares every item with what is in
your sources **today** and says so next to it —«ya aplicada», «sin aplicar», «la fuente cambió» or «sin fuente
registrada»—, with the count beside the name in the list («1 de 3 ya aplicadas»). It looks at the text, not at a
stored mark: a review you apply and then undo with `cv history restore` shows up as pending again, which is the
truth.

## Remote providers (optional)

To use OpenAI's API (`--provider openai`, default model `gpt-4o-mini`) or Anthropic's (`--provider anthropic`,
`claude-sonnet-4-5`), four rules apply by design:

- **Explicit only, on every command.** A remote can't be the default provider (`CHAMELEON_LLM_PROVIDER=openai` is
  rejected): every `improve`, `summarize` or `suggest tags` that wants to leave your machine says so with
  `--provider openai|anthropic`; without it, everything stays local. `--model <name>` picks the model.
- **Keys never interactive, never in insecure plain text.** They are read, in this order, from
  `CHAMELEON_OPENAI_API_KEY` / `CHAMELEON_ANTHROPIC_API_KEY` or from `~/.config/chameleon-cv/keys.json`
  (`$XDG_CONFIG_HOME` if set; `%APPDATA%\chameleon-cv\keys.json` on Windows) with mode **0600** and the shape
  `{"openai": "sk-…", "anthropic": "sk-ant-…"}`. A file readable by other users is rejected, along with the
  `chmod 600` that fixes it; the program never asks for the key, never prints it, never stores it, and does not
  read `OPENAI_API_KEY` or other tools' variables.
- **Host allowlist.** Only `https` and only towards `api.openai.com` and `api.anthropic.com`; your own gateway
  requires declaring its host in `CHAMELEON_LLM_ALLOWED_HOSTS` (comma-separated) and the base URL in
  `CHAMELEON_OPENAI_BASE_URL` / `CHAMELEON_ANTHROPIC_BASE_URL`. No redirects: anything outside the list is
  rejected in code before the connection is opened.
- **Cost awareness.** Before the first request the command shows how many requests will leave, an estimate of
  input tokens (4 characters ≈ 1 token) and the output maximum, warns that this may incur costs and asks for
  confirmation (`s/N`); with no interactive terminal it cancels unless you pass `--yes`. What leaves is exactly
  the same as with a local provider: the pseudonymised fragment `--show-payload` displays.

`cv llm status` says where each key would come from without showing its value, and with `--provider <remote>` it
verifies the key, the allowlist and the available models.
