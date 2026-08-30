# Modelos locales de pensamiento en Ollama (T-8.13) — PROPUESTA v1

Estado: APROBADA por el PO (2026-08-30, D1–D5; versión 1.8.0) · IMPLEMENTADA el 2026-08-30 (§6) · Pendiente del cierre del PO

## §0 Encargo

Director, 2026-08-30: «me gustaría que ollama tuviera varios modelos de pensamiento para este proyecto disponibles, por
ejemplo deepseek».

## §1 Qué hay hoy

- Un solo modelo local por defecto (`qwen2.5:7b-instruct`, `OLLAMA_DEFAULT_MODEL`). `cv llm up --model <nombre>` acepta
  cualquier nombre válido y lo descarga del registro de Ollama; la GUI (Ajustes → Ollama local) tiene un campo de texto.
- Soporte de Qwen3 (T-8.11): `think: false` para `qwen3*` y descarte de un bloque `<think>` residual antes de validar el
  JSON (`stripThinking`). Nada para otras familias.
- El registro (`src/llm/registry.ts`) solo describe proveedores remotos (OpenAI, Anthropic, Groq) con sus modelos,
  estado, tareas recomendadas y evidencia; no hay catálogo de modelos locales.
- Hallazgo de hoy: el registro de Ollama (`registry.ollama.ai`, blobs en Cloudflare R2) falla en esta red con
  «max retries exceeded» en los blobs de ~5 GB (cuatro intentos con `qwen3:8b`, uno con `deepseek-r1:8b`, con Ollama
  0.33.2 en Docker), mientras que los mismos pesos desde Hugging Face (`hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M`,
  `hf.co/unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF:Q4_K_M`, 5,0 GB cada uno) se descargan a la primera. Ambos están ya en
  el contenedor `chameleon-ollama` con los alias `qwen3:8b` y `deepseek-r1:8b` (`ollama cp`).

## §2 Propuesta

1. **Catálogo de modelos locales** `LOCAL_MODELS` en `src/llm/registry.ts`, con la misma disciplina que los remotos:
   `id` (etiqueta en Ollama), familia, `thinking` (`none` | `switchable` | `always`), tamaño de descarga, RAM mínima,
   licencia, tareas recomendadas, `mirror` (repositorio GGUF en Hugging Face y cuantización) y evidencia (URL y fecha).
   Entradas iniciales: `qwen2.5:7b-instruct` (Apache-2.0, 4,7 GB, 8 GB RAM, sin pensamiento; por defecto),
   `qwen3:8b` (Apache-2.0, 5,2 GB, pensamiento conmutable), `deepseek-r1:8b` (MIT, 5,2 GB, destilado de
   DeepSeek-R1-0528 sobre Qwen3-8B, pensamiento siempre; tras la evaluación de §6 queda sin tareas recomendadas), `gpt-oss:20b` (Apache-2.0, 14 GB, 16 GB RAM, pensamiento con
   niveles) y `qwen3:4b` (2,6 GB, para máquinas con 8 GB). Los tamaños se verifican al descargar (los publica Ollama).
2. **`cv llm up --model <id> [--source ollama|huggingface]`**: si el modelo está en el catálogo y la descarga del registro
   falla, reintenta con el espejo de Hugging Face (aviso explícito de a qué host se conecta, dentro del mismo
   consentimiento de descarga) y crea el alias corto con `ollama cp` para que `[llm] model = "deepseek-r1:8b"` funcione
   igual. Con `--source huggingface` se va directo al espejo. Ambos hosts entran en la lista blanca publicada.
3. **Pensamiento conmutable**: `isThinkingModel` pasa a apoyarse en el catálogo y en patrones de familia (`qwen3`,
   `deepseek-r1`, `gpt-oss`, `magistral`, `phi4-reasoning`); `[llm] think = false | true` (por defecto `false`: JSON
   más rápido y determinista; con `true` se envía `think: true` a los modelos que lo admiten y se descarta el
   razonamiento antes de validar). Los modelos con pensamiento «siempre» (deepseek-r1) se tratan con `stripThinking`.
4. **`cv llm models [--json]`** (nuevo): el catálogo con el estado local de cada modelo (descargado o no, tamaño real,
   pensamiento, RAM) leyendo `/api/tags` del Ollama en marcha; `GET /api/v1/llm/models` con lo mismo.
5. **Ajustes (GUI)**: el campo «Modelo» del panel «Ollama local» pasa a ser un selector con el catálogo (etiqueta
   «pensamiento», tamaño y RAM, estado descargado) más un campo libre; «Descargar» = `cv llm up --model`.

## §3 Fuera de alcance

GPU y cuantizaciones distintas de Q4_K_M; evaluación automática de calidad (T-8.11 la hace a mano y con el arnés de
IA); gestión del espacio en disco de los modelos; descargas concurrentes.

## §4 Pruebas

Registro al 100 % (ids únicos, espejos `https`, tamaños y RAM coherentes, evidencia con fecha); `runtime.ts` con doble
del fallo del registro → espejo → alias, y del rechazo cuando el modelo no está en el catálogo y falla; arnés
`llm-runtime` con `cv llm models`; rutas de la API; GUI (selector y campo libre) con cobertura del `lib/`. Evaluación
real: `npm run test:acceptance:ai` con `qwen3:8b` y `deepseek-r1:8b` frente a `qwen2.5:7b-instruct` (aciertos y tiempo),
recogida en `docs/qwen3-evaluation.md`, que pasa a ser la evaluación de modelos locales.

## §5 Decisiones que se piden al PO

1. **D1** El catálogo inicial de cinco modelos de §2.1 (por defecto sigue `qwen2.5:7b-instruct` hasta que la evaluación
   de T-8.11 diga otra cosa).
2. **D2** Espejo de Hugging Face automático tras el fallo del registro (con aviso), y `--source` para forzarlo.
3. **D3** `[llm] think` apagado por defecto.
4. **D4** `cv llm models`, `GET /api/v1/llm/models` y el selector en Ajustes.
5. **D5** Entra en la versión 1.8.0 junto con T-8.12 (o en 1.9.0 si el PO prefiere no cargar más la release).

## §6 Estado de la implementación (2026-08-30)

- `src/llm/registry.ts`: `LOCAL_MODELS` (cinco entradas; `qwen3:8b` por defecto tras T-8.11 §4), `localModel`, `thinkingOf` (catálogo y familias: `qwen3` salvo `qwen3-coder`, `gpt-oss`, `magistral`, `phi4-*reasoning` conmutables; `deepseek-r1`, `qwq`, `exaone-deep` siempre), `describeThinking`, hosts `registry.ollama.ai` y `huggingface.co`.
- `src/llm/ollama.ts`: `thinkParameter` (solo modelos conmutables; `think: true` con `[llm] think`), tamaños de `/api/tags` en `health().sizes`; `OLLAMA_DEFAULT_MODEL = 'qwen3:8b'`.
- `src/llm/config.ts` y `settings.ts`: `[llm] think` y `CHAMELEON_LLM_THINK` (`1`/`true`, `0`/`false`) con su origen; `serializeLlmTable` lo escribe.
- `src/llm/runtime.ts`: `pull` con la reserva del espejo (registro → `hf.co/…` → `ollama cp` alias), `--source` (`ModelSource`), `models()` (catálogo + `present`/`sizeBytes`/`configured` + otros modelos), `formatLocalModels`; `isValidModelName` admite `hf.co/<usuario>/<repositorio>:<cuantización>`.
- CLI `cv llm models [--json]` y `cv llm up --source`; API `GET /api/v1/llm/models` y `source` en `POST /llm/runtime`; GUI Ajustes: selector con el catálogo (o «Otro» libre), casilla `[llm] think`, consentimiento de descarga que cita el espejo.
- Pruebas: `tests/llm/local-models.test.ts`, `runtime.test.ts` (espejo native/docker, `--source`, fallos del espejo y del alias, `models()`, formato), `providers.test.ts` (`think`, tamaños), `settings*.test.ts`, `llm-cli.test.ts`, `runtime-routes.test.ts`, GUI (`settings.test.ts`, `Ajustes.test.ts`); arnés `llm-runtime` con el doble de Ollama ampliado (`cp`, `FAKE_OLLAMA_REGISTRY=down`) y nueve pasos nuevos.
- `deepseek-r1:8b` evaluado con el arnés de IA (docs/qwen3-evaluation.md §4): 10/16, 3,5× más lento y JSON inválido en improve y suggest tags → en el catálogo sin tareas recomendadas (`recommendedFor: []`, «sin tareas recomendadas» en `cv llm models`).
- Verificación real: el espejo funcionó a mano el 2026-08-30 (`docker exec chameleon-ollama ollama pull hf.co/unsloth/…` + `ollama cp`) con Qwen3-8B y DeepSeek-R1-0528-Qwen3-8B; la evaluación de `deepseek-r1:8b` con el arnés de IA se recoge en `docs/qwen3-evaluation.md` §4.
- Desviación respecto a §2.4: `cv llm models` no exige Ollama en marcha (parado, la columna «descargado» queda «sin comprobar»); el selector de Ajustes solo aparece con el proveedor `ollama` (con `openai-compatible` el campo sigue libre).
