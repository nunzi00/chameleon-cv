# Catálogo de temas: quince estilos y seis organizaciones (T-8.12) — PROPUESTA v1

Estado: PROPUESTA (2026-08-30) · Encargo del Director · Pendiente de aprobación del PO

## §0 Encargo

Director, 2026-08-30: «quiero al menos 15 temas de PDF, y 6 tipos de organización de CV como temas».

## §1 Qué hay hoy

Nueve temas Typst integrados (`academic`, `awesome`, `classic`, `default`, `executive`, `minimal`, `modern`, `tech`,
`timeline`), todos con la misma **organización** (cronológica inversa: experiencia → proyectos → skills →
logros → formación → certificaciones → idiomas) y variando solo el estilo. El contrato `cv(d, theme)` recibe la
`StructuredView` entera: un tema puede reordenar y agrupar secciones libremente.

## §2 Propuesta

1. **Seis organizaciones** como temas nuevos, cada una con un propósito distinto y documentado en su ficha:
   - `chronological` (la de hoy, explícita), `functional` (competencias y logros agrupados por especialidad
     primero; la experiencia, compacta al final), `hybrid` (resumen + skills clave arriba, cronología después),
     `skills-first` (matriz de skills por categoría con nivel/años, luego experiencia), `project-portfolio`
     (proyectos como protagonistas con tecnologías y enlaces; experiencia en una línea por puesto) y
     `one-page` (todo en una página con jerarquía tipográfica estricta y recortes visibles).
2. **Estilos hasta llegar a quince o más**: además de los nueve actuales, `elegant` (serif, filetes finos),
   `bold` (titulares grandes de color), `compact-grid` (dos columnas de datos), `monochrome` (solo negro y grises,
   pensado para imprimir), `warm` (paleta cálida), `europass-like` (estructura tabular al estilo europeo). Con
   las seis organizaciones, el catálogo pasa a **21 temas**.
3. Cada tema: `theme.toml` (autor, licencia, colores, fuentes del sistema), `template.typ` autocontenido,
   ficha en la galería con captura, prueba común de compilación con Typst real (`tests/themes/builtin.test.ts`) y
   comprobación de que el texto extraído del PDF conserva los apartados (nada de `tracking` ni trucos ATS).
4. La pantalla Generar y `cv theme list` agrupan por **organización** y **estilo** (metadato `kind` en
   `theme.toml`: `organization` o `style`), y el plegable de temas muestra la miniatura.

## §3 Fuera de alcance

Fuentes descargadas; temas con imágenes/fotos; editor visual de temas.

## §4 Pruebas

Prueba común con los 21 temas (compilación, una página máxima para `one-page`, secciones presentes en el texto
extraído), galería regenerada (`npm run docs:themes`), arnés `theme` con `cv theme list` (21 temas) y `typst`
con una generación por organización; goldens regenerados.

## §5 Decisiones que se piden al PO

1. **D1** Las seis organizaciones anteriores y los seis estilos propuestos (21 temas en total).
2. **D2** Metadato `kind` en `theme.toml` (obligatorio en los integrados, opcional en los del proyecto).
3. **D3** Entrega en dos partes: organizaciones (más valor) y después estilos.
4. **D4** Versión 1.8.0.
