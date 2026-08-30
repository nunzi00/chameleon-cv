# Entrega de diseño de la interfaz (T-8.6)

Exportación del proyecto de Claude Design «Chameleon CV» (30-ago-2026), origen de la implementación del rediseño.
El brief que la originó es `docs/gui-design-brief.md`; el estado de cada sprint se lleva en `ROADMAP.md` (T-8.6).

| Fichero | Qué es | Dónde vive en el repositorio |
| --- | --- | --- |
| `pantallas.md` | Especificación de las nueve pantallas (rejillas, estados, diálogos) y de la portada del portal. | Este directorio (referencia de S2–S4). |
| `plan-sprints.md` | Reparto S1–S4 con pruebas y criterio de aceptación por sprint. | Este directorio. |
| `tokens.css` | Tokens del sistema visual (claro y oscuro). | Integrado en `gui/src/app.css` (bloque «Tokens»). |
| `componentes.css` | Clases `cv-*` de referencia. | Integrado en `gui/src/app.css` (bloque «Componentes»). |
| `Chameleon CV.dc.html`, `support.js` | Prototipo navegable y su motor; solo referencia visual, no van al repositorio. | Fuera del repositorio (`~/Documents/chameleon-design/`). |

Decisiones pendientes de la entrega (README de la exportación): diálogo de sesión caducada (S3), variantes a 1024 px
de Fuentes y Generar (S2), conjunto de datos real para las capturas (S2) y miniaturas de los temas en el plegable
de Generar (S2).
