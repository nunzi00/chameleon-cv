## Ejemplos

```bash
cv init                          # data/sources/ con el dataset de ejemplo («Ada Ejemplo») y un .gitignore
cv init mi-cv                    # en otro directorio (se crea si no existe)
cv init --template ./mi-dataset  # con un dataset de ejemplo alternativo
```

- Nunca sobrescribe: si `data/sources/` o `.gitignore` ya existen, lista los conflictos y termina con código 2 sin escribir nada.
- Los ficheros se crean con permisos 0600: contienen datos personales. El `.gitignore` excluye `data/dist/` y `output/`.
- Siguiente paso: [`cv build`](./build) y la guía [Formato de las fuentes](/guide/sources).
