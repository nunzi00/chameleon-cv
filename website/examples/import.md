## Ejemplos

```bash
cv import perfil.json --dry-run                     # el plan y el auto-chequeo, sin escribir nada
cv import perfil.json                               # regenera data/sources/ (solo si está vacío o no existe)
cv import perfil.json -d data/nuevo                 # a otro directorio de fuentes
cv import perfil.json --replace                     # sustituye las fuentes actuales; las apartadas quedan en data/sources.<fecha-hora>.bak/
cv export | cv import - -d data/copia               # de un proyecto a otro, por la entrada estándar
```

- Es la inversa de `cv build`: regenera `profile.md`, `experience/*.md`, `skills.csv`… con la disposición y las convenciones de `cv init`, y **antes de escribir** vuelve a leer lo generado con el parser real y lo compara con el perfil importado; a la primera diferencia, no escribe nada y dice dónde.
- Nunca escribe sobre fuentes existentes sin `--replace`, y con él renombra el directorio entero como copia (`.bak`, nunca sobrescrita). Después, `cv build` regenera el artefacto.
- Los ids y el orden de los ficheros se conservan; si el perfil traía las entidades en otro orden, avisa. Importar regenera fuentes canónicas: el formato y los comentarios de las fuentes anteriores no se conservan.
- Códigos: 1 con un perfil inválido, irrepresentable o un destino con contenido sin `--replace`; 2 si el fichero no existe o no se puede escribir.
