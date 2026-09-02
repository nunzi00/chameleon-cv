## Ejemplos

```bash
cv duplicates resolve edu-ciclo --absorb edu-piringalla             # se queda la primera y absorbe la otra
cv duplicates resolve edu-ciclo --absorb edu-a --absorb edu-b       # absorbe varias (repetible)
cv duplicates resolve edu-ciclo --absorb edu-piringalla --dry-run   # enseña el plan sin tocar nada
cv history restore latest education/cs-administrador.md             # deshacer: la borrada vuelve
```

- La entrada que eliges **se queda** y toma de las otras **solo los datos que le faltan**; las absorbidas se
  borran. Es lo que arregla el caso normal: una mitad trae las fechas y «Centro pendiente», la otra el centro de
  verdad y ninguna fecha.
- **Nunca se pisa un valor que la elegida ya tenía.** Si la otra trae uno distinto, se dice cuál se conserva y
  cuál se descarta: no se pierde en silencio.
- «Empresa pendiente» y «Centro pendiente» cuentan como **hueco**, no como valor: son la marca que escribe el
  importador cuando no reconoció el dato.
- Los logros, tecnologías y etiquetas se **añaden sin repetir**; un logro absorbido entra con un id libre.
- Antes de escribir se valida el perfil **entero**: si no valida, no se toca nada y se dice por qué.
- Todo lo escrito y lo borrado queda en `output/historial-fuentes/`, así que `cv history restore` lo deshace.
  Después, `cv build`.
