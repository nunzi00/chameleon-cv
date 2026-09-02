## Ejemplos

```bash
cv duplicates                                  # lo mismo que «cv duplicates list»
cv duplicates list                             # lo que está repetido en data/sources
cv duplicates -d otras/fuentes                 # sobre otro directorio de fuentes
```

- Agrupa las entradas de **tus** fuentes que parecen la misma cosa, con su id y el fichero en el que viven. Solo
  lee: agrupar no fusiona ni borra nada.
- Suele aparecer tras adoptar de varios borradores (`cv drafts adopt`) el mismo empleo contado de dos formas.
- **Un mismo empleo partido en periodos no es un duplicado**: una entrada por etapa comparte empresa pero no
  fechas, y la regla del solapamiento lo respeta.
- Resuelve cada grupo con `cv duplicates resolve <id> --absorb <id>`.
