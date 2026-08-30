---
title: Co-piloto de IA
---
# Co-piloto de IA

El co-piloto **sugiere** y nunca decide ni escribe en tus fuentes: la doctrina completa (cánones C1–C15) está en la nota [Co-piloto de IA: diseño y principios](/design/llm-integration). Es **local por defecto** y solo habla con un servidor de modelos en tu propia máquina (loopback); los proveedores remotos (`openai`, `anthropic`) exigen `--provider` explícito en cada orden, muestran el coste estimado y piden confirmación antes de enviar nada.

```bash
cv llm status                                   # proveedor y modelo locales que se usarían y si responden (nunca envía datos)
cv improve -s backend --top-n 3                 # propone reescrituras con más impacto para los logros de esa versión del CV
cv improve -f oferta.pdf --compact              # … para los que sobreviven a la adaptación, usando los términos de la oferta
cv improve --only exp-acme-1 --show-payload --dry-run   # muestra exactamente qué saldría (seudonimizado) sin enviar nada
cv summarize -s backend                         # propone el resumen profesional a partir del perfil filtrado
cv suggest tags "Migré la plataforma a Kubernetes sin parada"   # etiquetas para un texto, solo del diccionario cerrado
cv improve apply output/revision-improve-2026-08-29.md   # aplica lo marcado [x]: versión anterior al histórico y huella comprobada
cv history                                               # el histórico de versiones de las fuentes (output/historial-fuentes/)
cv history show latest experience/acme.md                # la última versión guardada de una fuente
cv history restore latest experience/acme.md             # la vuelve a escribir (la actual también queda en el histórico)
cv llm cache clear                              # vacía la caché local de respuestas
```

## Configurar un modelo local

Variables de entorno, nada más: `CHAMELEON_LLM_PROVIDER` (`ollama` por defecto, u `openai-compatible` para llama.cpp `llama-server`, LM Studio…), `CHAMELEON_LLM_BASE_URL` (por defecto `http://127.0.0.1:11434` u `:8080`; cualquier dirección que no sea local se rechaza) y `CHAMELEON_LLM_MODEL` (por defecto `qwen3:8b`, el modelo con el que está validado el producto). Con un modelo de 7B en CPU cuenta con 20–40 s por logro: usa `--only`, `--top-n` y `--max-items` para acotar el lote. Tutorial: [El co-piloto con Ollama](/tutorials/copilot-ollama).

### Modelos locales: catálogo, descarga y razonamiento

`cv llm models` lista el catálogo de modelos locales (`qwen3:8b` por defecto, `qwen2.5:7b-instruct`, `deepseek-r1:8b`, `gpt-oss:20b`, `qwen3:4b`) con familia, razonamiento (ninguno, conmutable o siempre), tamaño, RAM mínima, licencia, tareas recomendadas y espejo, y marca cuáles están descargados. `cv llm up --model <id>` los descarga y arranca Ollama con lo que haya en la máquina —el binario `ollama` si existe y, si no, Docker (contenedor `chameleon-ollama`); si la vía elegida falla al arrancar prueba la otra, y `cv llm status` dice cuál se usará y por qué (T-8.14)—; si el registro de Ollama falla y el modelo tiene espejo en Hugging Face, se descarga el espejo (`hf.co/<repositorio>:<cuantización>`) y se crea el alias con el nombre corto (`--source huggingface` va directo al espejo). `[llm] think = true` en `cv.toml` (o `CHAMELEON_LLM_THINK=1`) pide razonamiento a los modelos que lo conmutan; los que razonan siempre (DeepSeek-R1) se admiten igual: su razonamiento se descarta antes de validar el JSON. En la interfaz web, «Ajustes» ofrece el mismo catálogo en un selector.

## `cv improve`: reescrituras verificadas

Escribe un **fichero de revisión** (`output/revision-improve-<fecha>[-<esp>][-<oferta>].md`, permisos 0600) con, por logro, el original, cada propuesta y su **verificación**: el código comprueba —sin confiar en el modelo— que ninguna propuesta añade cifras, entidades o contexto que no estuvieran en el original ni omite cifras o entidades que sí estaban (canon C2, integridad semántica); las que fallan aparecen tachadas con el motivo (`VIOLATION_C2_FACT_OMITTED (40)`, `VIOLATION_C2_ENTITY_ADDED (Kubernetes)`…). Antes de enviar, la orden dice qué sale y a dónde: solo el texto del logro y su contexto inmediato, con tu nombre sustituido por `[NOMBRE]` (y las empresas por `[EMPRESA-n]` con `--redact-companies`); nunca email, teléfono, ubicación ni enlaces. Las respuestas válidas se guardan en tu caché de usuario (0600) para que repetir sea gratis e idéntico (`--no-cache` para saltarla).

## `cv summarize`: el resumen profesional

Envía una representación textual y seudonimizada del perfil **ya filtrado** (con los años de experiencia calculados por código, para que el modelo no tenga que inventarlos) y escribe `output/revision-summarize-…md` con dos o tres propuestas verificadas en modo síntesis: se rechaza toda cifra o entidad que no esté en el perfil y toda propuesta que no mencione ninguno de los hechos clave (las etiquetas de la especialidad y los términos de la oferta que el perfil demuestra); cada propuesta indica qué hechos clave menciona y cuáles no.

## `cv suggest tags`: etiquetas del diccionario cerrado

Cierra el ciclo con el motor determinista: el selector y la puntuación dependen de las etiquetas, y este comando propone —**solo del diccionario cerrado** formado por las tags de tus especialidades— las que un texto («-» = stdin) o los logros del perfil (`--only <ids>`, `--untagged`, `-s` para acotar el diccionario) demuestran. El código verifica cada etiqueta devuelta: lo que no está en el diccionario se rechaza, `pin` está reservada, no hay duplicados ni más de `--max-tags`, y cada etiqueta aceptada lleva su **evidencia calculada por código** (`literal`, `contexto` o `inferida`; `--explain` la muestra). Por stdout sale la línea lista para pegar (`#php #kubernetes`).

## Cerrar el ciclo: `cv improve apply`

Marca con `[x]` en el fichero de revisión (de `improve` o de `summarize`) las propuestas que quieras adoptar —puedes retocar su texto— y aplícalas. Es la única orden que escribe en `data/sources/`, con cuatro garantías: **solo lo marcado** (una propuesta por ítem); **cambio mínimo** (solo el texto del logro o el resumen; `#hashtags`, metadatos y el resto del fichero quedan byte a byte iguales); **copia de seguridad previa** (`<fichero>.bak`, y `.bak.1`, `.bak.2`… si ya existía); y **comprobación por huella**: la revisión registra fichero, línea y `sha256` de cada original, y si el original ya no está tal cual no se escribe nada. `--dry-run` muestra el plan, `--delete-review` elimina la revisión aplicada, y después recompila con `cv build`.

## Proveedores remotos (opcional)

Para usar la API de OpenAI (`--provider openai`, modelo por defecto `gpt-4o-mini`) o de Anthropic (`--provider anthropic`, `claude-sonnet-4-5`) se aplican, por diseño, cuatro reglas:

- **Solo explícito, en cada orden.** El remoto no puede ser el proveedor por defecto (`CHAMELEON_LLM_PROVIDER=openai` se rechaza): cada `improve`, `summarize` o `suggest tags` que quiera salir de tu máquina lo dice con `--provider openai|anthropic`; sin él, todo sigue siendo local. `--model <nombre>` elige el modelo.
- **Claves nunca interactivas ni en texto plano inseguro.** Se leen, en este orden, de la variable `CHAMELEON_OPENAI_API_KEY` / `CHAMELEON_ANTHROPIC_API_KEY` o del fichero `~/.config/chameleon-cv/keys.json` (`$XDG_CONFIG_HOME` si está definida; `%APPDATA%\chameleon-cv\keys.json` en Windows) con permisos **0600** y forma `{"openai": "sk-…", "anthropic": "sk-ant-…"}`. Un fichero legible por otros usuarios se rechaza con la orden `chmod 600` que lo arregla; el programa nunca pregunta la clave, nunca la imprime, nunca la guarda y no lee `OPENAI_API_KEY` ni variables de otras herramientas.
- **Lista blanca de hosts.** Solo `https` y solo hacia `api.openai.com` y `api.anthropic.com`; una pasarela propia exige declarar su host en `CHAMELEON_LLM_ALLOWED_HOSTS` (separados por comas) y la URL base en `CHAMELEON_OPENAI_BASE_URL` / `CHAMELEON_ANTHROPIC_BASE_URL`. Sin redirecciones: lo que no esté en la lista se rechaza en código antes de abrir la conexión.
- **Conciencia de coste.** Antes de la primera petición la orden muestra cuántas peticiones saldrán, una estimación de tokens de entrada (4 caracteres ≈ 1 token) y el máximo de salida, avisa de que puede incurrir en costes y pide confirmación (`s/N`); sin terminal interactiva se cancela salvo que pases `--yes`. Lo que sale es exactamente lo mismo que con un proveedor local: el fragmento seudonimizado que enseña `--show-payload`.

`cv llm status` dice de dónde saldría cada clave sin mostrar su valor, y con `--provider <remoto>` verifica clave, lista blanca y modelos disponibles.
