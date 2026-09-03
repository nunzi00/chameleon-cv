## Ejemplos

```bash
cv improve archive output/revision-improve-2026-08-29-backend.md   # la aparta a output/revisiones-archivadas/
cv improve apply output/revision-improve-2026-08-29-backend.md --no-archive   # aplicar sin que se archive sola
```

- **Mover, no borrar**: el fichero pasa a `revisiones-archivadas/`, junto al directorio en el que estaba. Deja de salir en la lista de revisiones (y en la pantalla web), pero se sigue pudiendo abrir, aplicar, desarchivar y deshacer.
- Una revisión que al aplicarla **no deja nada pendiente** se archiva sola: es lo que quieres el 99 % de las veces, y `--no-archive` lo desactiva para esa ejecución.
- Nunca sobrescribe: si en el destino ya hay una revisión con ese nombre, la que llega toma `-2`, `-3`…
