# Diez temas más (T-8.16) — PROPUESTA v1

Estado: BORRADOR para el PO · Encargo del Director del 31-ago («quiero 10 temas más para los pdfs») · Mecánica de T-8.12

## §1 Reparto propuesto (27 → 37)

**Cuatro organizaciones nuevas** (`kind = "organization"`):
- `sidebar-left`: columna lateral izquierda con contacto/skills/idiomas y flujo principal a la derecha (la maquetación clásica que el importador de T-8.4b ya sabe leer — sirve además de fixture realista).
- `two-column-dense`: dos columnas equilibradas de arriba abajo, pensada para trayectorias largas en una o dos páginas.
- `ats-plain`: una columna, sin filetes ni tablas, tipografía única — el tema «seguro para ATS» explícito (hoy ese papel lo insinúa `minimal`, que es un estilo).
- `impact-first`: abre con tres métricas destacadas (extraídas de los impactos de los logros anclados) y sigue cronológico.

**Seis estilos nuevos** (`kind = "style"`, cuerpo cronológico común):
- `serif-editorial` (Libertinus, títulos con versalitas suaves ≤ 0,08em), `slate` (grises azulados fríos), `terracotta` (acento cálido tierra), `mono-grid` (monoespaciada con rejilla visible, guiño dev), `midnight` (fondo claro, acentos azul noche, pensado para pantalla), `gazette` (tres filetes finos y firma de pie, aire de prensa clásica).

## §2 Reglas (las de T-8.12, sin cambios)

`theme.toml` con autoría/licencia/kind, plantilla autocontenida, prueba común con Typst real en es/en (orden de secciones por organización, una página máxima donde aplique, texto extraíble sin `tracking` abusivo), galería regenerada con capturas, goldens `theme`/`typst` (+10 generaciones), `cv theme list` (37 = 13 + 24).

## §3 Decisiones que se piden al PO

1. **D1** La lista de §1 tal cual (o los cambios que prefieras).
2. **D2** Entrega en una sola parte (los cimientos de T-8.12 hacen el coste marginal pequeño).
3. **D3** Versión: 1.10.0.
