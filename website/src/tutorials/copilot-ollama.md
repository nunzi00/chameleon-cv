---
title: 4 · El co-piloto con Ollama
verify:
  - data/dist/profile.json
---
# Tutorial 4 · El co-piloto con Ollama

El co-piloto propone y tú decides: reescrituras de logros, resúmenes y etiquetas, siempre **verificados por código** y siempre en ficheros de revisión, nunca en tus fuentes. En este tutorial lo configuras con un modelo local y recorres el ciclo completo hasta aplicar lo que marques.

## 1. Un modelo local

Instala [Ollama](https://ollama.com) y descarga el modelo con el que está validado el producto:

```bash
ollama pull qwen3:8b
ollama serve            # si no está ya en marcha (escucha en http://127.0.0.1:11434)
```

No hace falta configurar nada: `ollama` y `qwen3:8b` son los valores por defecto (`cv llm models` lista el catálogo local con lo descargado; `cv llm up` lo descarga y arranca Ollama por ti, con el espejo de Hugging Face si el registro de Ollama falla). Con otro servidor compatible con OpenAI (llama.cpp `llama-server`, LM Studio…): `CHAMELEON_LLM_PROVIDER=openai-compatible`, `CHAMELEON_LLM_BASE_URL=http://127.0.0.1:8080` y `CHAMELEON_LLM_MODEL=<nombre>`. Cualquier dirección que no sea local se rechaza.

```bash tutorial needs-llm
cv llm status
```

## 2. Qué saldría, sin enviar nada

```bash tutorial
cv init
printf -- '- Migré la plataforma de pagos a Kubernetes sin ventana de parada, coordinando a tres equipos.\n' >> data/sources/achievements.md
cv build
cv improve --only exp-acme-1 --show-payload --dry-run
cv improve --show-prompt
```

De paso hemos añadido a `achievements.md` un logro transversal **sin etiquetas**: en el paso 4 el co-piloto propondrá las suyas. Ninguna de las dos órdenes de `improve` contacta con el modelo. La primera enseña **exactamente** la carga útil: el texto del logro y su contexto inmediato, con el nombre sustituido por `[NOMBRE]` (y `--redact-companies` sustituiría las empresas); nunca email, teléfono, ubicación ni enlaces. La segunda imprime el prompt versionado (`prompts/improve.v1.md`).

## 3. Reescrituras verificadas

```bash tutorial needs-llm
cv improve -s backend --top-n 2 --max-items 2
ls output
```

Con un modelo de 7B en CPU cuenta con 20–40 s por logro; `--only`, `--top-n` y `--max-items` acotan el lote. El resultado es un fichero `output/revision-improve-<fecha>-backend.md` con, por logro, el original, cada propuesta y su **verificación**: el código comprueba —sin confiar en el modelo— que ninguna propuesta añade cifras, entidades o contexto que no estuvieran en el original ni omite cifras o entidades que sí estaban. Las que fallan aparecen tachadas con el motivo (`VIOLATION_C2_FACT_OMITTED (40)`…).

## 4. El resumen y las etiquetas

```bash tutorial needs-llm
cv summarize -s backend
cv suggest tags "Migré la plataforma de pagos a Kubernetes sin ventana de parada" -s backend --explain
cv suggest tags --untagged --explain
```

`summarize` propone dos o tres resúmenes a partir del perfil **ya filtrado** por la especialidad, verificados en modo síntesis (ninguna cifra o entidad que no esté en el perfil; cada propuesta indica qué hechos clave menciona). `suggest tags` solo devuelve etiquetas del **diccionario cerrado** —las tags de tus especialidades— y cada una lleva su evidencia calculada por código; por stdout sale la línea lista para pegar al final de la viñeta (`--untagged` recorre los logros del perfil que aún no tienen etiquetas, como el que añadimos; si todos las tienen, lo dice y termina con código 1).

## 5. Aplica lo que marques

Abre la revisión, marca con `[x]` las propuestas que quieras adoptar (puedes retocar su texto) y aplícalas:

```bash
$EDITOR output/revision-improve-*-backend.md        # cambia «- [ ]» por «- [x]» en lo que quieras adoptar
cv improve apply output/revision-improve-*-backend.md --dry-run
cv improve apply output/revision-improve-*-backend.md
```

Sin ninguna marca no hay nada que aplicar: la orden lo dice y termina con código 1 (por eso este paso no se ejecuta solo en la integración continua; el arnés de aceptación lo cubre con revisiones marcadas). `--dry-run` muestra el plan. Sin él, `cv improve apply` es la única orden que escribe en `data/sources/`: solo lo marcado, cambio mínimo (los `#hashtags`, los metadatos y el resto del fichero quedan byte a byte iguales), copia `<fichero>.bak` previa y comprobación por huella (si el original cambió desde que se generó la revisión, no escribe nada). Después, `cv build`.

## 6. Proveedores remotos, solo si tú lo dices

```bash
cv improve -s backend --provider openai            # muestra el coste estimado y pide confirmación antes de enviar
cv llm status --provider anthropic                 # clave, lista blanca y modelos disponibles; nunca imprime la clave
```

Sin `--provider` en la orden, nada sale de tu máquina. Las claves se leen de `CHAMELEON_OPENAI_API_KEY` / `CHAMELEON_ANTHROPIC_API_KEY` o de `~/.config/chameleon-cv/keys.json` (0600). Todo el detalle: [Co-piloto de IA](/guide/copilot).
