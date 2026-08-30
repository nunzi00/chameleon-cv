## Ejemplos

```bash
cv history            # las entradas del histórico de fuentes, de la más reciente a la más antigua
cv history --json     # lo mismo en JSON (id, fecha, acción, origen, ficheros con sus huellas e ids)
```

- Cada `cv improve apply` (y cada `cv history restore`) crea una entrada `output/historial-fuentes/<fecha>-<origen>/` con el fichero entero de cada fuente tal como estaba, un `cambio.json` y actualiza `index.json` (últimas 500 entradas).
- Las copias `.bak` junto a las fuentes ya no se crean: el histórico las sustituye.
