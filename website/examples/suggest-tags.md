## Ejemplos

```bash
cv suggest tags "Migré la plataforma a Kubernetes sin parada"   # etiquetas para un texto, solo del diccionario cerrado
cv suggest tags - < logro.txt                                   # el texto por la entrada estándar
cv suggest tags --untagged --explain                            # para los logros del perfil sin etiquetas, con la evidencia de cada una
cv suggest tags --only exp-acme-1 -s backend                    # acota el diccionario a las tags de una especialidad
```

- El diccionario cerrado son las tags de tus especialidades: lo que no está en él se rechaza (`VIOLATION_CLOSED_DICTIONARY`), `pin` está reservada y cada etiqueta aceptada lleva su evidencia calculada por código (`literal`, `contexto` o `inferida`).
- Por stdout sale la línea lista para pegar al final de la viñeta (`#php #kubernetes`), precedida de `<id>:` cuando se etiquetan logros del perfil; el resto va por stderr y nunca se toca ninguna fuente.
