## Ejemplos

```bash
cv llm key set openai                       # en la terminal: pregunta la clave sin mostrarla
cat clave.txt | cv llm key set anthropic    # sin terminal: la lee de la entrada estándar
cv llm key set openai < /dev/null           # clave vacía: error, no se escribe nada
```

- La clave nunca se pasa como argumento (quedaría en el historial y en la lista de procesos) ni se imprime; se guarda en tu fichero de claves (`~/.config/chameleon-cv/keys.json`, permisos `0600`, directorio `0700`).
- Si el fichero existe con permisos abiertos o no es JSON válido, no se toca: primero `chmod 600` o corrígelo.
- Una variable `CHAMELEON_<PROVEEDOR>_API_KEY` tiene prioridad sobre el fichero (`cv llm key list` dice cuál manda).
