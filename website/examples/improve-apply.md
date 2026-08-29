## Ejemplos

```bash
cv improve apply output/revision-improve-2026-08-29-backend.md --dry-run   # el plan, sin escribir nada
cv improve apply output/revision-improve-2026-08-29-backend.md             # aplica lo marcado [x]: .bak previa, huella comprobada
cv improve apply output/revision-summarize-2026-08-29.md --delete-review   # también las revisiones de summarize; borra la revisión al terminar
cv build                                                                   # después, recompila el artefacto
```

- Es la única orden que escribe en `data/sources/`, con cuatro garantías: solo lo marcado (una propuesta por ítem), cambio mínimo (solo el texto del logro o el resumen; `#hashtags`, metadatos y el resto del fichero quedan byte a byte iguales), copia `<fichero>.bak` previa (nunca se sobrescribe una copia: `.bak.1`, `.bak.2`…) y comprobación por huella: si el original ya no está tal cual, no escribe nada y te lo dice.
