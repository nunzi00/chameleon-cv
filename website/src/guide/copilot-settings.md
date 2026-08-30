# Configurar el co-piloto

Desde la versión 1.5.0 el co-piloto se configura en `cv.toml`, se gestiona desde la terminal (claves) y desde la pantalla **Ajustes** de la interfaz web, y está preparado para usar un proveedor externo con plan gratuito —Groq, pendiente de verificación humana y por ahora no seleccionable— sin renunciar a las garantías de siempre: local por defecto, ninguna llamada sin que la pidas, y ningún proveedor que entrene con tus datos.

## El proveedor local en `cv.toml`

```toml
[llm]
provider = "openai-compatible"        # "ollama" (por defecto) u "openai-compatible"
base_url = "http://127.0.0.1:8080"    # siempre local (loopback)
model = "qwen2.5:7b-instruct"

[llm.models]                          # opcional: el modelo por defecto de cada proveedor remoto
groq = "openai/gpt-oss-120b"
```

- **Precedencia**, campo a campo: `--provider`/`--model` de la orden > variables `CHAMELEON_LLM_*` > `cv.toml` > valores por defecto. `cv llm status` dice de dónde sale cada valor («orden», «entorno», «cv.toml», «por defecto») y si `cv.toml` existe, tiene la tabla `[llm]` o es inválido; un `cv.toml` inválido no se ignora en silencio: el co-piloto se detiene con el error.
- Un proveedor remoto **nunca** se fija en `cv.toml`: se elige en cada orden (`--provider groq`) o en cada trabajo de la interfaz, con el consentimiento de coste de siempre. `[llm.models]` solo decide qué modelo usar cuando lo elijas.

## Las claves de los proveedores remotos

```bash
cv llm key set groq        # la pide sin mostrarla (o la lee de la entrada estándar sin terminal)
cv llm key list            # de dónde sale cada clave: entorno, fichero o ninguna; nunca su valor
cv llm key remove groq
```

Se guardan en `~/.config/chameleon-cv/keys.json` con permisos `0600` (directorio `0700`); una variable `CHAMELEON_<PROVEEDOR>_API_KEY` tiene prioridad. Las claves no se pasan como argumento, no se imprimen, no viajan por HTTP y no se escriben desde la interfaz web: la pantalla Ajustes solo sabe *si* hay clave y *dónde*.

## Proveedores externos y cuotas

Cada proveedor remoto está en un **registro** con su evidencia: la URL, la fecha y la cita literal de la política que declara no entrenar con lo que envías por API. `cv llm status` y Ajustes la enseñan; sin evidencia no hay proveedor.

| Proveedor | Plan | Modelo por defecto | Cuota publicada |
|---|---|---|---|
| `openai` | de pago | `gpt-4o-mini` | según el nivel de la cuenta |
| `anthropic` | de pago | `claude-sonnet-4-5` | según el nivel de la cuenta |
| `groq` | **gratuito** (sin tarjeta) — **pendiente de verificación humana, no seleccionable todavía** | `openai/gpt-oss-120b` (también `qwen/qwen3.8-27b`, *preview*) | 30 peticiones/min, 1 000/día, 8 000 tokens/min, 200 000 tokens/día (gpt-oss) o 2 000 000 (qwen3.8) (según su documentación a 2026-08-30) |

**Qué modelo de Groq para cada acción** (`cv llm status` lo muestra; se elige con `--model` o con `[llm.models]`): **mejorar logros y resumir → `openai/gpt-oss-120b`** (calidad en español probada, esquema estricto, caché de prompt; su cuota gratuita da para una sesión al día); **sugerir etiquetas → `qwen/qwen3.8-27b`** (razonamiento desactivable y diez veces más cuota diaria), que también sirve para las otras dos tareas si haces varias sesiones gratuitas al día, con la advertencia de que está en *preview* (Groq puede retirarlo) y de que su español no está medido: si falla, vuelve a `openai/gpt-oss-120b`.

Groq está registrado tras un estudio con evidencia (`docs/copilot-providers.md` en el repositorio) y **quedará disponible cuando una persona complete el protocolo de verificación al alta** (§9 de esa nota); hasta entonces `cv llm status` y Ajustes lo muestran como pendiente y `--provider groq` se rechaza: su acuerdo de servicio prohíbe entrenar con entradas y salidas y la retención es de 30 días como máximo, desactivable con *Zero Data Retention* en su consola (recomendado). Los planes gratuitos de otros proveedores conocidos se descartaron porque permiten entrenar con los datos enviados.

**Cuota visible, sin telemetría.** Además de los límites publicados, el producto lee las cabeceras de cuota que el proveedor devuelve en las llamadas que tú ya pediste (`x-ratelimit-*`, `retry-after`) y las enseña —al terminar un trabajo remoto, en `cv llm status` y en Ajustes— sin hacer ninguna llamada extra ni guardarlas en disco. Si el proveedor responde 429 (cuota agotada), la orden se detiene con `quota-exceeded` y el tiempo de espera que él indique; nunca se reintenta por su cuenta.

```bash
cv improve --provider groq -n 1
# …
# Cuota según groq: quedan 28/30 peticiones (se renueva en 12 s)
```

## La pantalla Ajustes

![Pantalla Ajustes: proveedor local y modelo con su origen, y los proveedores externos con clave, cuota y evidencia](/gui/ajustes.png)

- **Co-piloto local**: proveedor, URL base (solo loopback) y modelo, con el origen de cada valor efectivo; lo que fija el entorno aparece en solo lectura. **Guardar en cv.toml** escribe únicamente la tabla `[llm]` (el resto del fichero no cambia) con control de concurrencia; **Comprobar** hace una única llamada de salud al proveedor y lista sus modelos.
- **Proveedores externos**: plan, host, modelo por defecto, si hay clave y dónde, cuota publicada (con fuente y fecha), cuota viva si la hay y la evidencia. **Comprobar** solo se activa con clave y con un servidor arrancado con `cv serve --allow-remote`; es una llamada explícita sin datos tuyos.
- En **Co-piloto**, el selector de proveedor ofrece el local y los remotos utilizables (con clave y remotos permitidos); el modelo se rellena con el del proveedor elegido.

La API expone lo mismo: `GET /api/v1/config/llm`, `PUT /api/v1/config/llm` (con `If-Match`) y `POST /api/v1/config/llm/check` (ver la [referencia de la API](/reference/api)).
