## Ejemplos

```bash
cv theme create mio                  # themes/mio/ a partir de default
cv theme create mio --from classic   # a partir de classic (theme.toml con el nuevo nombre, template.typ y fonts/ si los hay)
cv generate-cv -s backend --format pdf --engine typst --theme mio
```

- Nunca sobrescribe; avisa si el nuevo tema oculta a uno distribuido. Tutorial: [Tu propio tema](/tutorials/own-theme).
