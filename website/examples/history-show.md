## Ejemplos

```bash
cv history show latest experience/acme.md                              # la última versión guardada de esa fuente
cv history show 20260830T181205123Z-revision-improve experience/acme.md # una entrada concreta (id de «cv history»)
cv history show latest experience/acme.md > /tmp/antes.md && diff /tmp/antes.md data/sources/experience/acme.md
```

- Imprime el fichero tal como estaba antes de aquella aplicación o restauración; no escribe nada.
