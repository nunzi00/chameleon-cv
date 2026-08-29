## Ejemplos

```bash
cv llm status                                   # antes: ¿qué proveedor y modelo locales se usarían y responden?
cv improve -s backend --top-n 3                 # reescrituras para los logros de esa versión del CV
cv improve -f oferta.pdf --compact              # … para los que sobreviven a la adaptación, con los términos de la oferta
cv improve --only exp-acme-1 --show-payload --dry-run   # muestra exactamente qué saldría (seudonimizado) sin enviar nada
cv improve --show-prompt                        # imprime el prompt versionado (prompts/improve.v1.md)
cv improve -s backend --provider openai         # remoto explícito: coste estimado y confirmación antes de enviar
cv improve -s backend --provider anthropic --yes --model claude-sonnet-4-5   # sin preguntar (scripts)
```

- Escribe `output/revision-improve-<fecha>[-<esp>][-<oferta>].md` (0600) con, por logro, el original, cada propuesta y su verificación por código (canon C2: nada añadido ni omitido); nunca toca tus fuentes.
- Marca con `[x]` lo que quieras adoptar y aplícalo con [`cv improve apply`](./improve-apply). Guía: [Co-piloto de IA](/guide/copilot).
