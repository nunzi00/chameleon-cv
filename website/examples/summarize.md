## Ejemplos

```bash
cv summarize -s backend                         # propone el resumen profesional para esa especialidad
cv summarize -f oferta.pdf --paragraphs 3       # orientado a una oferta, con el perfil adaptado a ella
cv summarize -s backend --proposals 3 --max-length 600
cv summarize -s backend --show-payload --dry-run   # qué saldría (perfil filtrado y seudonimizado), sin enviar nada
cv summarize -s backend --provider openai --yes    # remoto explícito, confirmado por adelantado
```

- Escribe `output/revision-summarize-<fecha>[-<esp>][-<oferta>].md` con dos o tres propuestas verificadas en modo síntesis: se rechaza toda cifra o entidad que no esté en el perfil y toda propuesta que no mencione ninguno de los hechos clave. Copia la que prefieras al `summary` de `profile.md` o de la especialidad, o aplícala con [`cv improve apply`](./improve-apply).
