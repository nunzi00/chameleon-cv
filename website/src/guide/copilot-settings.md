# Configurar el co-piloto

Desde la versión 1.5.0 el co-piloto se configura en `cv.toml`, se gestiona desde la terminal (claves) y desde la pantalla **Ajustes** de la interfaz web, y admite dos proveedores externos con plan gratuito —Groq y Gemini, los dos ya verificados y seleccionables— sin renunciar a las garantías de siempre: local por defecto, ninguna llamada sin que la pidas, y ningún proveedor que entrene con tus datos sin decírtelo.

## El proveedor local en `cv.toml`

```toml
[llm]
provider = "openai-compatible"        # "ollama" (por defecto) u "openai-compatible"
base_url = "http://127.0.0.1:8080"    # siempre local (loopback)
model = "qwen3:8b"
think = false            # T-8.13: true pide razonamiento a los modelos que lo conmutan (Qwen3, gpt-oss); más lento

[llm.models]                          # opcional: el modelo por defecto de cada proveedor remoto
groq = "openai/gpt-oss-120b"
```

- **Precedencia**, campo a campo: `--provider`/`--model` de la orden > variables `CHAMELEON_LLM_*` > `cv.toml` > valores por defecto. `cv llm status` dice de dónde sale cada valor («orden», «entorno», «cv.toml», «por defecto») y si `cv.toml` existe, tiene la tabla `[llm]` o es inválido; un `cv.toml` inválido no se ignora en silencio: el co-piloto se detiene con el error.
- Un proveedor remoto **nunca** se fija en `cv.toml`: se elige en cada orden (`--provider groq`) o en cada trabajo de la interfaz, con el consentimiento de coste de siempre. `[llm.models]` solo decide qué modelo usar cuando lo elijas.

## Arrancar y parar Ollama desde cv

Si el proveedor local es Ollama, `cv` puede arrancarlo y pararlo por ti (T-8.8), con el modelo configurado:

```sh
cv llm up                         # arranca Ollama y descarga el modelo si falta
cv llm up --model llama3:8b       # otro modelo solo para este arranque
cv llm up --runner docker         # fuerza el runner (native = binario ollama; docker = contenedor)
cv llm up --no-pull               # no descargar el modelo si falta
cv llm down                       # para el Ollama que arrancó cv
cv llm status                     # incluye la línea «runtime: …»
```

Cómo funciona:

- **Runner `native`** (hay `ollama` en el `PATH`, o en `CHAMELEON_OLLAMA_BIN`): `ollama serve` como proceso hijo
  independiente, con `OLLAMA_HOST` derivado de la `base_url` loopback; el registro queda en
  `~/.cache/chameleon-cv/ollama/serve.log` y el pid en `ollama.pid` (permisos 0600).
- **Runner `docker`** (hay Docker): contenedor `chameleon-ollama` con la imagen `ollama/ollama` fijada por digest
  (la misma que `compose.ai.yml`; se cambia con `CHAMELEON_OLLAMA_IMAGE`), puerto publicado solo en `127.0.0.1`
  y volumen `chameleon-ollama` para los modelos. `cv llm down` hace `docker stop`: el contenedor y los modelos se
  conservan, así que el siguiente `up` no vuelve a descargar nada.
- Por defecto se usa `native` si hay `ollama`, si no `docker`; `--runner`, `CHAMELEON_LLM_RUNNER` o la tabla `[llm.runtime]`
  de `cv.toml` lo fuerzan (el entorno manda sobre el fichero). La misma tabla admite `image` para el runner docker:

  ```toml
  [llm.runtime]
  runner = "docker"
  image = "ollama/ollama:0.33.2@sha256:…"
  ```

  En la interfaz web, «Ajustes → Co-piloto local» tiene los dos campos y los guarda con el resto de la tabla `[llm]`.
- **Solo se para lo que arrancó cv.** Si Ollama ya responde pero lo arrancaste tú, `up` no lo toca (solo asegura
  el modelo) y `down` se niega con un mensaje claro.
- La única salida de red es la descarga del modelo desde el registro público de Ollama (la misma que implica
  usar Ollama); no lleva ningún dato tuyo. En la interfaz web, «Ajustes → Ollama local» pide consentimiento antes
  de descargar y sigue la descarga como un trabajo más de Co-piloto.
- Dentro de la imagen Docker del producto (Compose) esta función está deshabilitada: allí Ollama es un servicio
  del propio Compose (`compose.ai.yml`).

Salida: `0` correcto; `1` modelo o runner inválidos; `2` sin runner, Ollama ajeno, arranque, descarga o parada
fallidos. Con `--json` se obtiene el resultado completo (estado, líneas de progreso y, si falla, código y mensaje).

## Las claves de los proveedores remotos

```bash
cv llm key set groq        # la pide sin mostrarla (o la lee de la entrada estándar sin terminal)
cv llm key list            # de dónde sale cada clave: entorno, fichero o ninguna; nunca su valor
cv llm key remove groq
```

También desde **Ajustes → Proveedores externos**, donde cada proveedor tiene su campo «Clave de …» con
«Guardar clave» y «Borrar clave».

Se guardan en `~/.config/chameleon-cv/keys.json` con permisos `0600` (directorio `0700`); una variable
`CHAMELEON_<PROVEEDOR>_API_KEY` tiene prioridad sobre el fichero, y la página te lo dice si guardas una clave que
la variable va a tapar.

Lo que **no** cambia: las claves no se pasan como argumento, no se imprimen y **no se leen nunca**. Al guardarla
desde la web viaja una sola vez, en el cuerpo de la petición, por el `127.0.0.1` del servidor y con el token de
tu sesión; a partir de ahí ninguna respuesta la devuelve —tampoco enmascarada—, el campo se vacía solo y tanto
Ajustes como la API dicen únicamente *si* hay clave y *de dónde* sale. Si prefieres que ni siquiera pase por el
navegador, la terminal sigue estando ahí.

## Proveedores externos y cuotas

Cada proveedor remoto está en un **registro** con su evidencia: la URL, la fecha y la cita literal de la política que declara no entrenar con lo que envías por API. `cv llm status` y Ajustes la enseñan; sin evidencia no hay proveedor.

| Proveedor | Plan | Modelo por defecto | Cuota publicada |
|---|---|---|---|
| `openai` | de pago | `gpt-4o-mini` | según el nivel de la cuenta |
| `anthropic` | de pago | `claude-sonnet-4-5` | según el nivel de la cuenta |
| `groq` | **gratuito** (sin tarjeta) | `openai/gpt-oss-120b` (también `qwen/qwen3.8-27b`, *preview*) | 30 peticiones/min, 1 000/día, 8 000 tokens/min, 200 000 tokens/día (gpt-oss) o 2 000 000 (qwen3.8) (según su documentación a 2026-08-30) |
| `gemini` | **gratuito** | `gemini-3.6-flash` | según el modelo y el nivel; ⚠ **el plan gratuito usa tus peticiones para mejorar los productos de Google** |

**Qué modelo de Groq para cada acción** (`cv llm status` lo muestra; se elige con `--model` o con `[llm.models]`): **mejorar logros y resumir → `openai/gpt-oss-120b`** (calidad en español probada, esquema estricto, caché de prompt; su cuota gratuita da para una sesión al día); **sugerir etiquetas → `qwen/qwen3.8-27b`** (razonamiento desactivable y diez veces más cuota diaria), que también sirve para las otras dos tareas si haces varias sesiones gratuitas al día, con la advertencia de que está en *preview* (Groq puede retirarlo) y de que su español no está medido: si falla, vuelve a `openai/gpt-oss-120b`.

Groq está registrado tras un estudio con evidencia (`docs/copilot-providers.md` en el repositorio) y **quedó verificado y activado el 30/31-ago-2026** con el protocolo de §9 —alta sin método de pago, clave por `cv llm key set`, salud y una prueba funcional **solo con el banco de pruebas**—: su acuerdo de servicio prohíbe entrenar con entradas y salidas y la retención es de 30 días como máximo, desactivable con *Zero Data Retention* en su consola (recomendado).

**Gemini** pasó el mismo protocolo el 31-ago-2026 y también es seleccionable, pero con una diferencia que no se esconde: **su plan gratuito usa tus peticiones para mejorar los productos de Google**. Por eso el aviso aparece antes de cada envío, en la CLI y en el diálogo de coste de la web. Si eso no te vale, usa Groq o el modelo local. Los planes gratuitos de otros proveedores conocidos se descartaron porque permiten entrenar con los datos enviados sin decirlo con esta claridad.

**Cuota agotada: se espera lo que el proveedor pida, y se puede cancelar.** Un 429 con `retry-after` ya no
detiene la tanda a la primera: se espera lo que él diga y se reintenta hasta dos veces, contándolo por pantalla
(«cuota agotada: espero 15 s y reintento (1/2) · cancela para no esperar»). Tres límites, porque esperar sin
freno es peor que no esperar: solo se espera **si el proveedor dice cuánto**, nunca **más de 120 s** —una cuota
diaria no se aguarda— y como mucho **dos veces**. La espera es cancelable: el botón «Cancelar» del trabajo en la
web y `Ctrl-C` en la terminal la cortan en el acto. `--no-wait-quota` vuelve al comportamiento anterior, que es
lo que suele querer un script.

**Cuota visible, sin telemetría.** Además de los límites publicados, el producto lee las cabeceras de cuota que el proveedor devuelve en las llamadas que tú ya pediste (`x-ratelimit-*`, `retry-after`) y las enseña —al terminar un trabajo remoto, en `cv llm status` y en Ajustes— sin hacer ninguna llamada extra ni guardarlas en disco. Si el proveedor responde 429 (cuota agotada), la orden se detiene con `quota-exceeded` y el tiempo de espera que él indique; nunca se reintenta por su cuenta.

```bash
cv improve --provider groq -n 1
# …
# Cuota según groq: quedan 28/30 peticiones (se renueva en 12 s)
```

## La pantalla Ajustes

![Pantalla Ajustes: proveedor local y modelo con su origen, y los proveedores externos con clave, cuota y evidencia](/gui/ajustes.png)

- **Co-piloto local**: proveedor, URL base (solo loopback) y modelo, con el origen de cada valor efectivo; lo que fija el entorno aparece en solo lectura. **Guardar en cv.toml** escribe únicamente la tabla `[llm]` (el resto del fichero no cambia) con control de concurrencia; **Comprobar** hace una única llamada de salud al proveedor y lista sus modelos.
- **Proveedores externos**: plan, host, modelo por defecto, si hay clave y dónde, cuota publicada (con fuente y fecha), cuota viva si la hay y la evidencia. **Comprobar** solo se activa con clave y con un servidor que permita remotos; es una llamada explícita sin datos tuyos.
- **Permitir o prohibir los remotos** (desde la 1.10.0): el botón de esa misma ficha guarda `[serve] allow_remote` en `cv.toml` y **se aplica al reiniciar** `cv serve`. Es deliberado: un servidor arrancado sin permiso de salida no puede concedérselo a sí mismo desde su propia interfaz. La bandera de la orden manda siempre sobre el fichero, en los dos sentidos (`--allow-remote` lo permite aunque el fichero lo prohíba; `--no-allow-remote` lo prohíbe aunque el fichero lo permita). Mientras el fichero pida algo distinto de lo vigente, la página lo avisa.
- En **Co-piloto**, el selector de proveedor ofrece el local y los remotos utilizables (con clave y remotos permitidos); el modelo se rellena con el del proveedor elegido.

La API expone lo mismo: `GET /api/v1/config/llm`, `PUT /api/v1/config/llm` (con `If-Match`) y `POST /api/v1/config/llm/check` (ver la [referencia de la API](/reference/api)).
