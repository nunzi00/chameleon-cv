---
title: Galería de temas
---
# Galería de temas

Los temas distribuidos con Chameleon CV, tal como maquetan el CV completo del banco de pruebas con `--engine typst`: la primera página de cada uno, generada con Typst en el repositorio. El portal no compila nada en línea; para ver un tema con **tus** datos, genera en tu máquina:

```bash
cv typst install                                              # una sola vez: descarga y verifica el binario
cv generate-cv --format pdf --engine typst --theme academic   # cualquiera de los temas de abajo
cv theme list                                                 # nombre, origen, descripción, autoría y licencia
```

Todos maquetan exactamente el mismo contenido y admiten las mismas anulaciones desde `cv.toml` (colores, tipografías, tamaños, espaciados, papel y márgenes: [Typst y temas](./typst-themes)). Para adaptar uno, `cv theme create mio --from <tema>` copia sus ficheros a `themes/mio/` de tu proyecto.

<!-- galería:inicio (bloque generado por npm run docs:themes desde los theme.toml; no editar a mano) -->

## `default` (por defecto)

![Primera página del CV del banco de pruebas con el tema default](/themes/default.png)

Diseño tipográfico de referencia: jerarquía sobria, versalitas en las secciones y fechas alineadas a la derecha

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4

```bash
cv generate-cv --format pdf --engine typst --theme default        # genera con este tema
cv theme create mio --from default                                # parte de él en themes/mio/ de tu proyecto
```

## `academic`

![Primera página del CV del banco de pruebas con el tema academic](/themes/academic.png)

Serif de una columna para trayectorias largas: cabecera centrada, secciones numeradas, fechas al margen y pie con paginación

- **Tipografías**: cuerpo Libertinus Serif · títulos Libertinus Serif · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme academic       # genera con este tema
cv theme create mio --from academic                               # parte de él en themes/mio/ de tu proyecto
```

## `awesome`

![Primera página del CV del banco de pruebas con el tema awesome](/themes/awesome.png)

Estilo Awesome-CV: cabecera centrada con nombre en dos pesos, titular en versalitas de color, secciones con las tres primeras letras en acento y filete, entradas en rejilla 2×2

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme awesome        # genera con este tema
cv theme create mio --from awesome                                # parte de él en themes/mio/ de tu proyecto
```

## `classic`

![Primera página del CV del banco de pruebas con el tema classic](/themes/classic.png)

Serif tradicional de aire académico: cabecera centrada, doble filete, secciones en mayúsculas y cuerpo justificado

- **Tipografías**: cuerpo Libertinus Serif · títulos Libertinus Serif · código DejaVu Sans Mono
- **Papel**: a4

```bash
cv generate-cv --format pdf --engine typst --theme classic        # genera con este tema
cv theme create mio --from classic                                # parte de él en themes/mio/ de tu proyecto
```

## `executive`

![Primera página del CV del banco de pruebas con el tema executive](/themes/executive.png)

Ejecutivo tipo banking: cabecera centrada en serif, logros destacados arriba, fila de competencias clave e impacto en negrita en cada logro

- **Tipografías**: cuerpo Libertinus Serif · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme executive      # genera con este tema
cv theme create mio --from executive                              # parte de él en themes/mio/ de tu proyecto
```

## `minimal`

![Primera página del CV del banco de pruebas con el tema minimal](/themes/minimal.png)

Monocromo y sin filetes: jerarquía solo por tamaño y peso, listas planas, sin tablas ni columnas; pensado para los ATS

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme minimal        # genera con este tema
cv theme create mio --from minimal                                # parte de él en themes/mio/ de tu proyecto
```

## `modern`

![Primera página del CV del banco de pruebas con el tema modern](/themes/modern.png)

Contemporáneo: franja de acento en la cabecera, columna lateral con contacto, skills e idiomas, y fechas en pastillas

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme modern         # genera con este tema
cv theme create mio --from modern                                 # parte de él en themes/mio/ de tu proyecto
```

<!-- galería:fin -->

## Contención

Un tema es código Typst y se ejecuta **contenido**: sin red, sin paquetes, sin leer fuera de su directorio, con límites de tiempo y de memoria ([Seguridad y privacidad](./security)). Los temas distribuidos se prueban en cada cambio: cargan, validan, compilan en español e inglés y su plantilla no importa ni lee nada. Las imágenes de esta página se regeneran con `npm run docs:themes` (exige Typst) y se versionan junto al código.
