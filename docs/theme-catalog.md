# Catálogo de temas: quince estilos y seis organizaciones (T-8.12) — PROPUESTA v1

Estado: APROBADA por el PO (2026-08-30, D1–D4) · Parte 1 (organizaciones) CERRADA el 2026-08-30 · Parte 2 (estilos) IMPLEMENTADA el 2026-08-30 · Parte 3 (ampliación) APROBADA y pendiente

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

## §6 Estado de la implementación

- **Parte 1 (2026-08-30)**: `themes/{chronological,functional,hybrid,skills-first,project-portfolio,one-page}` (plantillas autocontenidas con el bloque común de `default` y su documento propio; `kind = "organization"`, autoría y licencia como los de la galería). `kind` en `ThemeConfigSchema` (`organization` | `style`, opcional; los nueve estilos lo declaran), en el inventario (`ThemeInventoryEntry.kind`), en `cv theme list` (tres grupos con cabecera y resumen con cuentas), en la galería (`## Organizaciones (6)` / `## Estilos (9)`, fichas en H3) y en Generar (`<optgroup>` por grupo; `themeGroups`). La vista estructurada añade `skillGroups[].items[]` y `labels.level/years/levels` para la matriz de `skills-first`. Pruebas: `tests/themes/builtin.test.ts` (quince temas, clase de cada uno, y con Typst real el orden de secciones de cada organización con el perfil del banco, «— Nexo Pagos» en la funcional, nivel traducido en la matriz, una página y marcas «(+N)» en `one-page`), `cv theme list` unitaria y en el arnés (`core`, `theme`), seis generaciones nuevas en `typst`, galería regenerada con capturas.
- Desviaciones respecto a §2: `skills-first` imprime «—» cuando una skill no tiene nivel o años; `one-page` recorta a cinco puestos × cuatro logros, tres proyectos y tres logros destacados y no imprime los resúmenes de puesto/proyecto (documentado en su ficha); la miniatura en el plegable de temas de Generar queda para la parte 2 (necesita servir la captura desde la API).
- **Parte 2 (2026-08-30)**: `themes/{elegant,bold,compact-grid,monochrome,warm,europass-like}` (`kind = "style"`; bloque común de las organizaciones + piezas propias `head`/`title`/`piece`/`skills`/`line-item` sobre el cuerpo cronológico). `europass-like` guarda el título del apartado en un `state` y lo imprime en la columna izquierda de la primera fila (el texto se extrae en orden). Pruebas: la común de los 21 temas, `cv theme list` (21 = 6 + 15), galería (`## Estilos (15)`), seis generaciones más en el arnés `typst`. Desviación: los títulos en mayúsculas (`bold`, `compact-grid`, `monochrome`) y en versalitas (`elegant`) se extraen del PDF en mayúsculas; la prueba común compara en minúsculas, y `minimal` sigue siendo el tema pensado para ATS.
- **Parte 3 (aprobada el 2026-08-30)**: `education-first`, `achievements-first`, `unified-timeline` (fechas ISO en la vista) y `swiss`, `newspaper`, `pastel` → 27 temas; versión 1.8.0.
