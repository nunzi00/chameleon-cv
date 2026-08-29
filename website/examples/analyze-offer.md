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
