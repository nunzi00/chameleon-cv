## Ejemplos

```bash
cv llm status                        # proveedor y modelo locales que se usarían y si responden; nunca envía datos
cv llm status --provider openai      # además comprueba ese proveedor remoto: clave, lista blanca y modelos (accede a la red)
CHAMELEON_LLM_PROVIDER=openai-compatible CHAMELEON_LLM_BASE_URL=http://127.0.0.1:8080 cv llm status   # llama-server, LM Studio…
```

- Dice de dónde saldría cada clave remota (`ninguna`, `definida en CHAMELEON_…`, `fichero de claves`, `permisos abiertos`) sin mostrar nunca su valor.
