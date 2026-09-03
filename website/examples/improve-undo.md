## Ejemplos

```bash
cv improve undo output/revision-improve-2026-08-29-backend.md   # las fuentes vuelven a como estaban antes de aplicarla
cv build                                                        # después, recompila el artefacto
```

- Deshace **la última aplicación de esa revisión**, no «lo último que pasó»: si entre medias aplicaste otra revisión a otro fichero, esa se queda como está.
- Escribe en `data/sources/` y, como todo lo que escribe ahí, pasa por el histórico: la versión que había queda guardada como una entrada `restore`, así que **deshacer el deshacer también es posible** (`cv history`).
- Si las fuentes ya estaban como antes de aplicar, no cambia nada y te lo dice; no añade una entrada vacía al histórico.
- Si editaste esas fuentes a mano después de aplicar, ese trabajo se va (queda en el histórico, no se pierde).
