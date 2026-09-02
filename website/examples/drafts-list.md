## Ejemplos

```bash
cv drafts                                      # lo mismo que «cv drafts list»
cv drafts list                                 # los borradores de import/ con lo que reconoció cada uno
```

- Una fila por borrador: de qué fichero salió, cuántas experiencias, formaciones y proyectos reconoció, y cuántos
  avisos y líneas sin situar dejó en su `README.md`.
- Las cuentas son **del borrador**, no de tu perfil: `cv import-cv` nunca escribe en `data/sources/`. Para llevarte
  algo, `cv drafts adopt`.
- Un borrador que no carga sale marcado con su motivo y no tumba la lista: es justo el que hay que ir a corregir.
- Las copias que deja `--replace` (`import/<nombre>.<marca>.bak/`) no se listan: son historia, no borradores.
