## Ejemplos

```bash
cv analyze-offer ofertas/acme-backend.txt          # ¿encajo? qué demuestro, qué no y qué me falta
cv analyze-offer ofertas/acme-backend.pdf -s backend   # oferta en PDF (texto extraído en un worker aislado)
cv analyze-offer - < oferta.txt                    # por la entrada estándar
cv analyze-offer ofertas/acme-backend.txt --explain    # auditoría ítem a ítem: qué puntuó cuánto
cv analyze-offer ofertas/acme-backend.txt --json       # para scripts
```

- No genera nada: informa de la adecuación, las evidencias (qué ítems del perfil demuestran cada requisito) y las carencias (lo que la oferta pide y el perfil ni siquiera tiene etiquetado).
- El perfil es el diccionario: la oferta se lee buscando tus tags, nombres y alias de skills. Guía: [Adaptar el CV a una oferta](/guide/offers).

```bash
cv analyze-offer                                  # sin argumento: lista offers/ (código 2; con --list, 0)
cv analyze-offer offers/acme-backend.txt          # fichero de texto o PDF del espacio de trabajo
cv analyze-offer "https://ejemplo.com/oferta" --allow-remote            # URL https: pide confirmación (o --yes)
cv analyze-offer "https://ejemplo.com/oferta" --allow-remote --yes --save-offer   # además la guarda en offers/ con cabecera de origen
```

- Una URL exige `--allow-remote` y confirmación por petición (`--yes` para scripts): una sola descarga https, sin cookies, máximo 2 MB y 15 s; LinkedIn, Jobgether o Manfred se leen por su JSON-LD `JobPosting` y, si su descripción es un resumen, por el contenido de la página (la procedencia sale por stderr y con `--explain`).
- `--save-offer [ruta]` guarda el texto en `offers/` (nombre automático `titulo-empresa.txt`, o la ruta que indiques; `--replace` para sustituir) con una cabecera `# Origen: <url>`.

