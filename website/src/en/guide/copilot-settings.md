---
title: Configuring the co-pilot
---
# Configuring the co-pilot

Since version 1.5.0 the co-pilot is configured in `cv.toml`, managed from the terminal (keys) and from the
**Ajustes** screen of the web interface, and is ready to use an external provider with a free plan —Groq, pending
human verification and for now not selectable— without giving up the usual guarantees: local by default, no call
you didn't ask for, and no provider that trains on your data.

## The local provider in `cv.toml`

```toml
[llm]
provider = "openai-compatible"        # "ollama" (default) or "openai-compatible"
base_url = "http://127.0.0.1:8080"    # always local (loopback)
model = "qwen3:8b"
think = false            # true asks for reasoning from models that can switch it on (Qwen3, gpt-oss); slower

[llm.models]                          # optional: the default model of each remote provider
groq = "openai/gpt-oss-120b"
```

- **Precedence**, field by field: the command's `--provider`/`--model` > `CHAMELEON_LLM_*` variables > `cv.toml`
  > defaults. `cv llm status` says where each value comes from («orden», «entorno», «cv.toml», «por defecto») and
  whether `cv.toml` exists, has the `[llm]` table or is invalid; an invalid `cv.toml` is not ignored in silence:
  the co-pilot stops with the error.
- A remote provider is **never** fixed in `cv.toml`: it is chosen per command (`--provider groq`) or per job in
  the interface, with the usual cost consent. `[llm.models]` only decides which model to use when you pick it.

## Starting and stopping Ollama from cv

If the local provider is Ollama, `cv` can start and stop it for you, with the configured model:

```sh
cv llm up                         # starts Ollama and downloads the model if missing
cv llm up --model llama3:8b       # another model for this start only
cv llm up --runner docker         # forces the runner (native = the ollama binary; docker = a container)
cv llm up --no-pull               # don't download the model if missing
cv llm down                       # stops the Ollama that cv started
cv llm status                     # includes the «runtime: …» line
```

How it works:

- **Runner `native`** (there's an `ollama` on the `PATH`, or in `CHAMELEON_OLLAMA_BIN`): `ollama serve` as an
  independent child process, with `OLLAMA_HOST` derived from the loopback `base_url`; the log goes to
  `~/.cache/chameleon-cv/ollama/serve.log` and the pid to `ollama.pid` (mode 0600).
- **Runner `docker`** (there's Docker): a `chameleon-ollama` container with the `ollama/ollama` image pinned by
  digest (the same one as `compose.ai.yml`; change it with `CHAMELEON_OLLAMA_IMAGE`), the port published only on
  `127.0.0.1` and a `chameleon-ollama` volume for the models. `cv llm down` does `docker stop`: the container and
  the models are kept, so the next `up` downloads nothing again.
- By default `native` is used if `ollama` exists, otherwise `docker`; `--runner`, `CHAMELEON_LLM_RUNNER` or
  `cv.toml`'s `[llm.runtime]` table force it (the environment wins over the file). The same table accepts `image`
  for the docker runner:

  ```toml
  [llm.runtime]
  runner = "docker"
  image = "ollama/ollama:0.33.2@sha256:…"
  ```

  In the web interface, «Ajustes → Co-piloto local» has both fields and saves them with the rest of the `[llm]`
  table.
- **Only what cv started is stopped.** If Ollama already answers but you started it, `up` doesn't touch it (it
  only makes sure of the model) and `down` refuses with a clear message.
- The only network egress is downloading the model from Ollama's public registry (the same one using Ollama
  implies); it carries no data of yours. In the web interface, «Ajustes → Ollama local» asks for consent before
  downloading and follows the download like any other co-pilot job.
- Inside the product's Docker image (Compose) this feature is disabled: there, Ollama is a Compose service of its
  own (`compose.ai.yml`).

Exit codes: `0` fine; `1` invalid model or runner; `2` no runner, someone else's Ollama, or a failed start,
download or stop. With `--json` you get the full result (state, progress lines and, on failure, code and
message).

## Remote provider keys

```bash
cv llm key set groq        # asks for it without echoing (or reads it from standard input with no terminal)
cv llm key list            # where each key comes from: environment, file or none; never its value
cv llm key remove groq
```

Also from **Ajustes → Proveedores externos**, where each provider has its «Clave de …» field with «Guardar
clave» and «Borrar clave».

They are stored in `~/.config/chameleon-cv/keys.json` with mode `0600` (directory `0700`); a
`CHAMELEON_<PROVIDER>_API_KEY` variable takes precedence over the file, and the page tells you so if you save a
key the variable is going to shadow.

What does **not** change: keys are not passed as arguments, are not printed and are **never read back**. When you
save one from the web it travels exactly once, in the request body, over the server's `127.0.0.1` and with your
session token; from then on no response returns it —not even masked—, the field empties itself and both Ajustes
and the API say only *whether* there is a key and *where* it comes from. If you'd rather it never went through
the browser at all, the terminal is still there.

## External providers and quotas

Every remote provider is in a **registry** with its evidence: the URL, the date and the literal quote of the
policy stating that they don't train on what you send through the API. `cv llm status` and Ajustes show it; with
no evidence there is no provider.

| Provider | Plan | Default model | Published quota |
|---|---|---|---|
| `openai` | paid | `gpt-4o-mini` | according to the account tier |
| `anthropic` | paid | `claude-sonnet-4-5` | according to the account tier |
| `groq` | **free** (no card) — **pending human verification, not selectable yet** | `openai/gpt-oss-120b` (also `qwen/qwen3.8-27b`, *preview*) | 30 requests/min, 1,000/day, 8,000 tokens/min, 200,000 tokens/day (gpt-oss) or 2,000,000 (qwen3.8) (per their documentation as of 2026-08-30) |

**Which Groq model for which action** (`cv llm status` shows it; pick it with `--model` or `[llm.models]`):
**improving achievements and summarising → `openai/gpt-oss-120b`** (proven quality in Spanish, strict schema,
prompt cache; its free quota is enough for one session a day); **suggesting tags → `qwen/qwen3.8-27b`**
(switchable reasoning and ten times the daily quota), which also works for the other two tasks if you run several
free sessions a day, with the caveat that it is in *preview* (Groq may withdraw it) and that its Spanish is not
measured: if it fails, go back to `openai/gpt-oss-120b`.

Groq is registered after a study with evidence (`docs/copilot-providers.md` in the repository) and **will become
available when a person completes the sign-up verification protocol** (§9 of that note); until then `cv llm
status` and Ajustes show it as pending and `--provider groq` is rejected: its service agreement forbids training
on inputs and outputs and retention is 30 days at most, switchable off with *Zero Data Retention* in their
console (recommended). The free plans of other known providers were ruled out because they allow training on the
data you send.

**Visible quota, no telemetry.** Beyond the published limits, the product reads the quota headers the provider
returns on the calls you already asked for (`x-ratelimit-*`, `retry-after`) and shows them —when a remote job
finishes, in `cv llm status` and in Ajustes— without making any extra call or storing them on disk. If the
provider answers 429 (quota exhausted), the command stops with `quota-exceeded` and whatever wait it indicates;
it never retries on its own.

```bash
cv improve --provider groq -n 1
# …
# Cuota según groq: quedan 28/30 peticiones (se renueva en 12 s)
```

## The Ajustes screen

![The Ajustes screen: local provider and model with their origin, and the external providers with key, quota and evidence](/gui/ajustes.png)

- **Co-piloto local**: provider, base URL (loopback only) and model, with the origin of each effective value;
  whatever the environment fixes appears read-only. **Guardar en cv.toml** writes only the `[llm]` table (the
  rest of the file doesn't change) with concurrency control; **Comprobar** makes a single health call to the
  provider and lists its models.
- **Proveedores externos**: plan, host, default model, whether there's a key and where, published quota (with
  source and date), live quota if available, and the evidence. **Comprobar** is only enabled with a key and with
  a server that allows remotes; it is an explicit call with none of your data.
- **Allowing or forbidding remotes** (since 1.10.0): the button on that same card saves `[serve] allow_remote` in
  `cv.toml` and **takes effect on restarting** `cv serve`. This is deliberate: a server started without egress
  permission can't grant it to itself from its own interface. The command's flag always wins over the file, in
  both directions (`--allow-remote` allows it even if the file forbids it; `--no-allow-remote` forbids it even if
  the file allows it). While the file asks for something different from what's in force, the page says so.
- In **Co-piloto**, the provider selector offers the local one and the usable remotes (with a key and remotes
  allowed); the model is filled in with the chosen provider's.

The API exposes the same: `GET /api/v1/config/llm`, `PUT /api/v1/config/llm` (with `If-Match`) and
`POST /api/v1/config/llm/check` (see the [API reference (es)](/reference/api)).
