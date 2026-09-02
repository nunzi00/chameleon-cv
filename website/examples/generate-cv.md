## Ejemplos

```bash
cv generate-cv --specialty backend            # output/cv-<nombre>-backend.md
cv generate-cv                                # CV completo, sin selección
cv generate-cv -s backend --explain           # además, explica en stderr qué se incluyó y por qué
cv generate-cv -s backend --stdout            # imprime el Markdown en lugar de escribir un fichero
cv generate-cv -s backend --format pdf        # output/cv-<nombre>-backend.pdf (pdfkit, fuente embebida)
cv generate-cv -s backend --format pdf --engine typst --theme classic   # PDF de calidad editorial con Typst
cv generate-cv -s backend --format odt        # documento abierto, para seguir editándolo a mano
cv generate-cv -f ofertas/acme.txt -s backend --top-n 4 --max-skills 12 # afinado a una oferta y recortado
cv generate-cv -f - --compact < oferta.txt    # oferta por la entrada estándar, preset de una página
cv generate-cv -t mi-plantilla.hbs -l en      # plantilla Handlebars propia, en inglés
cv generate-cv --build -s backend             # recompila el artefacto antes de generar
```

- El nombre del fichero es `cv-<nombre>[-<especialidad>][-<oferta>].md|pdf|odt`; `-o` lo cambia.
- **`--format odt`** da un **documento abierto** (OpenDocument) que abren LibreOffice, Word y Google Docs. Es la
  salida para **seguir editándolo**: usa estilos con nombre, así que cambias el aspecto de todas las secciones
  tocando uno solo. `--engine`, `--theme` y `--template` no aplican; su aspecto se ajusta en el propio documento.
- `--theme` y `--typst-path` solo tienen sentido con `--engine typst`; `--template` y `--stdout`, solo con Markdown.
- Guías: [Generar el CV](/guide/generate), [Adaptar el CV a una oferta](/guide/offers), [Typst y temas](/guide/typst-themes).
