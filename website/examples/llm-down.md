## Ejemplos

```bash
cv llm down          # para el Ollama que arrancó cv (proceso propio o contenedor chameleon-ollama)
cv llm down --json   # el estado tras parar y lo que se hizo
```

- Solo se para lo que arrancó `cv`: un Ollama arrancado por ti se deja como está (salida `2` con el motivo).
- En Docker hace `docker stop`: el contenedor y los modelos descargados se conservan, así que el siguiente `cv llm up` no vuelve a descargar nada.
- Si no hay nada en marcha, lo dice y termina con `0`.
