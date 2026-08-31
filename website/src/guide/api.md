---
title: La API local (cv serve)
---
# La API local: `cv serve`

`cv serve` arranca en tu máquina un servidor HTTP que expone **lo mismo que la CLI** sobre un espacio de trabajo: fuentes, validación, compilación, generación del CV, análisis de ofertas, temas y el co-piloto de IA. Es la base de la interfaz web y de cualquier cliente que quieras escribir (un script, un editor, una extensión). El [contrato completo](/reference/api) se genera desde el propio servidor; esta guía lo recorre con `curl`. El [tutorial 6](/tutorials/api) lo hace paso a paso.

## Arrancar y parar

```bash
cv serve                     # http://127.0.0.1:4310/ · imprime la URL con el token de sesión
cv serve --api-only --port 0 # sin página de inicio y en un puerto libre (clientes propios, pruebas)
cv serve --workspace ~/mi-cv # otro espacio de trabajo (por defecto, el directorio actual)
```

Al arrancar verás algo así:

```text
Chameleon CV 1.1.0 · espacio de trabajo /home/ada/mi-cv
API: http://127.0.0.1:4310/api/v1/ (Authorization: Bearer <token>)
Interfaz: http://127.0.0.1:4310/#token=4f6c…e2
Ctrl-C para parar (o POST /api/v1/shutdown)
```

El **token de sesión** es aleatorio, vive lo que el proceso y viaja en el fragmento de la URL (`#token=…`), que el navegador nunca envía al servidor. Toda petición lo lleva en `Authorization: Bearer <token>`; sin él, `401`. Para parar: `Ctrl-C` o `POST /api/v1/shutdown`.

## Hablar con la API

```bash
TOKEN=4f6c…e2
API=http://127.0.0.1:4310/api/v1
curl -s -H "Authorization: Bearer $TOKEN" $API/status | jq .
curl -s -H "Authorization: Bearer $TOKEN" $API/sources
curl -s -H "Authorization: Bearer $TOKEN" $API/sources/experience/acme.md
```

Los ficheros se nombran con **identificadores relativos** al espacio de trabajo (`experience/acme.md`), nunca con rutas del sistema: la API rechaza `..` y las barras invertidas (`400 unsafe-path`). Cada lectura devuelve una huella SHA-256 (`sha256` y cabecera `ETag`); cada escritura la exige en `If-Match` (o `*` para crear), y si alguien cambió el fichero entre medias responde `409 conflict` sin tocar nada:

```bash
curl -s -X PUT -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H 'If-Match: "3b7c…"' -d '{"content":"---\ncompany: ACME\n…"}' $API/sources/experience/acme.md
```

Escribir una fuente por la API es **el usuario escribiendo sus fuentes** (canon C9): ni el servidor ni el co-piloto lo hacen por su cuenta.

Generar el CV es una petición con las mismas opciones que `cv generate-cv` (especialidad, oferta como texto o como fichero del espacio de trabajo, formato, motor, tema, límites); el Markdown vuelve en la respuesta y el PDF se escribe en `output/` y se sirve en `GET /output/{name}`:

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"specialty":"backend","format":"pdf","engine":"typst","offer":{"workspaceFile":"ofertas/acme.txt"},"compact":true}' $API/generate
curl -s -H "Authorization: Bearer $TOKEN" -o cv.pdf $API/output/cv-ada-ejemplo-backend-acme.pdf
```

Los temas de Typst tienen su inventario (`GET /themes`, con autoría y origen de cada uno), la creación a partir de otro (`POST /themes`) y, desde la 1.6.0, la instalación de temas de la comunidad (`POST /themes/install`) y su verificación (`POST /themes/{name}/verify`). Instalar desde una URL `https://` exige arrancar con `cv serve --allow-remote` y consentir en dos pasos: la primera petición responde `409 consent-required` con el `estimateId`, el host y el límite; repetirla con `consent.estimateId` es la confirmación (un solo uso, diez minutos). Un archivo o directorio del espacio de trabajo se instala sin pregunta; `dryRun` devuelve el plan sin escribir.

```bash
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"temas/comunidad.zip","dryRun":true}' $API/themes/install          # el plan: ficheros, tamaños y huellas
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"source":"https://ejemplo.org/temas/comunidad.zip","sha256":"<huella>"}' $API/themes/install   # 409 con estimateId → repetir con {"consent":{"estimateId":"…"}}
curl -s -X POST -H "Authorization: Bearer $TOKEN" $API/themes/comunidad/verify                      # intacto, modificado o sin origen
```

Las **ofertas** (T-8.5) siguen el mismo patrón: `GET /offers` lista `offers/**` con tipo y fecha; `POST /offers/fetch` descarga una oferta por URL `https` —exige `--allow-remote` y el consentimiento en dos pasos con `estimateId` (una sola petición, sin cookies, 2 MiB)— y devuelve el texto extraído con su procedencia (`json-ld`, `json-ld+cuerpo`, `contenido` o `página`) y avisos; `POST /offers` guarda el texto saneado en `offers/` con cabecera de origen (`409` si existe, salvo `replace: true`). Y la **importación de un CV** (T-8.4b) es `POST /import-cv` con el fichero binario como cuerpo (PDF o DOCX, hasta 10 MiB; cabeceras opcionales `x-cv-import-name` y `x-cv-import-replace: 1`): responde `201` con el resumen del borrador y su `README.md`.

```bash
curl -s -H "$AUTH" $API/offers                                      # el listado para el selector de Generar
curl -s -H "$AUTH" -H 'Content-Type: application/json' \
  -d '{"url":"https://empresa.com/oferta"}' $API/offers/fetch        # 409 con estimateId → repetir con {"consent":{"estimateId":"…"}}
curl -s -H "$AUTH" -H 'Content-Type: application/pdf' \
  --data-binary @cv-antiguo.pdf $API/import-cv                       # 201: borrador en import/<nombre>/
```

## El co-piloto como trabajos

`cv improve`, `cv summarize` y `cv suggest tags` tardan lo que tarde el modelo, así que la API los convierte en **trabajos**: `POST /jobs/improve` (o `/jobs/summarize`, `/jobs/suggest-tags`) responde `202` al instante con el identificador del trabajo, la cabecera `Location` y, como hace la CLI antes de enviar nada, **qué va a salir y a dónde** (`sending`: número de fragmentos, palabras, destino). Los trabajos se ejecutan de uno en uno (un solo modelo local) y se siguen de dos maneras:

```bash
JOB=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"specialty":"backend","topN":3,"proposals":2}' $API/jobs/improve | jq -r .job.id)
curl -s -N -H "Authorization: Bearer $TOKEN" $API/jobs/$JOB/events   # eventos en directo (SSE)
curl -s -H "Authorization: Bearer $TOKEN" $API/jobs/$JOB              # o el estado cuando quieras
```

El flujo de eventos (`text/event-stream`) repite al conectar el estado completo del trabajo y después emite `line` por cada línea de progreso —las mismas que la CLI imprime— y `status` en cada cambio, hasta `done`, `failed` o `cancelled`. `DELETE /jobs/{id}` **cancela**: si estaba en cola termina ya; si estaba en marcha, la petición al modelo se aborta y el lote para; no se escribe ninguna revisión. El resultado de `improve` y `summarize` es la revisión escrita en `output/` (nombre, ruta, huella y estadísticas); el de `suggest tags`, las etiquetas de cada fragmento.

Las opciones son las de la CLI (`specialty`, `offer`, `topN`, `only`, `proposals`, `maxLength`, `maxItems`, `redactCompanies`, `locale`, `output`, `cache`, `provider`, `model`), sin rutas: la oferta va como `{ "text": "…" }` o `{ "workspaceFile": "ofertas/acme.txt" }`, y `output` es solo el nombre del fichero dentro de `output/`.

### Refinar un borrador de importación

`POST /jobs/import-map` encola el refinado de un borrador de `import/` con el co-piloto: relee su `README.md`, envía
**solo** las líneas sin situar —seudonimizadas y con un vocabulario cerrado de secciones—, verifica por código cada
propuesta (línea enviada, sección conocida, una por línea) y deja el informe al día. No escribe en `data/sources/` ni
aplica nada. Cuerpo: `{ "name": "<carpeta del borrador>" }` más los campos habituales de proveedor; responde `404` si
el borrador no existe y `400` si no le quedan líneas sin situar. Como el resto de trabajos, un proveedor remoto exige
`--allow-remote` (`403`) y el consentimiento de coste en dos pasos (`409`).

### Permitir los remotos desde la configuración

`PUT /config/serve` guarda la tabla `[serve]` de `cv.toml` (hoy solo `allow_remote`) con el mismo `If-Match` que
`/config/llm`. **No cambia el proceso en marcha**: se lee al arrancar, así que hay que reiniciar `cv serve`. `GET
/config/llm` devuelve `remote: { allowed, configured, pending }` — lo vigente, lo que pide el fichero y si falta
reiniciar.

### Proveedores remotos: `--allow-remote` y consentimiento

Por defecto el servidor **no envía nada fuera de tu máquina**: un trabajo que pida un proveedor remoto (`"provider": "openai"`) recibe `403 remote-disabled`. Si arrancas con `cv serve --allow-remote`, cada trabajo remoto pasa por el mismo puente levadizo que la CLI, en dos pasos:

1. La primera petición responde `409 consent-required` con la estimación de coste (peticiones, tokens de entrada y de salida máximos), el aviso en texto y un `estimateId`.
2. Repites la petición idéntica añadiendo `"consent": { "estimateId": "…" }`: es tu confirmación explícita. Cada `estimateId` vale una sola vez, para la misma tarea y durante diez minutos.

## Revisiones

Las revisiones que el co-piloto deja en `output/` (`revision-*.md`) se listan, se leen con su estructura interpretada (ítems, propuestas, veredictos y marcas `[x]`), se editan con `If-Match` y se aplican:

```bash
curl -s -H "Authorization: Bearer $TOKEN" $API/reviews
curl -s -H "Authorization: Bearer $TOKEN" $API/reviews/revision-improve-2026-08-29-backend.md
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}' \
  $API/reviews/revision-improve-2026-08-29-backend.md/apply                    # solo el plan (dryRun por defecto)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"dryRun":false}' \
  $API/reviews/revision-improve-2026-08-29-backend.md/apply                    # escribe con la versión anterior en el histórico y huella comprobada
```

`apply` es `cv improve apply`: solo lo marcado, cambio mínimo, copia de seguridad previa y, si el original ya no está tal cual en la fuente, no escribe nada (`422` con el detalle). Por defecto solo devuelve el plan; escribir exige `"dryRun": false`.

## En Docker

`compose.serve.yml` publica el puerto **solo en el loopback del anfitrión**; el token aparece en los logs del contenedor:

```bash
docker compose -f compose.yml -f compose.serve.yml up
docker compose logs chameleon-cv | grep Token
```

Con el modelo local de `compose.ai.yml` (que comparte la red de Ollama), usa `compose.serve-ai.yml` en su lugar. Más en [Chameleon CV en Docker](/guide/docker#la-api-desde-el-contenedor).

## Seguridad, en corto

Solo `127.0.0.1`; token de sesión de 256 bits comparado en tiempo constante; `Host` restringido al loopback (contra el *DNS rebinding*) y `Origin` obligatoriamente propio en las escrituras (contra el CSRF); **sin CORS**; cuerpos acotados (1 MiB JSON, 10 MiB PDF); `Cache-Control: no-store`; nunca rutas absolutas ni claves en las respuestas. El análisis completo está en la nota de diseño, [§6 «Modelo de amenazas»](/design/api-headless#_6-seguridad-modelo-de-amenazas-de-un-servidor-local). Si publicas el puerto desde un contenedor, hazlo solo en el loopback; `--allowed-hosts` admite otros valores de `Host` cuando un proxy local lo reescribe.
