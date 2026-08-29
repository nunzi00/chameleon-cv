---
title: 6 · La API desde la terminal
verify:
  - output/cv-ada-ejemplo-backend.md
  - serve.log
cleanup:
  - "[ -f serve.pid ] && kill $(cat serve.pid) 2>/dev/null; true"
---
# Tutorial 6 · La API desde la terminal

`cv serve` expone en tu máquina lo mismo que la CLI, para la interfaz web y para clientes propios. Aquí arrancas el servidor sobre el perfil de ejemplo, lo usas con `curl` —estado, fuentes, generación, trabajos del co-piloto y revisiones— y lo paras. Solo necesitas `curl`; la [guía de la API](/guide/api) explica cada pieza y la [referencia](/reference/api) enumera todas las rutas.

## 1. Perfil de ejemplo y servidor en marcha

El servidor arranca en segundo plano, en un puerto libre (`--port 0`) y sin la página de inicio (`--api-only`); su salida queda en `serve.log`, donde está la URL con el token de sesión.

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

## 2. Estado y fuentes

Cada petición lleva el token en `Authorization: Bearer`. Los ficheros se nombran con identificadores relativos, nunca con rutas; cada lectura trae su huella SHA-256.

```bash tutorial
URL=$(sed -n 's/^Token: \(http:[^#]*\)#token=.*/\1/p' serve.log)
TOKEN=$(sed -n 's/^Token: .*#token=//p' serve.log)
curl -s -H "Authorization: Bearer $TOKEN" "${URL}api/v1/status"; echo
curl -s -H "Authorization: Bearer $TOKEN" "${URL}api/v1/sources"; echo
curl -s -H "Authorization: Bearer $TOKEN" "${URL}api/v1/sources/profile.md" | head -c 400; echo
curl -s -o /dev/null -w 'sin token: %{http_code}\n' "${URL}api/v1/status"
```

## 3. Generar el CV por la API

Las mismas opciones que `cv generate-cv`, en JSON. El Markdown vuelve en la respuesta y el fichero queda en `output/`.

```bash tutorial
URL=$(sed -n 's/^Token: \(http:[^#]*\)#token=.*/\1/p' serve.log)
TOKEN=$(sed -n 's/^Token: .*#token=//p' serve.log)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"specialty":"backend"}' "${URL}api/v1/generate" | head -c 300; echo
curl -s -H "Authorization: Bearer $TOKEN" "${URL}api/v1/output"; echo
ls output
```

## 4. El co-piloto como trabajo

`POST /jobs/improve` encola la tarea y responde `202` con el identificador; antes de encolar comprueba el proveedor, igual que la CLI. Sin un modelo local en marcha, la respuesta lo dice (`503`), y la lista de trabajos sigue vacía:

```bash tutorial
URL=$(sed -n 's/^Token: \(http:[^#]*\)#token=.*/\1/p' serve.log)
TOKEN=$(sed -n 's/^Token: .*#token=//p' serve.log)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"specialty":"backend","maxItems":2,"proposals":1}' "${URL}api/v1/jobs/improve"; echo
curl -s -H "Authorization: Bearer $TOKEN" "${URL}api/v1/jobs"; echo
```

Con un modelo local (como en el [tutorial 4](/tutorials/copilot-ollama)), el trabajo se ejecuta y `GET /jobs/{id}/events` lo sigue en directo por *Server-Sent Events*: un evento `status` al conectar, uno `line` por cada logro y el `status` final con la revisión escrita. Después, la revisión aparece en `GET /reviews`.

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

## 5. Parar el servidor

`POST /shutdown` lo detiene de forma ordenada (la interfaz web lo usa al cerrar); `Ctrl-C` hace lo mismo en primer plano.

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

Lo que has visto es todo lo que necesita un cliente de Chameleon CV: un token, JSON, identificadores relativos y trabajos con eventos. La interfaz web (T-7.5) no usará nada más.
