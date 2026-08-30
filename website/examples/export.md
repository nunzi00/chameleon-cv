## Ejemplos

```bash
cv export > perfil.json                  # el perfil canónico por la salida estándar
cv export -o copias/perfil-2026.json     # a un fichero (0600), con un resumen por pantalla
cv export | jq '.experience[].company'   # consultarlo con jq
cv export -d ./otras-fuentes             # desde otro directorio de fuentes
```

- Sale de **las fuentes**, no del artefacto: no necesita `cv build` y nunca está desactualizado. Si las fuentes tienen problemas, los muestra todos (como `cv validate`) y no exporta nada (código 1).
- El JSON es exactamente el que `cv build` escribe en `data/dist/profile.json` (mismas claves, mismo orden, dos espacios), así que sirve de copia de seguridad, para editarlo con otras herramientas y para `cv import`.
- Contiene lo que pusiste en `profile.md` (correo, teléfono): sale solo a donde tú lo mandas.
