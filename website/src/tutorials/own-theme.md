---
title: 3 · Tu propio tema
verify:
  - themes/mio/theme.toml
  - themes/mio/template.typ
  - cv.toml
---
# Tutorial 3 · Tu propio tema

Un tema es un directorio `themes/<nombre>/` con dos ficheros: `theme.toml` (colores, tipografías, tamaños, espaciados y página, validados antes de arrancar Typst) y `template.typ` (la maquetación). Vas a crear el tuyo a partir de `classic`, cambiar un color, fijarlo como tema por defecto del proyecto y generar el PDF con Typst.

## 1. Typst, una sola vez

```bash
cv typst install    # descarga el release oficial 0.15.1, verifica su SHA-256 y lo instala en tu caché de usuario
```

Es la única operación de red de `cv`. Después:

```bash tutorial needs-typst
cv typst status
```

## 2. El proyecto y los temas disponibles

```bash tutorial
cv init
cv build
cv theme list
```

Dos temas distribuidos: `default` (Source Sans 3, jerarquía sobria) y `classic` (serif, cabecera centrada, aire académico).

## 3. Crea el tuyo a partir de `classic`

```bash tutorial
cv theme create mio --from classic
ls themes/mio
cv theme list
```

`themes/mio/theme.toml` lleva ya el nuevo nombre; `template.typ` es una copia de la maquetación de `classic`. Ahora `mio` aparece como tema del proyecto.

## 4. Cambia una variable de diseño

Abre `themes/mio/theme.toml` con tu editor y cambia el color principal, o hazlo desde la terminal:

```bash tutorial
sed -i -E 's/^primary = "#[0-9a-fA-F]{6}"/primary = "#7a1f1f"/' themes/mio/theme.toml
grep -n 'primary' themes/mio/theme.toml
```

Una clave desconocida, un color que no sea `#rrggbb` o un tamaño fuera de rango se rechazan con la ruta del error (`colors.primary: …`) antes de arrancar Typst: `cv theme list` te lo diría.

## 5. Fíjalo como tema por defecto y anula un valor sin tocar el tema

`cv.toml`, en la raíz del proyecto, elige el tema por defecto y puede **anular** valores del `theme.toml` solo para esa ejecución, con el mismo vocabulario y la misma validación:

```bash tutorial
cat > cv.toml <<'EOF'
[theme]
name = "mio"

[theme.sizes]
name = 22
EOF
cv theme list
```

## 6. Genera con Typst

```bash tutorial needs-typst
cv generate-cv -s backend --format pdf --engine typst
cv generate-cv -s backend --format pdf --engine typst --theme classic -o output/classic.pdf
cv generate-cv -s backend --format pdf --engine typst --explain -o output/mio-explain.pdf
ls output
```

El primero usa `mio` (por `cv.toml`); el segundo fuerza `classic` con `--theme`, que prevalece; `--explain` dice qué tema se usa y qué claves anula `cv.toml`. Los dos PDF maquetan exactamente el mismo contenido.

## 7. Cambiar la maquetación

Para ir más allá de las variables, edita `themes/mio/template.typ`: debe exportar `cv(d, theme)`, que recibe la vista estructurada del perfil y el tema ya validado. Typst se ejecuta contenido (sin red, `--root` limitado al tema, límites de tiempo y memoria), así que una plantilla solo puede leer lo que hay en su directorio. Contrato completo y ejemplo mínimo: [Plantillas Typst propias](/design/plantillas-typst).

## 8. Instala un tema de la comunidad

Un tema compartido por otra persona llega como un `.zip` o un `.tar.gz` (o como un directorio). Se instala en `themes/<nombre>/` sin tocar nada más, se ejecuta con la misma contención que los distribuidos y deja su origen y sus huellas a la vista:

```bash
cv theme install https://ejemplo.org/temas/comunidad.zip --sha256 <huella publicada>   # pide confirmación antes de descargar
cv theme install ~/Descargas/comunidad.zip --dry-run                                  # solo el plan
cv theme verify comunidad                                                             # intacto, modificado localmente o sin origen
cv generate-cv -s backend --format pdf --engine typst --theme comunidad
```

La guía [Typst y temas](../guide/typst-themes#temas-de-la-comunidad-cv-theme-install-y-cv-theme-verify) cuenta la política de entradas, los límites y cómo publicar el tuyo.

## Siguiente

[El co-piloto con Ollama](./copilot-ollama): mejoras verificadas por código sobre tus propios logros.
