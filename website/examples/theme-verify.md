## Ejemplos

```bash
cv theme verify comunidad   # intacto, modificado localmente (qué fichero) o sin origen registrado
cv theme verify             # todos los temas de themes/ del proyecto; código 1 si alguno tiene diferencias
cv theme list --verify      # el origen y el estado de cada tema instalado
```

- Recalcula las huellas de `.origin.json`; un tema creado con `cv theme create` o copiado a mano no tiene origen y no es sospechoso. Guía: [Typst y temas](/guide/typst-themes#temas-de-la-comunidad-cv-theme-install-y-cv-theme-verify).
