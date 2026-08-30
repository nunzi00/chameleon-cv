## Ejemplos

```bash
cv history restore latest experience/acme.md    # vuelve a la última versión guardada de esa fuente
cv history restore 20260830T181205123Z-revision-improve experience/acme.md
cv build                                        # recompila el artefacto con la fuente restaurada
```

- Escribe en `data/sources/` (acción explícita, como `cv improve apply`); la versión que había queda a su vez en el histórico como una entrada `restore`, así que restaurar nunca pierde nada.
