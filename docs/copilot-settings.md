# Configuración avanzada del co-piloto: `cv.toml`, claves, proveedores externos y la pantalla «Ajustes»

| | |
|---|---|
| **Tarea** | T-8.2 · [IA] Configuración avanzada del co-piloto (Hito 8) |
| **Estado** | PROPUESTA v1 (2026-08-30) **APROBADA en su totalidad** por el Director de Ingeniería y Producto el 2026-08-30 (diez decisiones de §10); **ENTREGADA** el 2026-08-30 (S1, S2 y S3 en §11); decisión 3: **solo Groq**; v1.5.0 preparada, **etiquetado condicionado a la verificación al alta de Groq por una persona** (`docs/copilot-providers.md` §9) |
| **Autor** | Claude (Director Técnico) |
| **Base** | `docs/llm-integration.md` (§3 cánones C3, C7, C11; §4.3 local frente a API; §5 claves y red); `src/llm/config.ts`, `keys.ts`, `status.ts`, `estimate.ts` (selección, claves, salud y estimación de hoy); `src/themes/project-config.ts` (`cv.toml`, solo temas); `src/serve/consent.ts` y `docs/api-headless.md` (`remote-disabled`, `consent-required`); `docs/gui-mvp.md` (la GUI como cliente de la API); nota del Director en `ROADMAP.md` (T-8.2) |

## 0. Resumen ejecutivo

- **Hoy** el co-piloto se configura solo con variables de entorno `CHAMELEON_LLM_*` (proveedor local `ollama` o `openai-compatible`, URL en loopback y modelo), las claves de los dos remotos aprobados (`openai`, `anthropic`) viven en `CHAMELEON_<PROVEEDOR>_API_KEY` o en `~/.config/chameleon-cv/keys.json` (0600, nunca por HTTP), `cv.toml` solo conoce `[theme]`, y la GUI muestra un semáforo del proveedor local sin ninguna acción.
- **Propuesta**: (1) una tabla `[llm]` en `cv.toml` para el proveedor **local** y el modelo, con precedencia clara (`--provider/--model` > entorno > `cv.toml` > valor por defecto) y **sin** poder fijar un remoto como valor por defecto (C3); (2) un **registro de proveedores** (`src/llm/registry.ts`) que describe cada remoto con su API, su host, su modelo por defecto, sus **cuotas publicadas** y la **evidencia de C7** (URL, fecha y cita de la política «sin entrenamiento ni retención»), del que salen la lista blanca de hosts, `cv llm status` y la GUI; (3) **uno o dos proveedores externos con plan gratuito**, elegidos tras un *spike* de medio sprint que comprueba sus condiciones contra C7 y las registra como evidencia (no se añade ninguno sin ella); (4) **cuotas visibles**: los límites publicados (estáticos, con fuente y fecha) y los que el propio proveedor devuelve en las cabeceras de cada respuesta (`x-ratelimit-*`, `retry-after`), guardados solo en memoria del proceso —**nunca hay llamadas en segundo plano ni telemetría**—; (5) `cv llm key set|remove|list` para gestionar las claves desde la terminal (la clave entra por la entrada estándar o por pregunta interactiva, nunca por argumento; se escribe en `keys.json` con 0600) —**las claves siguen sin pasar por HTTP ni por la GUI**—; (6) rutas `GET /config/llm` y `PUT /config/llm` (con `If-Match`) y la pantalla **«Ajustes»** de la GUI: proveedor local y modelo editables y guardados en `cv.toml`, panel de proveedores externos con presencia de clave, cuotas y botón «Comprobar» (cada clic es un consentimiento explícito a esa única llamada), y el estado de `--allow-remote` (solo informativo: una página no amplía sus propios permisos de red).
- Versión **1.5.0**; tres sprints (spike + `cv.toml` + claves; registro + cuotas + API; GUI + guía).

## 1. Objetivo y alcance

**Objetivo.** Que el usuario configure el co-piloto sin variables de entorno —en el fichero de proyecto que ya existe y desde la GUI—, que pueda usar uno o dos proveedores externos gratuitos **sin renunciar a C7** y **sabiendo cuánto le queda de cuota**, y que las claves sigan siendo suyas: nunca viajan por HTTP, nunca se imprimen, nunca salen de su máquina salvo hacia el proveedor que él eligió.

**Dentro**: `[llm]` en `cv.toml` con precedencia documentada; registro de proveedores con evidencia C7 y cuotas; *spike* de candidatos gratuitos con informe; captura de cabeceras de cuota; `cv llm status` ampliado (origen de cada valor, presencia de claves, cuotas); `cv llm key set|remove|list`; `GET/PUT /config/llm`; pantalla «Ajustes»; selectores de proveedor/modelo en Co-piloto alimentados por el registro; guía «Configurar el co-piloto»; CHANGELOG y 1.5.0.

**Fuera** (y por qué): introducir claves desde la GUI (§7: un formulario en el navegador que recibe secretos y los escribe en disco amplía el modelo de amenazas; la CLI ya lo hace con 0600 y sin argumentos); fijar un proveedor remoto como valor por defecto en `cv.toml` (C3: remoto solo con `--provider` explícito en cada orden o, en la GUI, eligiéndolo en cada trabajo con su consentimiento de coste); activar `--allow-remote` desde la GUI (es un flag del proceso servidor, decisión del usuario al arrancar); una tabla de precios en euros (los proveedores la cambian sin aviso; se muestran cuotas —peticiones y tokens— y el aviso de coste de siempre, no tarifas); proveedores cuyo plan gratuito permite entrenar con los datos enviados (C7 los excluye aunque sean gratis); *proxies* multi-proveedor con políticas de datos variables (misma razón); cifrado de `keys.json` con contraseña (fuera de alcance; 0600 sigue siendo el mecanismo, documentado).

## 2. Situación de partida

- **Configuración**: `src/llm/config.ts` — `CHAMELEON_LLM_PROVIDER/BASE_URL/MODEL` (solo local, loopback obligatorio), `CHAMELEON_LLM_ALLOWED_HOSTS`, `CHAMELEON_OPENAI_BASE_URL`, `CHAMELEON_ANTHROPIC_BASE_URL`; por defecto `ollama` en `http://127.0.0.1:11434` con `qwen3:8b`; `selectProvider` rechaza un remoto por configuración y exige `--provider openai|anthropic` explícito, clave y host en la lista blanca (`DEFAULT_ALLOWED_HOSTS`).
- **Claves**: `src/llm/keys.ts` — `CHAMELEON_<PROVEEDOR>_API_KEY` o `keys.json` (zod estricto, 0600 exigido en cada lectura; `KeyPresence`: `env | file | none | insecure-file | invalid-file`); la API HTTP no acepta claves en ningún cuerpo; la GUI no las conoce.
- **Consentimiento y coste** (C11): `estimate.ts` (≈ 4 caracteres por token, `formatCostWarning`), CLI `s/N` o `--yes`, API en dos pasos (`consent-required` con `estimateId` de un solo uso, TTL 10 min), `cv serve --allow-remote` como puerta.
- **`cv.toml`**: `src/themes/project-config.ts` — `smol-toml`, `z.strictObject({ theme? })`: cualquier tabla nueva exige ampliar el esquema.
- **Estado y GUI**: `GET /status` expone `llm` (`config`, `configError`, `health`, `keys`, `keysFile`, `allowedHosts`, `remote`, `usable`); la GUI lo reduce a un semáforo; Co-piloto ofrece «Proveedor» y «Modelo» como texto libre por trabajo, sin selector ni validación.
- **Pruebas**: `tests/llm/*` (config, salud, remotos, claves, lista blanca), `tests/cli/llm-cli.test.ts`, `remote-cli.test.ts`; arnés de IA solo con proveedor local real (llama-server + Qwen2.5-7B); ninguna clave llega nunca al arnés.
- **Sin precedentes** de proveedores gratuitos, cuotas ni pantalla de ajustes en el repositorio: terreno nuevo.

## 3. Principios de diseño

1. **Local por defecto, siempre** (C3). `cv.toml` solo puede elegir el proveedor local y su modelo; un remoto se elige en cada orden o en cada trabajo, con su consentimiento de coste de siempre.
2. **Ningún proveedor sin evidencia** (C7). Un remoto entra en el registro con la URL, la fecha y la cita de su política que declara no entrenar ni retener con los datos enviados por API; si la política cambia, se retira con un cambio de datos y una entrada en el CHANGELOG. Gratis no es criterio suficiente.
3. **Las claves no viajan** (C11, §5 de `llm-integration.md`). Entran por la terminal (entrada estándar o pregunta), se guardan con 0600, nunca en argumentos, logs, caché, HTTP ni GUI; la GUI solo sabe *si* hay clave y *dónde*.
4. **Cuota visible, sin telemetría.** Lo que se enseña es lo que el proveedor publica y lo que devuelve en las cabeceras de las llamadas que el usuario ya pidió; ninguna llamada nace de la configuración, del arranque ni de un temporizador.
5. **Precedencia explícita y observable.** Cada valor efectivo sabe de dónde viene (`--provider`, entorno, `cv.toml`, valor por defecto) y `cv llm status` y «Ajustes» lo dicen.
6. **El núcleo es el producto** (C14). Registro, precedencia, lectura y escritura de `cv.toml`, claves y cuotas viven en `src/llm` y `src/app`; la CLI, la API y la GUI los muestran.

## 4. Diseño

### 4.1 `cv.toml`: la tabla `[llm]`

```toml
[llm]
provider = "openai-compatible"        # solo local: "ollama" | "openai-compatible"
base_url = "http://127.0.0.1:8080"    # loopback obligatorio (como CHAMELEON_LLM_BASE_URL)
model = "qwen3:8b"
think = false            # T-8.13: true pide razonamiento a los modelos que lo conmutan (Qwen3, gpt-oss); más lento. Las tareas con esquema JSON (todas las del co-piloto) lo ignoran
context = 16384          # ventana de contexto (num_ctx) pedida a Ollama; sin ella Ollama usa 4096 y los prompts largos fallan con HTTP 400

[llm.models]                          # opcional: modelo por defecto por proveedor remoto (no lo selecciona)
openai = "gpt-4o-mini"
anthropic = "claude-sonnet-4-5"
```

- `ProjectConfigSchema` gana `llm?: LlmConfigSchema` (zod estricto, mensajes en castellano; `provider` limitado a los ids locales; `base_url` validada con `isLoopbackUrl`; `models` con claves limitadas a los ids del registro).
- **Precedencia** (`src/llm/config.ts::resolveLlmConfig`): `--provider`/`--model` de la orden > `CHAMELEON_LLM_*` > `[llm]` de `cv.toml` > valores por defecto. Cada campo del resultado lleva su `source: 'flag' | 'env' | 'file' | 'default'`. El entorno sigue mandando sobre el fichero para que la CI y el arnés no dependan del espacio de trabajo.
- **Lectura**: `loadProjectConfig` ya se invoca para los temas; se comparte (una lectura, un error común `Configuración inválida (cv.toml)` con las líneas de zod).
- **Escritura** (solo desde `PUT /config/llm`, §4.5): sustitución quirúrgica de la tabla `[llm]` (y `[llm.models]`) en el texto existente —el resto del fichero, comentarios incluidos, queda byte a byte—; si no existe, se añade al final; si no hay `cv.toml`, se crea con 0600. Regla de las marcas de las revisiones aplicada a la configuración.

### 4.2 El registro de proveedores

`src/llm/registry.ts`: datos, no código, para cada proveedor:

| Campo | Contenido |
|---|---|
| `id`, `kind` | `ollama`, `openai-compatible` (locales); `openai`, `anthropic` y los aprobados en §4.3 (remotos) |
| `api` | `openai-chat` (cliente OpenAI-compatible ya existente) o `anthropic-messages` |
| `host`, `baseUrl`, `defaultModel` | lista blanca (`allowedHosts` se deriva de aquí), URL y modelo por defecto |
| `keyEnv`, `keyName` | `CHAMELEON_<ID>_API_KEY` y la clave de `keys.json` |
| `plan` | `free` (plan gratuito sin tarjeta), `paid` |
| `quota` | límites publicados: peticiones/min, peticiones/día, tokens/min por modelo si el proveedor los publica; `sourceUrl`, `verifiedAt` |
| `c7` | `sourceUrl`, `verifiedAt`, `quote` (la frase literal de la política) |
| `rateLimitHeaders` | qué cabeceras devuelve (`x-ratelimit-remaining-requests`, `-tokens`, `retry-after`…) |

`REMOTE_PROVIDER_IDS`, `DEFAULT_ALLOWED_HOSTS` y los modelos por defecto pasan a leerse del registro; `keys.json` admite las claves de todos los remotos registrados (el esquema estricto se deriva del registro). Añadir un proveedor con la misma API es añadir una entrada con su evidencia y sus pruebas de contrato.

### 4.3 Proveedores externos con plan gratuito: el *spike* y sus criterios

Medio sprint (S1) para **verificar, no suponer**. Criterios, todos obligatorios: (a) **C7**: la política vigente declara que los datos enviados por API no se usan para entrenar ni se retienen más allá de lo operativo, también en el plan gratuito (se registra URL, fecha y cita); (b) **plan gratuito sin tarjeta** y con límites publicados (para poder enseñarlos); (c) **API compatible con OpenAI** (reutiliza el cliente y las pruebas de contrato) o, si no, coste de integración acotado; (d) **HTTPS con host fijo** para la lista blanca; (e) salida JSON estructurada utilizable por el verificador C2/C6 (probado con el arnés de IA contra el proveedor real, una vez, con una cuenta del Director Técnico y datos del banco de pruebas —nunca datos reales—).

Candidatos que examinaré, **con mi impresión previa marcada como no verificada**: Groq (API OpenAI-compatible, plan gratuito con límites publicados por modelo; creo que declara no entrenar con datos de clientes: por confirmar), GitHub Models (gratuito con cuenta de GitHub, límites publicados; creo que declara no usar los datos para entrenar: por confirmar), Cerebras (OpenAI-compatible, plan gratuito; política por confirmar). Con expectativa de **exclusión** por C7: Google Gemini (mi entendimiento es que el plan gratuito permite usar los datos para mejorar los modelos) y el plan gratuito de Mistral (misma sospecha); y por diseño: OpenRouter y otros agregadores (políticas de datos que dependen del destino). El informe del *spike* (`docs/copilot-providers.md`, C15) recoge la tabla de evidencia y propone **uno o dos**; el Director decide cuáles entran (decisión 3). Si ninguno pasa, T-8.2 entrega igualmente el registro, `cv.toml`, las claves y «Ajustes» con los dos remotos actuales, y lo dice.

### 4.4 Cuotas visibles y salud

- **Publicadas**: el registro (`quota`) se muestra en `cv llm status --provider <id>` y en «Ajustes» con su fuente y fecha («según la documentación del proveedor a 2026-09-…»).
- **Vivas**: `createRemoteHttp` captura, en cada respuesta que el usuario ya pidió (trabajos, «Comprobar»), las cabeceras de límite (`x-ratelimit-limit-*`, `x-ratelimit-remaining-*`, `x-ratelimit-reset-*`, `retry-after`) y las guarda en un `QuotaLedger` en memoria del proceso (`src/llm/quota.ts`): último valor, momento de la lectura, modelo. `cv serve` lo expone en `GET /config/llm` y `GET /status`; la CLI lo imprime al final de un trabajo remoto («Cuota restante según el proveedor: 28/30 peticiones por minuto, se renueva en 12 s»). Sin persistencia, sin llamadas propias: cero telemetría.
- **Agotamiento**: un 429 se traduce a un error tipificado `quota-exceeded` (CLI código 2, API 429 con `retryAfter`), sin reintentos automáticos (C11: los reintentos gastan cuota del usuario sin preguntarle).
- **Salud**: `cv llm status --provider <remoto>` y el botón «Comprobar» hacen una única llamada a `GET /v1/models` (o el equivalente) —sin datos del usuario— y, si el proveedor lo devuelve, listan los modelos disponibles; la lista se cachea en memoria de la sesión para los selectores.

### 4.5 CLI y API

- `cv llm status`: añade el **origen** de cada valor efectivo (`proveedor: openai-compatible (cv.toml)`, `modelo: … (entorno)`), la presencia de clave de **todos** los remotos del registro, sus planes y cuotas publicadas, y las cuotas vivas si las hay.
- `cv llm key set <proveedor>` (lee la clave de la entrada estándar si no es un TTY, o pregunta sin eco si lo es; valida el id contra el registro; escribe `keys.json` con 0600 creando el directorio con 0700; nunca acepta la clave como argumento y nunca la imprime), `cv llm key remove <proveedor>`, `cv llm key list` (presencias, nunca valores). Los errores de permisos siguen mandando al `chmod 600`.
- `GET /api/v1/config/llm` → `{ effective: { provider, baseUrl, model, sources }, file: { present, sha256, llm }, providers: [{ id, kind, plan, host, defaultModel, keyPresence, quota, c7, live }], remote: { allowed: boolean } }`. Nunca claves.
- `PUT /api/v1/config/llm` con `If-Match` (huella de `cv.toml`, o `*` si no existe) y cuerpo `{ provider, baseUrl?, model?, models? }` limitado a lo local → escritura quirúrgica (§4.1) → `200 { sha256, effective }`; `412` si la huella no coincide; `422` si el valor no es local o la URL no es loopback. `writes: true`.
- `POST /api/v1/config/llm/check` con `{ provider, model? }` → una llamada de salud al proveedor elegido (remoto solo con `--allow-remote`, como los trabajos) → `{ ok, models?, quota? }`. Explícito, sin datos del usuario.

### 4.6 La GUI: pantalla «Ajustes» y selectores del Co-piloto

Ruta `#/ajustes` (nueva página diferida). Secciones:

1. **Co-piloto local**: selector de proveedor (`ollama` / `openai-compatible`), URL base (validada como loopback en el cliente y en el servidor), modelo (texto con las sugerencias de la última comprobación), origen de cada valor efectivo (si el entorno manda, se dice y el campo queda en solo lectura con la explicación), botones **Comprobar** y **Guardar en cv.toml** (`PUT` con `If-Match`; conflicto → recargar).
2. **Proveedores externos**: una fila por remoto del registro: plan, host, presencia de clave (`entorno` / `fichero` / `sin clave` / `permisos inseguros`, con la ruta de `keys.json` y el comando `cv llm key set <id>` como instrucción), cuota publicada (con fuente y fecha), cuota viva si la hay, botón **Comprobar** (desactivado sin clave o sin `--allow-remote`, con el motivo).
3. **Estado del servidor**: `--allow-remote` activo o no, con la explicación de cómo cambiarlo (rearrancar `cv serve`).

Co-piloto: «Proveedor» y «Modelo» pasan a ser selectores alimentados por `GET /config/llm` (locales y remotos con clave), con el modelo por defecto del registro o de `[llm.models]`; el consentimiento de coste de un remoto sigue exactamente igual (409 → estimación → confirmar).

## 5. Pruebas y verificación (C12, C13)

- **Unitarias al 100 %**: esquema `[llm]` (valores válidos, remoto rechazado, URL no loopback, claves desconocidas en `models`), precedencia con `source` en todas las combinaciones, escritura quirúrgica de `cv.toml` (con comentarios y otras tablas intactas; sin fichero; con `[llm]` en medio; idempotencia), registro (invariantes: hosts únicos, evidencia C7 obligatoria en todo remoto, cuotas con fuente y fecha), `QuotaLedger` (cabeceras presentes/ausentes/malformadas, `retry-after` en segundos y en fecha), `quota-exceeded`, `cv llm key set|remove|list` (TTY y no TTY, 0600/0700, id desconocido, fichero inseguro), `cv llm status` ampliado, rutas `GET/PUT /config/llm` y `/check` (412, 422, 403 sin `--allow-remote`), lógica pura de «Ajustes» y componente.
- **Contrato de proveedores**: pruebas con dobles HTTP por cada `api` (petición y respuesta canónicas, cabeceras de cuota); **una** ejecución del arnés de IA contra cada proveedor gratuito candidato con el banco de pruebas, registrada en el informe del *spike* (no forma parte de la CI: exige clave y red).
- **Arnés determinista**: escenario `config` (`cv llm status` con `cv.toml`, con entorno y con ambos; `cv llm key list` sin claves; `key set` por `stdin` en un `HOME` temporal y `list` después; errores) y llamadas nuevas en `serve` (`GET /config/llm`, `PUT` con y sin `If-Match`, `check` sin `--allow-remote`).
- **E2E**: «Ajustes» guarda el proveedor local en `cv.toml` y Co-piloto lo usa (con el doble del proveedor de `gui/e2e/llm-stub.ts`, que además devolverá cabeceras de cuota para probar la cuota viva).
- Verificación final de cada sprint como siempre (typecheck, cobertura, arnés, `docs:check`; en el sprint de release, ejecutable y E2E contra él).

## 6. Documentación (C15)

Guía «Configurar el co-piloto» (`website/src/guide/copilot-settings.md`: `cv.toml`, precedencia, claves con `cv llm key`, proveedores gratuitos aprobados con sus cuotas y **su evidencia C7**, la pantalla «Ajustes»), `docs/copilot-providers.md` (informe del *spike*: tabla de evidencia, fechas, decisión), `docs/llm-integration.md` §3 (C3 con `cv.toml`; C7 con el registro y su evidencia; C11 con las cuotas y `quota-exceeded`) y §5 (`cv llm key`), referencia generada (comandos y rutas), guía web («Ajustes»), README, CHANGELOG `[1.5.0]`.

## 7. Seguridad

- **Claves**: mismo régimen que hoy (entorno o `keys.json` 0600), ampliado a los remotos del registro; `cv llm key set` sin argumento ni eco; la API y la GUI solo ven presencias. Un formulario de claves en el navegador queda fuera (decisión 2).
- **Red**: la lista blanca sale del registro (host fijo por proveedor); ninguna URL remota configurable por el usuario salvo las variables `CHAMELEON_<ID>_BASE_URL` ya existentes (para *proxies* propios), que siguen exigiendo `--provider` explícito; `cv.toml` solo admite loopback.
- **Consentimiento** (C11): nada cambia en los trabajos; «Comprobar» es una llamada explícita sin datos del usuario; los 429 no se reintentan solos.
- **Escritura de `cv.toml`**: solo desde `PUT /config/llm` con `If-Match`, tabla `[llm]` únicamente, contenido validado antes de escribir; el resto del fichero no se toca.
- **Sin telemetría**: la cuota viva se lee de respuestas que el usuario provocó y muere con el proceso.

## 8. Riesgos

| Riesgo | Mitigación |
|---|---|
| Ningún proveedor gratuito cumple C7 | El *spike* lo demuestra con evidencia y T-8.2 entrega el resto (registro, `cv.toml`, claves, «Ajustes») igualmente; se reevalúa cuando cambien las políticas. |
| Las políticas cambian tras la publicación | La evidencia lleva fecha; la guía lo advierte; retirar un proveedor es un cambio de datos + CHANGELOG. |
| Cabeceras de cuota heterogéneas o ausentes | El `QuotaLedger` tolera ausencia y formatos; sin cabeceras se muestra solo la cuota publicada. |
| Un 429 en mitad de un lote | Error tipificado con `retryAfter`, el lote se detiene sin reintentos y la revisión parcial se escribe como hoy con la cancelación. |
| Reescritura de `cv.toml` que estropee el fichero del usuario | Sustitución quirúrgica de la tabla, `If-Match`, validación previa, pruebas byte a byte; nunca `stringify` del fichero entero. |
| Alcance de la GUI | «Ajustes» se limita a lo descrito; sin editor de `cv.toml` completo. |

## 9. Plan de ejecución

- **S1 · Cimientos y spike**: `[llm]` en `cv.toml` con precedencia y `source`; escritura quirúrgica; `cv llm status` con orígenes; `cv llm key set|remove|list`; informe del *spike* con la evidencia de los candidatos (decisión 3 al final del sprint). Informe y aprobación.
- **S2 · Registro, cuotas y API**: registro con los remotos aprobados; lista blanca y modelos por defecto derivados; `QuotaLedger` y `quota-exceeded`; `GET/PUT /config/llm` y `/check`; escenario `config` del arnés; referencia. Informe y aprobación.
- **S3 · GUI y entrega**: pantalla «Ajustes», selectores del Co-piloto, doble del proveedor con cabeceras de cuota, E2E, guía, `llm-integration.md`, CHANGELOG `[1.5.0]`, versión 1.5.0, verificación completa y solicitud de la orden de etiquetado.

## 10. Decisiones que se piden al Director

1. **`[llm]` en `cv.toml` solo para lo local** (proveedor, URL loopback, modelo) más `[llm.models]` como modelo por defecto por remoto; un remoto nunca se fija como valor por defecto (C3). Precedencia flag > entorno > `cv.toml` > defecto. *Recomendado.*
2. **Claves solo por la terminal** (`cv llm key set`, sin argumento ni eco) o entorno; ni la API ni la GUI reciben claves; la GUI muestra presencias e instrucciones. *Recomendado.*
3. **Proveedores gratuitos por evidencia**: se examinan Groq, GitHub Models y Cerebras (y se documenta por qué se excluyen Gemini, el plan gratuito de Mistral y los agregadores); entran **uno o dos** de los que superen los cinco criterios de §4.3, y lo decide usted con la tabla de evidencia del *spike* en la mano. *Recomendado.*
4. **Cuotas**: publicadas (con fuente y fecha) + vivas desde las cabeceras de las llamadas del usuario, en memoria, sin llamadas propias; 429 → `quota-exceeded` sin reintentos automáticos. *Recomendado.*
5. **Salud explícita**: «Comprobar» y `cv llm status --provider` hacen una sola llamada sin datos del usuario y listan modelos si el proveedor lo permite. *Recomendado.*
6. **`--allow-remote` sigue siendo un flag del servidor**; «Ajustes» lo muestra pero no lo cambia. *Recomendado.*
7. **Escritura quirúrgica de `cv.toml`** (solo la tabla `[llm]`, resto byte a byte, `If-Match`) en lugar de reserializar el fichero. *Recomendado.*
8. **Sin tabla de precios**: cuotas y aviso de coste, no tarifas. *Recomendado.*
9. **Selectores en Co-piloto** alimentados por el registro (sustituyen al texto libre). *Recomendado.*
10. **Versión 1.5.0** en tres sprints; una ejecución del arnés de IA contra cada candidato gratuito, fuera de la CI, con una cuenta del Director Técnico y solo datos del banco. *Recomendado.*

## 11. Estado de la implementación

- 2026-08-30: PROPUESTA v1 redactada y enviada al Director de Ingeniería y Producto; **APROBADA en su totalidad** el mismo día (10/10), con luz verde para S1.
- **S1 · Cimientos y spike (2026-08-30)**: entregado. **`[llm]` en `cv.toml`** (`src/llm/settings.ts`: esquema estricto —solo proveedores locales, `base_url` loopback, `model`, `[llm.models]` por remoto—, `serializeLlmTable` y `replaceLlmTable`, la sustitución quirúrgica de la tabla y sus subtablas contiguas con el resto del fichero byte a byte; `src/app/settings.ts`: `loadLlmSettings` y `renderLlmSettings`, que vuelve a analizar el resultado antes de darlo por bueno). **Precedencia con origen** (`src/llm/config.ts`: `resolveLlmConfig(env, { provider, model, settings })` elige campo a campo orden > entorno > `cv.toml` > defecto y devuelve `sources` con `flag | env | file | default`; `selectProvider` lee `[llm]` para lo local y `[llm.models]` como modelo por defecto del remoto, y un `cv.toml` inválido bloquea toda selección con su mensaje). **`cv llm status`** explica el origen de cada valor («orden», «entorno», «cv.toml», «por defecto») y el estado de `cv.toml` (no existe, sin tabla `[llm]`, presente, inválida). **Claves**: `writeApiKey`/`removeApiKey` (fichero `0600` y directorio `0700`, escritura atómica, sin tocar un fichero inseguro o inválido) y `cv llm key set|remove|list` (`set` pregunta sin eco en la terminal —lectura en modo *raw*, Retroceso borra, Ctrl-C cancela— o lee la entrada estándar sin ella; nunca acepta la clave como argumento ni la imprime). El contexto de Node lee `cv.toml` en cada orden (`readSecret` solo con terminal). **Spike**: `docs/copilot-providers.md` con la evidencia (URL, fecha, cita) de Groq, GitHub Models, Cerebras, Gemini, Mistral, OpenRouter y Together: **Groq es el único que cumple los cinco criterios**; GitHub Models fue retirado el 2026-07-30; Cerebras ya no tiene plan gratuito sin tarjeta; Gemini y Mistral Free entrenan con los datos por defecto; OpenRouter y Together quedan dudosos. Propuesta al Director: integrar Groq y no integrar un segundo por ahora. **Pruebas**: 762 en la raíz (100 %), 24 nuevas (esquema y sustitución de la tabla, capa de aplicación, precedencia y estado, escritura y borrado de claves con permisos, CLI `llm key` y `askSecretInTerminal`); arnés 10 escenarios · 91 pasos (goldens de `core` con la línea nueva de `cv.toml`); referencia con 28 comandos y ejemplos de `llm key`.
- **S2 · Registro, cuotas y API (2026-08-30)**: entregado. **Decisión 3 del Director** (con la tabla de evidencia del *spike*): integrar **solo Groq**; ningún segundo proveedor sin garantía contractual pública; verificación al alta con una cuenta del Director Técnico y datos del banco (protocolo en `docs/copilot-providers.md` §8). **Registro** (`src/llm/registry.ts`): `openai`, `anthropic` y `groq` como datos —API (`openai-chat` / `anthropic-messages`), host, URL base, modelo por defecto, `CHAMELEON_<ID>_API_KEY`/`_BASE_URL`, plan, cuota publicada con fuente y fecha, evidencia C7 (URL, fecha y cita literal verificadas el 2026-08-30 para los tres) y cabeceras de cuota documentadas—; de él salen la lista blanca, las variables de clave, el esquema de `keys.json`, las claves admitidas en `[llm.models]` y la fábrica del proveedor remoto (`selectProvider` elige el cliente por `api`). **Cuota viva** (`src/llm/quota.ts`): el cliente HTTP devuelve solo las cabeceras `x-ratelimit-*`/`anthropic-ratelimit-*`/`retry-after` (nunca las demás), `createRemoteHttp` las entrega a un observador y `QuotaLedger` guarda la última lectura por proveedor en memoria del proceso; `cv llm status` la enseña como «cuota viva» y los tres comandos del co-piloto la imprimen al terminar un trabajo remoto («Cuota según groq: quedan 28/30 peticiones…»); un **429 es `quota-exceeded`** con el `retry-after` si lo hay, en los tres proveedores, sin reintentos, y `runImproveBatch` se detiene. **`cv llm status`**: una línea por remoto (clave, plan, cuota publicada, host, modelo por defecto) y la ruta del fichero de claves. **API**: `GET /config/llm` (configuración efectiva con orígenes, `cv.toml` con huella y `ETag`, proveedores sin claves, cuota viva, `remote.allowed`), `PUT /config/llm` (`If-Match`; sustitución quirúrgica y comprobada; 428/409/400/422), `POST /config/llm/check` (una llamada de salud explícita; local o remoto; 403 `remote-disabled` sin `--allow-remote`; la clave ausente o un id desconocido se devuelven como resultado, no como error HTTP). **Arnés**: escenario `config` (11 pasos: `llm status` con `cv.toml` y con `--provider`/`--model`, `key list`, `status --provider groq` sin clave, `key set` por `stdin`, `key set` desconocido y vacío, `key remove` ×2) y siete llamadas nuevas en `serve` (`GET/PUT /config/llm` con 428, 400, huella correcta y sustitución; `check` local y `check` de un remoto → 403). **Pruebas**: 777 en la raíz al 100 % (registro e invariantes, parseo de cabeceras y libro, cliente HTTP con cabeceras, 429 en los tres proveedores, parada del lote, escritura de `cv.toml` con conflictos, rutas de configuración con dos servidores); arnés 12 escenarios · 105 pasos. Precisiones respecto a la propuesta: `--provider <local>` en `cv llm status` se resuelve por la vía local (no como «remoto»); la respuesta de `check` usa `200` con `ok: false` para «sin clave» e «id desconocido» (son resultados de la comprobación, no fallos del servidor).
- **S3 · GUI y entrega (2026-08-30)**: entregado; **T-8.2 cerrada en su implementación**. Pantalla **«Ajustes»** (`gui/src/pages/Ajustes.svelte`, lógica pura en `gui/src/lib/settings.ts` al 100 %): co-piloto local (proveedor, URL base loopback y modelo; origen de cada valor; campos fijados por el entorno en solo lectura; **Guardar en cv.toml** con `If-Match` y sustitución quirúrgica; **Comprobar** = una llamada de salud), proveedores externos del registro (plan, host, modelo por defecto, procedencia de la clave, cuota publicada con fuente y fecha, cuota viva, evidencia C7 enlazada, **Comprobar** solo con clave y `--allow-remote`) y el estado del servidor respecto a los remotos. El selector «Proveedor» del Co-piloto ofrece el local y los remotos utilizables (`gui/src/lib/copilot/providers.ts`). Cliente con `llmConfig`/`writeLlmConfig`/`checkLlm`. **E2E** con el espacio de trabajo configurado por `cv.toml` (el doble del proveedor se apunta desde `[llm]`, no desde el entorno): «Ajustes muestra la configuración de cv.toml con sus orígenes, comprueba el proveedor local, guarda un cambio y lo deshace» — 10/10, también contra el ejecutable. Capturas regeneradas (`ajustes.png`). Guía «Configurar el co-piloto» (barra lateral), README (`cv llm key`), guía web, `llm-integration.md` §3 (T-8.2), CHANGELOG `[1.5.0]`, versión 1.5.0 en `package.json`, `compose.yml`, README, guías y goldens. Verificación: raíz (typecheck, cobertura 100 % con 777 pruebas, arnés 11 escenarios · 102 pasos), GUI (svelte-check 0 errores, pruebas con `lib` al 100 %, E2E 10/10), portal (`docs:build`, 28 comandos y 32 rutas), ejecutable SEA 1.5.0 con E2E y arnés contra él. Bundle inicial 27,1 KB gzip (presupuesto 30). **Pendiente y bloqueante para etiquetar**: la verificación al alta de Groq por una persona (§9 del informe del *spike*).
- 2026-08-30: **v1.5.0 publicada** (tag anotado `fe11612` → `ba501c5` en `release/1.5` = `90c7042` + Groq en `pending-verification` + su prueba; run `33295496174` en verde). Verificación externa desde esta máquina, sin sesión en GitHub: release final con `chameleon-cv-1.5.0-linux-x64.tar.gz` (48,6 MB), `.sha256` y `SHA256SUMS.txt` coincidentes (`45c14859…`); `cv --version` = 1.5.0; **arnés determinista 11 escenarios · 102 pasos contra el binario descargado**; índice `sha256:9b035a6f…` (`linux/amd64`, `linux/arm64`) con `1.5.0` = `1.5` = `1` = `latest`, distroless `sha256:5a7bbdc1…`; atestaciones SLSA v1 del run sobre `refs/tags/v1.5.0` verificadas con `cosign` para los dos índices y el tar.gz («Verified OK» ×3); humo de las dos variantes publicadas (Debian como UID 1000, distroless como 65532) en verde. Publicada **sin proveedor gratuito seleccionable**: Groq queda pendiente de la verificación humana (§9 de `docs/copilot-providers.md`).
- 2026-08-30: **modelos seleccionables por remoto** (orden del Director tras la revisión de Groq, `docs/copilot-providers.md` §10): `RemoteProviderEntry.models` con estado, tareas recomendadas (`recommendedFor`) y evidencia; `recommendedModel(entry, tarea)`; línea «modelos» en `cv llm status` y en Ajustes; Groq = `openai/gpt-oss-120b` (mejorar logros, resumir) y `qwen/qwen3.8-27b` (sugerir etiquetas; sesiones gratuitas). Groq sigue pendiente de verificación humana.
