## Ejemplos

```bash
cv build                         # data/dist/profile.json (0600), silencioso si todo va bien
cv build --check                 # no escribe: falla si las fuentes tienen problemas o el artefacto no está al día (CI)
cv build -o /tmp/perfil.json     # otra ruta para el artefacto
cv build -v                      # cuenta lo que ha cargado
```

- Es la puerta de calidad del perfil —el `tsc` de tus datos—: todos los errores a la vez, con fichero y línea.
- El artefacto se escribe de forma atómica y se **re-valida** cada vez que otro comando lo lee.
- Si editas las fuentes y olvidas recompilar, `generate-cv` y `analyze-offer` te avisan; con `--build` recompilan ellos antes de trabajar.
