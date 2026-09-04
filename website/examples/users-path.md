## Ejemplos

```bash
cv users path lucas                            # /ruta/al/espacio/usuarios/lucas
cd "$(cv users path lucas)"                    # para trabajar ahí directamente
```

- Imprime la ruta y nada más: está pensado para encadenarlo.
- Si el usuario no existe, lo dice y termina con código 2.
