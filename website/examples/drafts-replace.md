## Ejemplos

```bash
cv drafts replace mi-cv --dry-run              # qué escribiría, sin escribir nada
cv drafts replace mi-cv                        # el borrador ENTERO pasa a ser tus fuentes
cv drafts replace mi-cv --yes                  # sin preguntar (para guiones)
cv build
```

- Es el otro camino de `cv drafts adopt`: aquel **añade** entradas a un perfil que ya es tuyo; este **sustituye**
  el perfil entero por el del borrador. Lo necesita quien estrena su espacio con un CV que ya tenía.
- Trae lo que `adopt` no puede: tu **nombre**, tu **titular**, tu **contacto** y tus **habilidades**. No son
  entradas sueltas —viven en `profile.md` y en `skills.csv`—, y por eso marcarlas una a una no era posible.
- **No borra nada**: tus fuentes de ahora se apartan enteras como `data/sources.<marca>.bak`. Volver es
  renombrarlas.
- Si el borrador **no compila**, no se escribe nada y se dice qué le pasa; si no existe, se dice eso otro.
- En la web es el botón «Usar este borrador como mis fuentes» de la pantalla **Borradores**.
