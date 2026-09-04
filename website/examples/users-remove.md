## Ejemplos

```bash
cv users remove invitado1
```

- **No borra**: renombra el espacio entero a `usuarios/invitado1.<marca>.bak`, el mismo procedimiento que
  `cv import --replace`. Un CV que costó meses no se pierde por una orden.
- Para deshacerlo, vuelve a renombrar la copia a `usuarios/invitado1`.
- Las copias no se listan en `cv users`: son historia, no usuarios.
