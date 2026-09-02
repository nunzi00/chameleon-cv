## Ejemplos

```bash
cv drafts adopt cv-lucas --entry exp-acme                    # una entrada, a data/sources/experience/
cv drafts adopt cv-lucas --entry exp-acme --entry edu-ies    # varias de una vez (repetible)
cv drafts adopt cv-lucas --section education                 # toda una sección del borrador
cv drafts adopt cv-lucas --section experience --dry-run      # enseña lo que escribiría, sin escribir
cv build                                                     # y recompila cuando lo hayas revisado
```

- Adoptar **añade**: escribe ficheros **nuevos** en `data/sources/` y **no toca ni una fuente tuya**. Cada fichero
  se escribe con la huella `*`, que crea o falla, así que una adopción no puede pisar nada. Deshacerla es borrar el
  fichero.
- El id y el nombre de fichero se toman del borrador si están libres y, si no, se busca el primero que lo esté
  (`exp-acme`, `exp-acme-2`…). Se serializan con los mismos serializadores que `cv import`: lo adoptado es
  indistinguible de lo que ya tenías.
- Antes de tocar el disco se valida el perfil **entero** que quedará. Si no valida, no se escribe nada y se dice
  por qué: unas fuentes que `cv build` rechaza son peor que no adoptar.
- **No es un *merge***: no se mezclan dos versiones de un empleo. Adoptas la que prefieras y, si hace falta, la
  editas después en «Fuentes».
- Solo experiencia, formación y proyectos: son las secciones en las que un fichero es una entrada. Habilidades y
  certificaciones viven en un CSV compartido, y adoptarlas exigiría reescribir un fichero que ya es tuyo.
