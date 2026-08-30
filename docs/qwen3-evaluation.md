# Evaluar Qwen3 como modelo local por defecto (T-8.11) — PROPUESTA v1

Estado: PROPUESTA (2026-08-30) · Pregunta del Director · Pendiente de aprobación del PO

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

(pendiente)
