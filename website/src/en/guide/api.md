---
title: The local API (cv serve)
---
# The local API: `cv serve`

`cv serve` starts an HTTP server on your machine that exposes **the same as the CLI** over a workspace: sources,
validation, compilation, CV generation, offer analysis, themes and the AI co-pilot. It is the foundation of the
web interface and of any client you want to write (a script, an editor, an extension). The
[full contract (es)](/reference/api) is generated from the server itself; this guide walks it with `curl`.
[Tutorial 6](/en/tutorials/api) does it step by step.

## Starting and stopping

```bash
cv serve                     # http://127.0.0.1:4310/ · prints the URL with the session token
cv serve --api-only --port 0 # no home page and on a free port (your own clients, tests)
cv serve --workspace ~/my-cv # another workspace (the current directory by default)
```

On start you'll see something like:

```text
Chameleon CV 1.1.0 · espacio de trabajo /home/ada/my-cv
API: http://127.0.0.1:4310/api/v1/ (Authorization: Bearer <token>)
Interfaz: http://127.0.0.1:4310/#token=4f6c…e2
Ctrl-C para parar (o POST /api/v1/shutdown)
```

The **session token** is random, lives as long as the process and travels in the URL fragment (`#token=…`), which
the browser never sends to the server. Every request carries it in `Authorization: Bearer <token>`; without it,
`401`. To stop: `Ctrl-C` or `POST /api/v1/shutdown`.

## Talking to the API

```bash
TOKEN=4f6c…e2
API=http://127.0.0.1:4310/api/v1
curl -s -H "Authorization: Bearer $TOKEN" $API/status | jq .
curl -s -H "Authorization: Bearer $TOKEN" $API/sources
curl -s -H "Authorization: Bearer $TOKEN" $API/sources/experience/acme.md
```

Files are named with **identifiers relative** to the workspace (`experience/acme.md`), never with system paths:
the API rejects `..` and backslashes (`400 unsafe-path`). Every read returns a SHA-256 fingerprint (`sha256` and
an `ETag` header); every write demands it in `If-Match` (or `*` to create), and if someone changed the file in
between it answers `409 conflict` without touching anything:

```bash
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H 'If-Match: "3b7c…"' -d '{"content":"---\ncompany: ACME\n…"}' $API/sources/experience/acme.md
```

Writing a source through the API is **the user writing their sources** (canon C9): neither the server nor the
co-pilot does it on its own.

Generating the CV is one request with the same options as `cv generate-cv` (specialty, offer as text or as a
workspace file, format, engine, theme, limits); Markdown comes back in the response and the PDF is written to
`output/` and served from `GET /output/{name}`:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"specialty":"backend","format":"pdf","engine":"typst","offer":{"workspaceFile":"offers/acme.txt"},"compact":true}' $API/generate
curl -s -H "Authorization: Bearer $TOKEN" -o cv.pdf $API/output/cv-ada-ejemplo-backend-acme.pdf
```

Typst themes have their inventory (`GET /themes`, with each one's authorship and origin), creation from another
one (`POST /themes`) and, since 1.6.0, installing community themes (`POST /themes/install`) and verifying them
(`POST /themes/{name}/verify`). Installing from an `https://` URL requires starting with `cv serve
--allow-remote` and consenting in two steps: the first request answers `409 consent-required` with the
`estimateId`, the host and the limit; repeating it with `consent.estimateId` is the confirmation (single use, ten
minutes). An archive or directory from the workspace is installed with no question; `dryRun` returns the plan
without writing.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"themes/community.zip","dryRun":true}' $API/themes/install          # the plan: files, sizes and hashes
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"https://example.org/themes/community.zip","sha256":"<hash>"}' $API/themes/install   # 409 with estimateId → repeat with {"consent":{"estimateId":"…"}}
curl -s -X POST -H "Authorization: Bearer $TOKEN" $API/themes/community/verify                      # intact, modified or with no origin
```

**Offers** follow the same pattern: `GET /offers` lists `offers/**` with type and date; `POST /offers/fetch`
downloads an offer from an `https` URL —it requires `--allow-remote` and the two-step consent with an
`estimateId` (a single request, no cookies, 2 MiB)— and returns the extracted text with its provenance
(`json-ld`, `json-ld+cuerpo`, `contenido` or `página`) and warnings; `POST /offers` saves the sanitised text in
`offers/` with an origin header (`409` if it exists, unless `replace: true`). And **importing a CV** is
`POST /import-cv` with the binary file as the body (PDF or DOCX, up to 10 MiB; optional `x-cv-import-name` and
`x-cv-import-replace: 1` headers): it answers `201` with the draft's summary and its `README.md`.

```bash
curl -s -H "$AUTH" $API/offers                                      # the listing for Generar's picker
curl -s -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"url":"https://company.com/job"}' $API/offers/fetch           # 409 with estimateId → repeat with {"consent":{"estimateId":"…"}}
curl -s -H "$AUTH" -H 'Content-Type: application/pdf' \
  --data-binary @old-cv.pdf $API/import-cv                           # 201: draft in import/<name>/
```

Analysing an offer is `POST /analyze-offer`, and it accepts an optional `copilot` block so that a model gives the
offer a second reading (see [Tailoring the CV to a job offer](/en/guide/offers)): it answers `403
remote-disabled` without `--allow-remote` and `409 consent-required` with an `estimateId` when the provider is
remote, exactly like the co-pilot's jobs.

## The co-pilot as jobs

`cv improve`, `cv summarize` and `cv suggest tags` take as long as the model takes, so the API turns them into
**jobs**: `POST /jobs/improve` (or `/jobs/summarize`, `/jobs/suggest-tags`) answers `202` instantly with the
job's identifier, a `Location` header and, as the CLI does before sending anything, **what is going to leave and
where to** (`sending`: number of fragments, words, destination). Jobs run one at a time (a single local model)
and are followed in two ways:

```bash
JOB=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"specialty":"backend","topN":3,"proposals":2}' $API/jobs/improve | jq -r .job.id)
curl -s -N -H "Authorization: Bearer $TOKEN" $API/jobs/$JOB/events   # live events (SSE)
curl -s -H "Authorization: Bearer $TOKEN" $API/jobs/$JOB              # or the state whenever you want
```

The event stream (`text/event-stream`) repeats the job's full state on connecting and then emits `line` for each
progress line —the same ones the CLI prints— and `status` on every change, until `done`, `failed` or `cancelled`.
`DELETE /jobs/{id}` **cancels**: if it was queued it ends right away; if it was running, the request to the model
is aborted and the batch stops; no review is written. The result of `improve` and `summarize` is the review
written in `output/` (name, path, hash and statistics); that of `suggest tags`, the tags for each fragment.

The options are the CLI's (`specialty`, `offer`, `topN`, `only`, `proposals`, `maxLength`, `maxItems`,
`redactCompanies`, `locale`, `output`, `cache`, `provider`, `model`), without paths: the offer goes as
`{ "text": "…" }` or `{ "workspaceFile": "offers/acme.txt" }`, and `output` is only the file's name inside
`output/`.

### Refining an import draft

`POST /jobs/import-map` queues the refinement of a draft in `import/` with the co-pilot: it re-reads its
`README.md`, sends **only** the unplaced lines —pseudonymised and with a closed vocabulary of sections—, verifies
every proposal by code (line that was sent, known section, one per line) and leaves the report up to date. It
doesn't write to `data/sources/` and applies nothing. Body: `{ "name": "<draft folder>" }` plus the usual
provider fields; it answers `404` if the draft doesn't exist and `400` if it has no unplaced lines left. Like
every other job, a remote provider requires `--allow-remote` (`403`) and the two-step cost consent (`409`).

### Allowing remotes from the configuration

`PUT /config/serve` saves `cv.toml`'s `[serve]` table (today only `allow_remote`) with the same `If-Match` as
`/config/llm`. **It doesn't change the running process**: it is read at startup, so `cv serve` has to be
restarted. `GET /config/llm` returns `remote: { allowed, configured, pending }` — what is in force, what the file
asks for and whether a restart is pending.

### Remote providers: `--allow-remote` and consent

By default the server **sends nothing outside your machine**: a job asking for a remote provider
(`"provider": "openai"`) gets `403 remote-disabled`. If you start with `cv serve --allow-remote`, every remote
job crosses the same drawbridge as the CLI, in two steps:

1. The first request answers `409 consent-required` with the cost estimate (requests, input and maximum output
   tokens), the notice in plain text and an `estimateId`.
2. You repeat the identical request adding `"consent": { "estimateId": "…" }`: that is your explicit
   confirmation. Each `estimateId` is valid once, for the same task and for ten minutes.

## Reviews

The reviews the co-pilot leaves in `output/` (`revision-*.md`) can be listed, read with their structure
interpreted (items, proposals, verdicts and `[x]` marks), edited with `If-Match` and applied:

```bash
curl -s -H "Authorization: Bearer $TOKEN" $API/reviews
curl -s -H "Authorization: Bearer $TOKEN" $API/reviews/revision-improve-2026-08-29-backend.md
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' \
  $API/reviews/revision-improve-2026-08-29-backend.md/apply                    # the plan only (dryRun by default)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"dryRun":false}' \
  $API/reviews/revision-improve-2026-08-29-backend.md/apply                    # writes, with the previous version in the history and the fingerprint checked
```

`apply` is `cv improve apply`: only what is marked, minimal change, a backup first and, if the original is no
longer exactly that in the source, nothing is written (`422` with the detail). By default it only returns the
plan; writing requires `"dryRun": false`.

## In Docker

`compose.serve.yml` publishes the port **only on the host's loopback**; the token appears in the container's
logs:

```bash
docker compose -f compose.yml -f compose.serve.yml up
docker compose logs chameleon-cv | grep Token
```

With the local model from `compose.ai.yml` (which shares Ollama's network), use `compose.serve-ai.yml` instead.
More in [Chameleon CV in Docker](/en/guide/docker#the-api-from-the-container).

## Security, in short

`127.0.0.1` only; a 256-bit session token compared in constant time; `Host` restricted to loopback (against DNS
rebinding) and `Origin` required to be our own on writes (against CSRF); **no CORS**; bounded bodies (1 MiB JSON,
10 MiB PDF); `Cache-Control: no-store`; never absolute paths or keys in the responses. The full analysis is in
the design note, [§6 «Modelo de amenazas» (es)](/design/api-headless#_6-seguridad-modelo-de-amenazas-de-un-servidor-local).
If you publish the port from a container, do it only on loopback; `--allowed-hosts` accepts other `Host` values
when a local proxy rewrites it.
