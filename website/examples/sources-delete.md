## Ejemplos

```bash
cv sources delete experience/acme.md --dry-run   # solo dice qué entradas del perfil desaparecerían
cv sources delete experience/acme.md             # las dice y pregunta antes de borrar
cv sources delete experience/acme.md --yes       # sin preguntar (obligatorio en un script)
cv history restore latest experience/acme.md     # y así vuelve
cv build                                         # después, recompila el artefacto
```

- **Se comprueba qué quedaría antes de tocar nada**: el dataset se carga otra vez con esa ruta oculta y, si lo que queda no carga, no se borra nada y se dice por qué. Por eso `cv sources delete profile.md` se rechaza en vez de dejar el espacio de trabajo roto.
- **Se dice qué desaparece del perfil**, entrada a entrada: un fichero de fuentes no siempre aporta lo que uno cree, y enterarse al compilar es tarde.
- **Se puede deshacer**: el fichero entero queda en `output/historial-fuentes/`, así que `cv history restore latest <ruta>` lo devuelve (y la restauración entra a su vez en el histórico). No se deja ninguna copia `.bak` en `data/sources/`.
- Sin terminal interactiva hace falta `--yes`: al revés que en `cv suggest tags --apply`, aquí lo que se decide es **borrar**, y eso no se supone.
