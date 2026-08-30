## Ejemplos

```bash
cv theme install https://ejemplo.org/temas/comunidad.zip --sha256 <huella>   # anuncia host y límite, pide confirmación, descarga (máximo 8 MiB) y contrasta la huella publicada
cv theme install ~/Descargas/comunidad.tar.gz --as mi-comunidad --dry-run     # solo el plan: entradas, tamaños, huellas y nombre; nada se escribe
cv theme install ../otro-proyecto/themes/mio                                   # un directorio local (sin red, sin pregunta)
cv theme install themes/comunidad.zip --replace                                # aparta el tema anterior a themes/comunidad.<marca>.bak/
cv generate-cv --format pdf --engine typst --theme comunidad                   # se ejecuta contenido, como todos los temas
```

- Solo `https://` (también tras redirecciones) o rutas locales; el archivo se lee en el propio proceso con una política cerrada (un directorio raíz opcional; solo `theme.toml`, `template.typ`, `README.md`, `LICENSE` y `fonts/<nombre>.ttf|otf`; sin `..`, enlaces ni dispositivos; límites de tamaño y de entradas). Deja `themes/<nombre>/.origin.json` con el origen y las huellas. Guía: [Typst y temas](/guide/typst-themes#temas-de-la-comunidad-cv-theme-install-y-cv-theme-verify).
