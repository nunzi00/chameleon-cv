## Ejemplos

```bash
cv users create invitado1                      # sembrado con el dataset de ejemplo, como «cv init»
cv users create invitado1 --empty              # sin nada dentro: las fuentes las traes tú
cv users create lucas --adopt                  # trae a este usuario lo que ya hay en la raíz
```

- Crea `usuarios/<id>/`, un espacio de trabajo completo: sus fuentes, su artefacto, sus salidas, su historial y sus
  revisiones. Trabaja con él con `cv --user <id> <orden>`.
- `--adopt` **traslada** `data`, `output`, `import`, `offers` y `revisiones` de la raíz al usuario nuevo, un
  renombrado por directorio: ni un byte se reescribe. Es cómo se convierte un espacio de una persona en el primero
  de varios. `cv.toml` y `themes/` se quedan en la raíz: son del espacio de trabajo.
- Nunca pisa un usuario que ya exista.
- El identificador admite minúsculas, dígitos y guiones, sin empezar ni terminar en guión: es a la vez un nombre de
  directorio y un valor de cabecera HTTP, y no puede salir de `usuarios/`.
