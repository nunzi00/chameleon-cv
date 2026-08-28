# Tus fuentes de Chameleon CV

Este directorio es tu **dataset**: la única fuente de verdad de tu perfil. `cv init` lo ha creado
con un perfil sintético de ejemplo («Ada Ejemplo») para que veas la forma de cada fichero;
sustituye su contenido por el tuyo.

- `profile.md`: datos personales, idiomas y resumen por defecto.
- `specialties/<id>.md`: una «versión» de tu CV (titular, resumen y vocabulario de etiquetas).
- `experience/<id>.md`, `projects/<id>.md`, `education/<id>.md`: una entidad por fichero, con
  frontmatter YAML y logros como viñetas con `#etiquetas` al final.
- `skills.csv`, `certifications.csv`: tablas planas (`|` separa varios valores).
- `achievements.md`: logros transversales.

Formato completo en `docs/formato-dataset.md` y `docs/formato-csv.md` del proyecto. Este fichero
lo ignora el cargador. Recuerda: aquí hay datos personales; no lo publiques.
