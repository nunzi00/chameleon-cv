## Ejemplos

```bash
cv validate                      # comprueba data/sources/ y no escribe nada
cv validate -d ./otras-fuentes   # otro directorio de fuentes
```

- Silencioso si todo va bien (código 0). Si hay problemas los muestra **todos** a la vez, con fichero y línea (`experience/acme.md:4: start: Fecha inválida: …`) y termina con código 1.
- `cv build` valida exactamente igual antes de escribir el artefacto; `validate` es para comprobar sin tocar el disco (por ejemplo, en un *hook* de git).
