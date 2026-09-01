---
title: 6 · The API from the terminal
verify:
  - output/cv-ada-ejemplo-backend.md
  - serve.log
cleanup:
  - "[ -f serve.pid ] && kill $(cat serve.pid) 2>/dev/null; true"
---
# Tutorial 6 · The API from the terminal

`cv serve` exposes on your machine the same as the CLI, for the web interface and for your own clients. Here you
start the server on the sample profile, use it with `curl` —status, sources, generation, co-pilot jobs and
reviews— and stop it. You only need `curl`; the [API guide](/en/guide/api) explains each piece and the
[reference (es)](/reference/api) lists every route.

The commands are kept exactly as in the Spanish tutorial, so that continuous integration runs both pages against
the real binary.

## 1. Sample profile and a running server

The server starts in the background, on a free port (`--port 0`) and with no home page (`--api-only`); its output
goes to `serve.log`, where the URL with the session token is.

```bash tutorial
cv init
cv build
cv serve --api-only --port 0 > serve.log 2>&1 &
echo $! > serve.pid
for i in $(seq 1 100); do grep -q '^Token:' serve.log && break; sleep 0.1; done
cat serve.log
```

```text
Chameleon CV 1.1.0 · espacio de trabajo /tmp/…/work
API: http://127.0.0.1:37411/api/v1/ (Authorization: Bearer <token>)
Token: http://127.0.0.1:37411/#token=9c1e…
Ctrl-C para parar (o POST /api/v1/shutdown)
```

## 2. Status and sources

Every request carries the token in `Authorization: Bearer`. Files are named with relative identifiers, never with
paths; every read brings its SHA-256 fingerprint.

```bash tutorial
URL=$(sed -n 's/^Token: \(http:[^#]*\)#token=.*/\1/p' serve.log)
TOKEN=$(sed -n 's/^Token: .*#token=//p' serve.log)
curl -s -H "Authorization: Bearer $TOKEN" "${URL}api/v1/status"; echo
curl -s -H "Authorization: Bearer $TOKEN" "${URL}api/v1/sources"; echo
curl -s -H "Authorization: Bearer $TOKEN" "${URL}api/v1/sources/profile.md" | head -c 400; echo
curl -s -o /dev/null -w 'sin token: %{http_code}\n' "${URL}api/v1/status"
```

## 3. Generating the CV through the API

The same options as `cv generate-cv`, in JSON. The Markdown comes back in the response and the file lands in
`output/`.

```bash tutorial
URL=$(sed -n 's/^Token: \(http:[^#]*\)#token=.*/\1/p' serve.log)
TOKEN=$(sed -n 's/^Token: .*#token=//p' serve.log)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"specialty":"backend"}' "${URL}api/v1/generate" | head -c 300; echo
curl -s -H "Authorization: Bearer $TOKEN" "${URL}api/v1/output"; echo
ls output
```

## 4. The co-pilot as a job

`POST /jobs/improve` queues the task and answers `202` with the identifier; before queueing it checks the
provider, just like the CLI. With no local model running, the response says so (`503`), and the job list stays
empty:

```bash tutorial
URL=$(sed -n 's/^Token: \(http:[^#]*\)#token=.*/\1/p' serve.log)
TOKEN=$(sed -n 's/^Token: .*#token=//p' serve.log)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"specialty":"backend","maxItems":2,"proposals":1}' "${URL}api/v1/jobs/improve"; echo
curl -s -H "Authorization: Bearer $TOKEN" "${URL}api/v1/jobs"; echo
```

With a local model (as in [tutorial 4](./copilot-ollama)), the job runs and `GET /jobs/{id}/events` follows it
live over *Server-Sent Events*: a `status` event on connecting, a `line` per achievement and the final `status`
with the review written. Afterwards, the review shows up in `GET /reviews`.

```bash tutorial needs-llm
URL=$(sed -n 's/^Token: \(http:[^#]*\)#token=.*/\1/p' serve.log)
TOKEN=$(sed -n 's/^Token: .*#token=//p' serve.log)
JOB=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"specialty":"backend","maxItems":2,"proposals":1,"cache":false}' "${URL}api/v1/jobs/improve" \
  | sed -n 's/.*"job":{"id":"\([^"]*\)".*/\1/p')
echo "Trabajo $JOB"
curl -s -N -H "Authorization: Bearer $TOKEN" "${URL}api/v1/jobs/$JOB/events"
curl -s -H "Authorization: Bearer $TOKEN" "${URL}api/v1/reviews"; echo
```

## 5. Stopping the server

`POST /shutdown` stops it gracefully (the web interface uses it when closing); `Ctrl-C` does the same in the
foreground.

```bash tutorial
URL=$(sed -n 's/^Token: \(http:[^#]*\)#token=.*/\1/p' serve.log)
TOKEN=$(sed -n 's/^Token: .*#token=//p' serve.log)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' "${URL}api/v1/shutdown"; echo
for i in $(seq 1 100); do kill -0 "$(cat serve.pid)" 2>/dev/null || break; sleep 0.1; done
tail -n 1 serve.log
```

```text
{"ok":true}
Servidor detenido
```

What you've seen is everything a Chameleon CV client needs: a token, JSON, relative identifiers and jobs with
events. The web interface uses nothing more.
