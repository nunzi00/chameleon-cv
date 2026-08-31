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

Hay dos clases de tema (T-8.12), declaradas con `kind` en su `theme.toml`: las **organizaciones** deciden qué se lee primero (la cronología, las competencias, los proyectos o todo en una página) y los **estilos** mantienen la organización cronológica inversa y cambian la maquetación. Se combinan copiando: `cv theme create mio --from functional` y ajustar colores o tipografías en `theme.toml`.

<!-- galería:inicio (bloque generado por npm run docs:themes desde los theme.toml; no editar a mano) -->

## Organizaciones (13)

Cambian el orden y la agrupación de las secciones: qué se lee primero. Elige una por el tipo de proceso al que te presentas.

### `achievements-first`

![Primera página del CV del banco de pruebas con el tema achievements-first](/themes/achievements-first.png)

El impacto primero: logros destacados y el primer logro de cada puesto (con la empresa) en un panel inicial; después la cronología corta, proyectos en una línea, habilidades y formación

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme achievements-first# genera con este tema
cv theme create mio --from achievements-first                     # parte de él en themes/mio/ de tu proyecto
```

### `ats-plain`

![Primera página del CV del banco de pruebas con el tema ats-plain](/themes/ats-plain.png)

Una sola columna sin filetes, sin tablas y con una única tipografía: el formato más digerible para los lectores automáticos de CV (ATS) y para copiar y pegar

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme ats-plain      # genera con este tema
cv theme create mio --from ats-plain                              # parte de él en themes/mio/ de tu proyecto
```

### `chronological`

![Primera página del CV del banco de pruebas con el tema chronological](/themes/chronological.png)

Cronológica inversa con la fecha como eje: el periodo en una columna fija a la izquierda de cada entrada; después habilidades, logros e idiomas

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme chronological  # genera con este tema
cv theme create mio --from chronological                          # parte de él en themes/mio/ de tu proyecto
```

### `education-first`

![Primera página del CV del banco de pruebas con el tema education-first](/themes/education-first.png)

La formación primero: formación y certificaciones abren el CV, después habilidades y proyectos y al final la experiencia completa; para recién titulados, prácticas y cambios de carrera

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme education-first# genera con este tema
cv theme create mio --from education-first                        # parte de él en themes/mio/ de tu proyecto
```

### `functional`

![Primera página del CV del banco de pruebas con el tema functional](/themes/functional.png)

Funcional: competencias por especialidad y logros consolidados (con la empresa de origen) primero; proyectos y trayectoria en una línea por puesto al final

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme functional     # genera con este tema
cv theme create mio --from functional                             # parte de él en themes/mio/ de tu proyecto
```

### `hybrid`

![Primera página del CV del banco de pruebas con el tema hybrid](/themes/hybrid.png)

Híbrida: resumen y competencias clave en un panel sombreado arriba; después la cronología completa con logros, proyectos, formación y certificaciones

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme hybrid         # genera con este tema
cv theme create mio --from hybrid                                 # parte de él en themes/mio/ de tu proyecto
```

### `impact-first`

![Primera página del CV del banco de pruebas con el tema impact-first](/themes/impact-first.png)

Abre con tres cifras de impacto destacadas, tomadas de los logros anclados, y sigue con la cronología completa: para cuando lo primero que debe verse es el resultado

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme impact-first   # genera con este tema
cv theme create mio --from impact-first                           # parte de él en themes/mio/ de tu proyecto
```

### `one-page`

![Primera página del CV del banco de pruebas con el tema one-page](/themes/one-page.png)

Una página: jerarquía tipográfica estricta, márgenes cortos y recortes visibles (cinco puestos con cuatro logros, tres proyectos, tres logros destacados; lo omitido se marca con +N)

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme one-page       # genera con este tema
cv theme create mio --from one-page                               # parte de él en themes/mio/ de tu proyecto
```

### `project-portfolio`

![Primera página del CV del banco de pruebas con el tema project-portfolio](/themes/project-portfolio.png)

Portfolio de proyectos: cada proyecto en una tarjeta con logros y tecnologías en etiquetas; la experiencia en una línea por puesto; después habilidades y formación

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme project-portfolio# genera con este tema
cv theme create mio --from project-portfolio                      # parte de él en themes/mio/ de tu proyecto
```

### `sidebar-left`

![Primera página del CV del banco de pruebas con el tema sidebar-left](/themes/sidebar-left.png)

Organización con columna lateral izquierda: contacto, habilidades, formación, certificaciones e idiomas al margen, y la experiencia y los proyectos en la columna ancha

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme sidebar-left   # genera con este tema
cv theme create mio --from sidebar-left                           # parte de él en themes/mio/ de tu proyecto
```

### `skills-first`

![Primera página del CV del banco de pruebas con el tema skills-first](/themes/skills-first.png)

Skills-first: matriz de competencias por categoría con nivel y años antes que nada; después la experiencia completa, proyectos, logros y formación

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme skills-first   # genera con este tema
cv theme create mio --from skills-first                           # parte de él en themes/mio/ de tu proyecto
```

### `two-column-dense`

![Primera página del CV del banco de pruebas con el tema two-column-dense](/themes/two-column-dense.png)

Dos columnas equilibradas de arriba abajo: la organización más densa del catálogo, pensada para trayectorias largas que deben caber en una o dos páginas

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme two-column-dense# genera con este tema
cv theme create mio --from two-column-dense                       # parte de él en themes/mio/ de tu proyecto
```

### `unified-timeline`

![Primera página del CV del banco de pruebas con el tema unified-timeline](/themes/unified-timeline.png)

Un solo eje temporal: puestos, formación, certificaciones y proyectos ordenados juntos de más reciente a más antiguo, con la etiqueta del apartado bajo el periodo; después habilidades y logros

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme unified-timeline# genera con este tema
cv theme create mio --from unified-timeline                       # parte de él en themes/mio/ de tu proyecto
```

## Estilos (24)

Mantienen la organización cronológica inversa (experiencia → proyectos → habilidades → logros → formación → certificaciones → idiomas) y cambian la maquetación.

### `default` (por defecto)

![Primera página del CV del banco de pruebas con el tema default](/themes/default.png)

Diseño tipográfico de referencia: jerarquía sobria, versalitas en las secciones y fechas alineadas a la derecha

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4

```bash
cv generate-cv --format pdf --engine typst --theme default        # genera con este tema
cv theme create mio --from default                                # parte de él en themes/mio/ de tu proyecto
```

### `academic`

![Primera página del CV del banco de pruebas con el tema academic](/themes/academic.png)

Serif de una columna para trayectorias largas: cabecera centrada, secciones numeradas, fechas al margen y pie con paginación

- **Tipografías**: cuerpo Libertinus Serif · títulos Libertinus Serif · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme academic       # genera con este tema
cv theme create mio --from academic                               # parte de él en themes/mio/ de tu proyecto
```

### `awesome`

![Primera página del CV del banco de pruebas con el tema awesome](/themes/awesome.png)

Estilo Awesome-CV: cabecera centrada con nombre en dos pesos, titular en versalitas de color, secciones con las tres primeras letras en acento y filete, entradas en rejilla 2×2

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme awesome        # genera con este tema
cv theme create mio --from awesome                                # parte de él en themes/mio/ de tu proyecto
```

### `bold`

![Primera página del CV del banco de pruebas con el tema bold](/themes/bold.png)

Titulares grandes de color: nombre en acento con barra lateral, secciones en mayúsculas con subrayado grueso y periodos en pastilla; para producto, marketing, ventas o diseño

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme bold           # genera con este tema
cv theme create mio --from bold                                   # parte de él en themes/mio/ de tu proyecto
```

### `classic`

![Primera página del CV del banco de pruebas con el tema classic](/themes/classic.png)

Serif tradicional de aire académico: cabecera centrada, doble filete, secciones en mayúsculas y cuerpo justificado

- **Tipografías**: cuerpo Libertinus Serif · títulos Libertinus Serif · código DejaVu Sans Mono
- **Papel**: a4

```bash
cv generate-cv --format pdf --engine typst --theme classic        # genera con este tema
cv theme create mio --from classic                                # parte de él en themes/mio/ de tu proyecto
```

### `compact-grid`

![Primera página del CV del banco de pruebas con el tema compact-grid](/themes/compact-grid.png)

Rejilla compacta: periodo y ubicación en una columna estrecha a la izquierda de cada entrada, habilidades y formación en dos columnas, tamaños contenidos; mucha información en poco papel

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme compact-grid   # genera con este tema
cv theme create mio --from compact-grid                           # parte de él en themes/mio/ de tu proyecto
```

### `elegant`

![Primera página del CV del banco de pruebas con el tema elegant](/themes/elegant.png)

Elegante: serif Libertinus, nombre centrado en versalitas, doble filete y títulos de sección entre filetes; sin color, para dirección, consultoría, derecho o academia

- **Tipografías**: cuerpo Libertinus Serif · títulos Libertinus Serif · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme elegant        # genera con este tema
cv theme create mio --from elegant                                # parte de él en themes/mio/ de tu proyecto
```

### `europass-like`

![Primera página del CV del banco de pruebas con el tema europass-like](/themes/europass-like.png)

Estructura tabular al estilo europeo: apartado y periodo en una columna azul a la izquierda, contenido a la derecha, filetes finos; familiar en procesos públicos y europeos

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme europass-like  # genera con este tema
cv theme create mio --from europass-like                          # parte de él en themes/mio/ de tu proyecto
```

### `executive`

![Primera página del CV del banco de pruebas con el tema executive](/themes/executive.png)

Ejecutivo tipo banking: cabecera centrada en serif, logros destacados arriba, fila de competencias clave e impacto en negrita en cada logro

- **Tipografías**: cuerpo Libertinus Serif · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme executive      # genera con este tema
cv theme create mio --from executive                              # parte de él en themes/mio/ de tu proyecto
```

### `gazette`

![Primera página del CV del banco de pruebas con el tema gazette](/themes/gazette.png)

Aire de prensa clásica: nombre entre dos filetes, antetítulo centrado y secciones con doble regla fina; serif en los títulos y sans en el cuerpo

- **Tipografías**: cuerpo Source Sans 3 · títulos Libertinus Serif · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme gazette        # genera con este tema
cv theme create mio --from gazette                                # parte de él en themes/mio/ de tu proyecto
```

### `midnight`

![Primera página del CV del banco de pruebas con el tema midnight](/themes/midnight.png)

Azules profundos sobre papel claro, con el nombre y los títulos en azul noche y las secciones subrayadas por un filete grueso: pensado para leerse en pantalla

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme midnight       # genera con este tema
cv theme create mio --from midnight                               # parte de él en themes/mio/ de tu proyecto
```

### `minimal`

![Primera página del CV del banco de pruebas con el tema minimal](/themes/minimal.png)

Monocromo y sin filetes: jerarquía solo por tamaño y peso, listas planas, sin tablas ni columnas; pensado para los ATS

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme minimal        # genera con este tema
cv theme create mio --from minimal                                # parte de él en themes/mio/ de tu proyecto
```

### `modern`

![Primera página del CV del banco de pruebas con el tema modern](/themes/modern.png)

Contemporáneo: franja de acento en la cabecera, columna lateral con contacto, skills e idiomas, y fechas en pastillas

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme modern         # genera con este tema
cv theme create mio --from modern                                 # parte de él en themes/mio/ de tu proyecto
```

### `mono-grid`

![Primera página del CV del banco de pruebas con el tema mono-grid](/themes/mono-grid.png)

Monoespaciada de arriba abajo con la rejilla a la vista: títulos entre corchetes, periodos alineados y viñetas con guion, con aire de terminal

- **Tipografías**: cuerpo DejaVu Sans Mono · títulos DejaVu Sans Mono · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme mono-grid      # genera con este tema
cv theme create mio --from mono-grid                              # parte de él en themes/mio/ de tu proyecto
```

### `monochrome`

![Primera página del CV del banco de pruebas con el tema monochrome](/themes/monochrome.png)

Monocromo para imprimir: solo negro y grises, reglas gruesas bajo cada sección, enlaces en negro y jerarquía solo por peso y tamaño

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme monochrome     # genera con este tema
cv theme create mio --from monochrome                             # parte de él en themes/mio/ de tu proyecto
```

### `newspaper`

![Primera página del CV del banco de pruebas con el tema newspaper](/themes/newspaper.png)

Aire de periódico: mancheta centrada con doble filete, serif Libertinus y experiencia y proyectos a dos columnas con títulos en versalitas; para comunicación, edición o investigación

- **Tipografías**: cuerpo Libertinus Serif · títulos Libertinus Serif · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme newspaper      # genera con este tema
cv theme create mio --from newspaper                              # parte de él en themes/mio/ de tu proyecto
```

### `pastel`

![Primera página del CV del banco de pruebas con el tema pastel](/themes/pastel.png)

Paleta pastel (lavanda, menta y crema): cabecera sobre un panel lavanda, títulos en cajas de color suave y periodos en pastilla menta; amable y actual

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme pastel         # genera con este tema
cv theme create mio --from pastel                                 # parte de él en themes/mio/ de tu proyecto
```

### `serif-editorial`

![Primera página del CV del banco de pruebas con el tema serif-editorial](/themes/serif-editorial.png)

Estilo editorial en serif: Libertinus para el cuerpo y los títulos, versalitas suaves en las secciones, cifras del periodo en cursiva y un filete fino bajo el nombre

- **Tipografías**: cuerpo Libertinus Serif · títulos Libertinus Serif · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme serif-editorial# genera con este tema
cv theme create mio --from serif-editorial                        # parte de él en themes/mio/ de tu proyecto
```

### `slate`

![Primera página del CV del banco de pruebas con el tema slate](/themes/slate.png)

Grises azulados fríos con los títulos de sección sobre una banda suave: sobrio, legible y sin estridencias, pensado para sectores clásicos

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme slate          # genera con este tema
cv theme create mio --from slate                                  # parte de él en themes/mio/ de tu proyecto
```

### `swiss`

![Primera página del CV del banco de pruebas con el tema swiss](/themes/swiss.png)

Estilo tipográfico internacional: rejilla estricta con los títulos en una columna izquierda en mayúsculas, contenido a la izquierda, mucho aire y un único acento rojo en el nombre

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme swiss          # genera con este tema
cv theme create mio --from swiss                                  # parte de él en themes/mio/ de tu proyecto
```

### `tech`

![Primera página del CV del banco de pruebas con el tema tech](/themes/tech.png)

Skills-first para perfiles técnicos: habilidades primero como etiquetas monoespaciadas, contacto con URL visibles y tecnologías de cada puesto en etiquetas

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme tech           # genera con este tema
cv theme create mio --from tech                                   # parte de él en themes/mio/ de tu proyecto
```

### `terracotta`

![Primera página del CV del banco de pruebas con el tema terracotta](/themes/terracotta.png)

Acento cálido de tierra cocida en el nombre, los títulos y las viñetas, sobre un gris cálido: cercano sin perder formalidad

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme terracotta     # genera con este tema
cv theme create mio --from terracotta                             # parte de él en themes/mio/ de tu proyecto
```

### `timeline`

![Primera página del CV del banco de pruebas con el tema timeline](/themes/timeline.png)

Línea de tiempo: periodos a la izquierda sobre un raíl con puntos, contenido a la derecha; pensado para trayectorias progresivas

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme timeline       # genera con este tema
cv theme create mio --from timeline                               # parte de él en themes/mio/ de tu proyecto
```

### `warm`

![Primera página del CV del banco de pruebas con el tema warm](/themes/warm.png)

Paleta cálida (terracota, ocre y crema): cabecera sobre un panel crema, títulos como etiquetas redondeadas y periodos en pastilla; cercano y legible

- **Tipografías**: cuerpo Source Sans 3 · títulos Source Sans 3 · código DejaVu Sans Mono
- **Papel**: a4
- **Autoría**: Chameleon CV · licencia MIT · [página del tema](https://nunzi00.github.io/chameleon-cv/guide/theme-gallery)

```bash
cv generate-cv --format pdf --engine typst --theme warm           # genera con este tema
cv theme create mio --from warm                                   # parte de él en themes/mio/ de tu proyecto
```

<!-- galería:fin -->

## Contención

Un tema es código Typst y se ejecuta **contenido**: sin red, sin paquetes, sin leer fuera de su directorio, con límites de tiempo y de memoria ([Seguridad y privacidad](./security)). Los temas distribuidos se prueban en cada cambio: cargan, validan, compilan en español e inglés y su plantilla no importa ni lee nada. Las imágenes de esta página se regeneran con `npm run docs:themes` (exige Typst) y se versionan junto al código.
