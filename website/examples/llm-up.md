## Ejemplos

```bash
cv llm up                              # arranca el Ollama local y descarga el modelo configurado si falta
cv llm up --model llama3:8b            # otro modelo solo para este arranque (no cambia cv.toml)
cv llm up --runner docker --no-pull    # fuerza el contenedor Docker y no descarga nada
cv llm up --json                       # estado, líneas de progreso y, si falla, código y mensaje
```

- Runner `native` si hay `ollama` en el `PATH` (o en `CHAMELEON_OLLAMA_BIN`); si no, `docker` (contenedor `chameleon-ollama` con la imagen fijada por digest, publicado solo en `127.0.0.1`). `CHAMELEON_LLM_RUNNER` también lo fuerza.
- Si Ollama ya responde pero lo arrancaste tú, no se toca: solo se asegura el modelo.
- La única salida de red es la descarga del modelo desde el registro público de Ollama; no lleva ningún dato tuyo. Dentro de la imagen de Compose la orden está deshabilitada (allí Ollama es un servicio del propio Compose).
- Salida `0` correcto; `1` modelo o runner inválidos; `2` sin runner, arranque o descarga fallidos.
- `--source huggingface` descarga directamente el espejo del catálogo (`hf.co/<repositorio>:<cuantización>`) y crea el alias corto; sin `--source`, se intenta el registro de Ollama y, si falla, el espejo (T-8.13). Solo los modelos con espejo en `cv llm models` lo admiten.
