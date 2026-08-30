# Arrancar y parar Ollama desde Chameleon CV (T-8.8) — PROPUESTA v1

Estado: **APROBADA por el PO (D1–D8) e IMPLEMENTADA el 2026-08-30** · Encargo del Director

Desviaciones respecto a la propuesta, decididas en la implementación:

- ~~El runner y la imagen se fuerzan solo con `--runner` / `CHAMELEON_LLM_RUNNER` y `CHAMELEON_OLLAMA_IMAGE`~~
  **Resuelto en S3 de T-8.6 (2026-08-30):** `[llm.runtime]` (`runner`, `image`) existe en `cv.toml` (D1/D2); el entorno
  y `--runner` mandan sobre el fichero; «Ajustes» muestra y guarda los dos campos y conserva `[llm.models]` al
  guardar (la API expone la tabla leída en `llm.settings.values`).
- Códigos de salida según la convención de la CLI (0 correcto, 1 datos inválidos, 2 fallo), no los 3/4/5 de §6.
- `POST /api/v1/llm/runtime` con `action: "up"` responde 202 con el trabajo `ollama-up` (progreso por SSE);
  `down` responde 200 con el estado y las líneas; los fallos usan los códigos del servidor (`invalid-data` 422,
  `conflict` 409 para un Ollama ajeno, `environment` 503 para el resto).
- Verificación: unidad (núcleo y adaptador de Node con procesos reales), rutas del servidor, CLI, GUI y arnés de
  aceptación con un doble de `ollama` (`tests/acceptance/bench/tools/ollama`); la prueba con Docker y Ollama
  reales es manual (pendiente de evidencia en la máquina del Director).

## §0 Encargo

Director, 2026-08-30: «añade una opción para arrancar ollama local con el modelo seleccionado, y también otra para
pararlo». Contexto: durante las pruebas con su espacio de trabajo real, el Director arrancó Ollama con Docker a mano
(`compose.workspace.yml`) para probar el co-piloto y lo paró después; la aplicación solo sabía **comprobar** si respondía.

## §1 Problema

El co-piloto local exige que Ollama ya esté en marcha y sirva el modelo configurado. Hoy `cv llm status` y «Ajustes →
Comprobar» lo detectan, pero la solución («arranca Ollama en otra terminal y descarga el modelo») queda fuera del
producto. Para un usuario nuevo es el primer muro del co-piloto (objetivo medible del rediseño: generar y mejorar sin
abrir la documentación).

## §2 Alcance

- **CLI:** `cv llm up [--model <nombre>] [--runner native|docker] [--no-pull]` y `cv llm down`; `cv llm status`
  muestra además el runtime (quién lo arrancó, con qué runner, si el modelo está presente).
- **API local:** `GET /api/v1/llm/runtime` (estado) y `POST /api/v1/llm/runtime` con `{ action: 'up' | 'down', model? }`.
- **GUI:** en Ajustes → tarjeta «Proveedor local»: línea de estado y botones «Arrancar Ollama con `<modelo>`» y
  «Parar Ollama»; la descarga del modelo se sigue como trabajo en Co-piloto; los chips de la cabecera se refrescan.

Fuera de alcance: instalar Ollama o Docker; gestionar proveedores `openai-compatible` (llama-server, LM Studio…);
modelos remotos; elegir GPU o parámetros de Ollama.

## §3 Runners

Se detecta en este orden y se puede fijar con `[llm.runtime] runner = "native" | "docker"` en `cv.toml` o `--runner`:

| Runner | Arrancar | Modelo | Parar | Huella de «lo arrancó cv» |
| --- | --- | --- | --- | --- |
| `native` (hay `ollama` en el PATH) | `ollama serve` como proceso hijo desprendido, `OLLAMA_HOST` derivado de la `baseUrl` (loopback), salida a `~/.cache/chameleon-cv/ollama/serve.log` | `ollama pull <modelo>` si `/api/tags` no lo lista | señal `SIGTERM` al pid guardado | `~/.cache/chameleon-cv/ollama/ollama.pid` (0600) |
| `docker` (hay `docker` y el demonio responde) | `docker run -d --name chameleon-ollama -p 127.0.0.1:<puerto>:11434 -v chameleon-ollama:/root/.ollama <imagen fijada por digest>`; si el contenedor existe, `docker start` | `docker exec chameleon-ollama ollama pull <modelo>` | `docker stop chameleon-ollama` (contenedor y volumen se conservan: los modelos no se vuelven a descargar) | el nombre del contenedor |
| ninguno | error 3: «no hay `ollama` ni Docker; instala uno de los dos» | — | — | — |

Si Ollama ya responde en la `baseUrl` y no lo arrancó cv (sin pid propio ni contenedor propio), `up` no hace nada
más que asegurar el modelo, y `down` se niega con un mensaje claro: **solo se para lo que arrancó cv**.

Dentro del contenedor `chameleon-cv` de Compose, Ollama es un servicio del propio Compose (`compose.ai.yml`): el
runtime queda deshabilitado con el mensaje «gestiona Ollama con `docker compose`».

## §4 Seguridad

- Sin shell: `execFile`/`spawn` con argumentos fijos (mismo patrón que `typst` y `openBrowser`). El único dato del
  usuario que entra en un argumento es el nombre del modelo, validado con `^[a-z0-9][a-z0-9._-]*(/[a-z0-9][a-z0-9._-]*)?(:[a-z0-9._-]+)?$`
  (máx. 128 caracteres); host y puerto salen solo de la `baseUrl`, que el producto ya obliga a ser loopback (canon C3).
- La API va con el token de sesión y las mismas protecciones de origen que el resto de escrituras.
- La única salida de red es la descarga del modelo desde el registro público de Ollama (o de la imagen, en Docker):
  es la misma que ya implica usar Ollama y **no lleva datos del usuario**. La GUI lo dice antes de descargar
  (consentimiento con nombre del modelo y aviso de tamaño: «varios GB, puede tardar minutos»); en la CLI, `--no-pull`
  lo evita.
- Nunca se mata un proceso o contenedor que no arrancó cv; nunca se ejecuta con privilegios.

## §5 Estado observable

`GET /api/v1/llm/runtime`:

```json
{ "runner": "docker", "managed": true, "running": true,
  "model": { "name": "qwen3:8b", "present": true },
  "pull": { "status": "running", "percent": 42, "message": "pulling 8934d96d3f08" },
  "log": "/home/ana/.cache/chameleon-cv/ollama/serve.log" }
```

La descarga del modelo es un trabajo del gestor existente (`kind: 'pull-model'`), seguible por SSE como los demás.

## §6 CLI

```
cv llm up                       # runner detectado, modelo de la configuración, descarga si falta
cv llm up --model qwen2.5:7b    # cambia el modelo solo para este arranque
cv llm up --runner docker --no-pull
cv llm down
```

Salida humana y `--json` (`{ runner, managed, running, model, pull }`); códigos: 0 correcto, 3 sin runner,
4 «no lo arrancó cv», 5 descarga fallida.

## §7 GUI (Ajustes → Proveedor local)

- Línea de estado con chip: «Ollama en marcha (docker) · modelo `qwen3:8b` presente» /
  «Ollama parado · runner docker disponible» / «Ollama en marcha (no lo arrancó cv)».
- «Arrancar Ollama con `<modelo>`» deshabilitado si no hay runner (con el motivo). Si falta el modelo, diálogo
  de consentimiento; el progreso aparece en la lista de trabajos de Co-piloto y en la propia tarjeta.
- «Parar Ollama» solo si `managed`; confirmación de una línea.
- Al terminar, la cabecera de contexto refresca sus chips (co-piloto en verde).

## §8 Pruebas (100 % de la lógica)

- Unidad: runners con dobles de `spawn`/`execFile` y de `fetch` (`/api/tags`, salud); validación del modelo;
  pid/contenedor; negativas (ajeno, sin runner, dentro de Compose); trabajo `pull-model` con progreso.
- Arnés de aceptación: un `ollama` falso en el PATH del escenario (script que responde a `serve`/`pull`/`list`) →
  `up`, `status`, `down` deterministas; `docker` ausente → runner `native`.
- GUI: Vitest de la tarjeta y del diálogo; E2E con el doble del proveedor y un `ollama` falso.
- Docker real: verificación manual en la máquina del Director (evidencia en el informe de cierre), no en CI.

## §9 Documentación

Guía `copilot-settings.md` (sección «Arrancar Ollama desde cv»), `docker.md` (nota sobre el runtime deshabilitado
en Compose), referencia de la CLI generada, `README.md`, `CHANGELOG.md`.

## §10 Versión

1.8.0 (funcionalidad nueva), junto con T-8.5 si el corpus llega a tiempo; si no, 1.8.0 con T-8.8 sola.

## §11 Decisiones que se piden al PO

1. **D1 runner por defecto:** `native` si hay `ollama`, si no `docker`; error si no hay ninguno.
2. **D2 imagen Docker:** `ollama/ollama` con etiqueta fijada por digest en el registro del producto y actualizable
   con `[llm.runtime] image`.
3. **D3 parada en Docker:** `docker stop` conservando contenedor y volumen (los modelos no se vuelven a descargar).
4. **D4 descarga del modelo:** automática en `up`, con consentimiento en la GUI y `--no-pull` en la CLI.
5. **D5 nunca parar un Ollama ajeno** (sin pid ni contenedor propios).
6. **D6 dentro del contenedor de Compose** la función queda deshabilitada con mensaje.
7. **D7 pid y log** en `~/.cache/chameleon-cv/ollama/` (0600), no en el espacio de trabajo.
8. **D8 versión** 1.8.0.

## Ampliación T-8.13: catálogo, espejo de Hugging Face y razonamiento

- `cv llm models [--json]` (y `GET /api/v1/llm/models`) lista el catálogo `LOCAL_MODELS` con lo descargado; `cv llm up --model <id>` descarga del registro de Ollama y, si falla y el modelo tiene espejo (`hf.co/<repositorio>:<cuantización>`), descarga el espejo y crea el alias corto con `ollama cp`; `--source huggingface` va directo al espejo. Solo cambia el host al que se conecta el propio Ollama (`registry.ollama.ai` o `huggingface.co`); cv sigue sin descargar nada por su cuenta.
- El modelo por defecto es `qwen3:8b` (docs/qwen3-evaluation.md §4); `[llm] think = true` pide razonamiento a los modelos que lo conmutan.
