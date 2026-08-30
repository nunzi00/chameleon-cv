# Evaluar Qwen3 como modelo local por defecto (T-8.11) — PROPUESTA v1

Estado: EVALUACIÓN EN CURSO (§4 parcial) (2026-08-30) · Pregunta del Director · Pendiente de aprobación del PO

## §0 Pregunta

Director, 2026-08-30: «¿por qué usamos qwen2.5 sobre qwen3.8? Entiendo que el más moderno debería ser mejor, ¿no?».

## §1 Por qué el defecto es `qwen2.5:7b-instruct`

- Es el modelo con el que se **validó el proceso** (canon C12/C13): el arnés de IA (`npm run test:acceptance:ai`,
  16 casos) pasó 16/16 con él; ningún otro modelo local tiene esa evidencia en el repositorio (ROADMAP, observación
  técnica n.º 3: recomendar otro exige pasar antes el arnés).
- Cabe en la máquina de referencia (Q4, ~4,7 GB, ~7 tok/s en CPU) y responde JSON estricto sin «pensamiento» por
  el medio.
- Más moderno no garantiza mejor **para esta tarea**: Qwen3 activa por defecto el modo de razonamiento
  (`<think>…</think>`), que rompe la salida JSON estricta si no se desactiva (`think: false` en la API de Ollama,
  o `/no_think`), y su tamaño y latencia en CPU pueden empeorar la experiencia del co-piloto.

## §2 Propuesta

1. Soporte explícito de Qwen3 en el proveedor Ollama: enviar `think: false` cuando el modelo empiece por `qwen3`
   (sin efecto en otros) y tolerar un bloque `<think>` residual antes del JSON.
2. Evaluar `qwen3:8b` (y, si cabe, `qwen3:14b`) con el **mismo arnés de IA** (16 casos) y las mismas métricas
   (aciertos, rechazos C2, tiempo por ítem) frente a `qwen2.5:7b-instruct`, en Docker con el runtime de T-8.8;
   resultados en `build/ai/qwen3/` y resumen en este documento (§4).
3. Decidir con evidencia: si Qwen3 iguala o supera 16/16 con tiempos comparables, pasa a ser el modelo por
   defecto (documentación, registro, arnés); si no, se documenta el motivo y queda como opción (`--model qwen3:8b`).

## §3 Decisiones que se piden al PO

1. **D1** Ejecutar la evaluación ya (descarga ~5 GB y ~1 h de CPU en la máquina del Director) y publicar la tabla.
2. **D2** Criterio: cambiar el defecto solo con 16/16 y tiempo por ítem ≤ 1,5× el de qwen2.5.
3. **D3** Versión: 1.8.0 si cambia el defecto; si no, solo documentación.

## §4 Resultados

Estado: PARCIAL (2026-08-30) · pendiente la fila de `deepseek-r1:8b` (T-8.13) y la decisión del PO sobre el defecto.

Condiciones: máquina del Director (CPU, sin GPU; 30 GiB de RAM), Ollama 0.33.2 en Docker (`chameleon-ollama`, runner
de T-8.8), arnés `npm run test:acceptance:ai` (16 comprobaciones: improve, summarize y suggest tags sobre el banco de
pruebas), una ejecución por modelo, en serie y sin otra carga pesada. El registro de Ollama falló cinco veces con los
blobs de ~5 GB («max retries exceeded» desde Cloudflare R2), así que `qwen3:8b` y `deepseek-r1:8b` son los GGUF
Q4_K_M de Hugging Face (`hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M`, `hf.co/unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF:Q4_K_M`)
con alias creados con `ollama cp` (el mecanismo que T-8.13 automatiza). Registros en `build/ai/<modelo>.log`.

| Modelo | Comprobaciones | Tiempo total | improve | summarize | suggest tags | Calidad observada (no criterio) |
|---|---|---|---|---|---|---|
| `qwen2.5:7b-instruct` (defecto actual) | 16/16 | 224 s | 89 s · 6 propuestas, **0 aceptadas**, 6 rechazadas por C2 | 69 s · 2 propuestas, 1 aceptada | 63 s · 6 etiquetas (1 nueva) | Las seis reescrituras inventaron o alteraron cifras y C2 las rechazó todas |
| `qwen3:8b` (`think: false`) | 16/16 | 289 s (**1,29×**) | 95 s · 6 propuestas, **5 aceptadas**, 1 rechazada | 95 s · 2 propuestas, 2 aceptadas | 97 s · 9 etiquetas (2 nuevas) | Reescrituras fieles a los datos; más lento en summarize y suggest |
| `deepseek-r1:8b` (razona siempre) | pendiente | | | | | |

Lectura frente a D2 (16/16 y tiempo ≤ 1,5× el de qwen2.5): `qwen3:8b` **cumple ambos criterios** (16/16; 1,29× en
total, 1,07× en improve, 1,38× en summarize, 1,54× en suggest tags —solo esta tarea supera el 1,5× por poco—) y,
además, sus propuestas de `improve` superan la verificación C2 (5 de 6 frente a 0 de 6), que es lo que el usuario
acaba viendo. Con `think: false` el JSON estricto llegó limpio en las 16 comprobaciones (sin bloque `<think>` residual).

Propuesta derivada (D3): `qwen3:8b` pasa a ser el modelo local por defecto en la versión 1.8.0, con la reserva de
Hugging Face de T-8.13 para que la descarga no dependa del registro de Ollama; `qwen2.5:7b-instruct` sigue en el
catálogo como el más rápido. La fila de `deepseek-r1:8b` se añade cuando termine su ejecución (solo informativa: el
modelo razona siempre y no se propone como defecto).
