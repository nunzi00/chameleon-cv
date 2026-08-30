# Brief de diseño · Interfaz clara y moderna para la app (`cv serve`) y la web (portal) — v1

| | |
|---|---|
| **Tarea** | T-8.6 [GUI/WEB] Interfaz clara y moderna (Hito 8, `ROADMAP.md`); encargo del Director de Ingeniería y Producto del 2026-08-30 |
| **Uso** | Punto de partida de una sesión de **Claude Design** (diseño desde cero, sin sincronizar componentes; decisión del Director del 2026-08-30). Este documento se pega como contexto del proyecto de diseño; las pantallas que salgan de ahí las implementa el Director Técnico en la GUI Svelte y en el portal VitePress |
| **Estado** | Brief v1 redactado (2026-08-30); pendiente de la sesión de diseño |

## 0. En una frase

Chameleon CV es una herramienta **local y soberana**: genera CV por especialidad u oferta a partir de fuentes Markdown/CSV del usuario, con un co-piloto de IA local por defecto. La interfaz debe transmitir **claridad, control y confianza**: siempre se ve qué hay, qué va a pasar y qué sale (o no) de la máquina; nada se escribe sin un botón con nombre.

## 1. Público y contexto de uso

- Profesionales técnicos (backend, plataforma, datos, IA) que mantienen su CV como código: valoran la densidad informativa, los atajos y la trazabilidad; leen en español de España (la interfaz es solo es-ES hoy).
- Uso en escritorio (portátil 13–16″, ventana de 1280–1920 px de ancho); modo claro y oscuro (sigue al sistema); sesiones cortas y frecuentes (editar una fuente, generar, comparar con una oferta) y una sesión larga ocasional (revisión del co-piloto).
- La app se sirve desde `http://127.0.0.1:4310` por un binario local; no hay cuentas, ni cookies, ni CDN: **fuentes del sistema o empaquetadas**, sin recursos externos (CSP estricta: `default-src 'none'`, `font-src 'self'`).

## 2. Principios de diseño (derivan de los cánones del producto)

1. **Nada implícito.** Cada acción que escribe (Guardar, Compilar, Generar, Instalar tema, Lanzar trabajo, Aplicar revisión) es un botón con nombre y un resultado visible con la ruta del fichero; lo que solo lee no parece que escriba.
2. **Local por defecto, remoto con consentimiento.** Todo lo que puede salir de la máquina (proveedor remoto, descarga de tema o de oferta por URL) pasa por un diálogo de consentimiento que dice host, límite y coste estimado; el estado «este servidor no envía nada» se ve de un vistazo.
3. **La verdad es el fichero.** Rutas relativas al espacio de trabajo siempre visibles; huellas de concurrencia; el editor no maquilla el Markdown.
4. **Densidad con jerarquía.** Mucha información (informes de decisiones, análisis de oferta, revisiones ítem a ítem) sin ruido: tipografía con escala clara, tablas y listas alineadas, plegables para lo secundario, monoespaciada solo para rutas, comandos y texto literal.
5. **Accesible y con teclado.** Contraste AA, foco visible, `aria-current` en navegación, formularios con etiqueta, diálogos con foco atrapado, tamaños ≥ 14 px en cuerpo.
6. **Rápido y ligero.** Presupuesto del paquete inicial ≤ 30 KB gzip (el editor va en un chunk aparte): nada de bibliotecas de componentes pesadas; CSS propio con tokens.

## 3. Situación actual (lo que hay que superar)

- Barra superior con siete pestañas (Estado · Fuentes · Generar · Co-piloto · Revisiones · Salidas · Ajustes) y contenido a ancho completo en tarjetas blancas sobre gris; formularios en rejilla de cinco columnas; informes en bloques monoespaciados largos (ver `website/src/public/gui/*.png`).
- Tokens actuales (`gui/src/app.css`, 111 líneas): `--cv-bg #f6f7f9`, `--cv-surface #fff`, `--cv-text #1b1b1b`, `--cv-muted #5b6470`, `--cv-border #d8dde3`, `--cv-accent #1f4e79` (azul del tema de CV «default»), `--cv-ok/--cv-warn/--cv-error`, radio 0,5 rem, espaciado 1 rem, `system-ui`; variante oscura. Clases: `cv-app`, `cv-nav`, `cv-main`, `cv-card`, `cv-form`, `cv-field`, `cv-grid`, `cv-split`, `cv-actions`, `cv-button`, `cv-badge`, `cv-notice`, `cv-issues`, `cv-kv`, `cv-tree`, `cv-editor`, `cv-pdf`, `cv-jobs/cv-job`, `cv-review-item/cv-proposal/cv-compare/cv-plan`, `cv-report`, `cv-gate`, `cv-check`, `cv-muted`, `cv-sr-only`.
- Problemas percibidos: sin jerarquía entre «estado del espacio de trabajo» y «acciones»; el flujo principal (fuentes → generar → salida) no se lee como flujo; los informes largos ocupan la pantalla sin resumen; sin panel lateral ni contexto persistente (espacio de trabajo, especialidad activa, estado del co-piloto); las pantallas vacías no orientan.

## 4. Objetivos medibles

- Un usuario nuevo genera su primer PDF desde la interfaz sin leer la guía (recorrido Estado → Generar ≤ 3 clics con la especialidad y el tema visibles).
- El estado del sistema (artefacto al día, Typst, co-piloto, remotos permitidos) cabe en una franja de cabecera y no hace falta ir a Estado para saberlo.
- Cualquier informe largo tiene un **resumen de una línea** y un plegable con el detalle.
- Modo oscuro y claro con contraste AA en todos los componentes; navegación completa por teclado.
- El paquete inicial sigue ≤ 30 KB gzip; sin fuentes externas.

## 5. Arquitectura de información propuesta (app)

Barra lateral izquierda (plegable a iconos) con tres grupos, y una **cabecera de contexto** siempre visible:

| Grupo | Pantallas | Qué hace |
|---|---|---|
| **Perfil** | Fuentes (árbol + editor), Estado del artefacto (validar/compilar, incidencias) | mantener las fuentes y saber si el artefacto está al día |
| **Producir** | Generar (especialidad, oferta —texto, PDF, fichero del espacio de trabajo por desplegable, URL con consentimiento—, formato, motor, tema), Salidas (ficheros de `output/`, visor) | producir y revisar los CV |
| **Co-piloto** | Trabajos (improve/summarize/suggest tags), Revisiones (antes/después, casillas, aplicar), Ajustes (proveedor local, remotos con clave, modelos recomendados por tarea, cuota) | mejorar con IA con consentimiento y verificación |

Cabecera de contexto: nombre del espacio de trabajo y ruta; chips de estado (artefacto al día / obsoleto / sin compilar; Typst; co-piloto local alcanzable; «remotos: no permitidos» o «permitidos»); botón de apagar el servidor; conmutador de tema claro/oscuro/sistema.

## 6. Pantallas: contenido, estados y acciones

Para cada pantalla, el diseño debe cubrir **vacío · cargando · error · éxito** y, donde aplique, **consentimiento**.

1. **Estado**: tarjetas de artefacto (con incidencias listadas por fichero:línea y botón Validar/Compilar), Typst (versión, instalar), co-piloto (proveedor, modelo, alcanzable, botón Comprobar), temas instalados (origen intacto/modificado), exportar/importar el perfil. Vacío: «Sin fuentes: crea el espacio de trabajo» con el comando.
2. **Fuentes**: árbol a la izquierda (carpetas por tipo, badges de incidencias), editor con resaltado a la derecha, barra con ruta, huella y Guardar (deshabilitado si no hay cambios); aviso de conflicto si otro proceso cambió el fichero.
3. **Generar**: formulario por pasos en una tarjeta (1 especialidad · 2 oferta · 3 salida) con vista previa del titular y resumen de la especialidad; resultado a la derecha (PDF en visor o Markdown) con acciones Descargar / Ver en Salidas; «Adecuación a la oferta» como panel con barra de porcentaje, tres columnas (demostrados / no demostrados / carencias) y evidencias; «Informe de decisiones» plegado con resumen («9 de 16 ítems, 3 recortes»). Plegable «Temas de Typst» con Crear e Instalar (URL → consentimiento).
4. **Salidas**: lista con tipo, tamaño y fecha; visor de PDF/Markdown; descarga.
5. **Co-piloto**: selector de tarea con su descripción, límites (logros por ejecución, propuestas, longitud), oferta opcional, proveedor (local por defecto; remotos solo con clave y consentimiento con coste estimado); lista de trabajos con progreso, estado y enlace a la revisión; panel «qué sale y a dónde».
6. **Revisiones**: ítem a ítem, original (con `fichero:línea`) frente a propuestas con casillas (las que no pasan la verificación C2 aparecen tachadas con el motivo), plan de aplicación y botón Aplicar.
7. **Ajustes**: proveedor local (proveedor, URL loopback, modelo, Comprobar), remotos (clave presente/ausente, plan, cuota publicada y viva, modelos con tarea recomendada y estado estable/preview), fichero de claves, lista blanca de hosts.

Diálogos: consentimiento (host, límite, coste; Confirmar/Cancelar), conflicto de edición, apagar servidor, sesión caducada (token).

## 7. Sistema visual: dirección

- **Paleta**: neutros fríos (fondo, superficie, borde, texto, texto atenuado) + **un acento** heredado del tema «default» de los CV (`#1f4e79`, oscuro `#6ea8d8`) + semánticos ok/aviso/error con fondo suave. Proponer valores AA para claro y oscuro.
- **Tipografía**: `system-ui` para la interfaz (sin descargas), escala 12/14/16/20/24/32 con interlineado 1,45; monoespaciada solo para rutas, comandos y literales.
- **Espaciado**: rejilla de 8 px (4/8/12/16/24/32/48); radio 8 px (12 en tarjetas grandes); sombras mínimas (1 nivel) o bordes en oscuro.
- **Componentes** (inventario a diseñar, todos con foco y estado deshabilitado): barra lateral + cabecera de contexto; chip de estado; tarjeta; tabla compacta; formulario (campo, selector, casilla, área de texto, subida de fichero); botones (primario, secundario, peligroso, enlace); badge; aviso (info/ok/aviso/error); plegable; pestañas internas; lista de trabajos con progreso; vista de comparación antes/después; visor de PDF enmarcado; árbol de ficheros; editor (marco); diálogo; toast; estado vacío con acción.
- **Iconografía**: SVG en línea propios, monocolor, 16/20 px; nada de fuentes de iconos.

## 8. El portal (web, VitePress)

- Hoy usa el tema por defecto de VitePress con el acento del producto (`website/.vitepress/theme/custom.css`); secciones Guía, Referencia, Tutoriales, Desarrolladores, Cambios; portada con «hero».
- Objetivo: portada que explique en 10 segundos qué es y qué **no** hace (no envía datos, no necesita cuenta), con tres caminos (instalar el binario, Docker, ver la galería de temas), capturas reales de la app nueva y la galería de temas; tipografía y acento coherentes con la app; modo oscuro; sin dependencias nuevas (VitePress admite personalizar tokens `--vp-c-*`, la portada por `layout: home` y componentes Vue propios si hace falta).
- Entregable para el portal: tokens y composición de la portada; el resto de páginas siguen el tema (cambios de tokens y de bloques destacados).

## 9. Restricciones técnicas para el diseño

- Svelte 5 + CSS propio (sin Tailwind ni bibliotecas de componentes); los diseños deben ser reproducibles con clases y tokens CSS (variables `--cv-*`).
- Sin recursos externos: fuentes del sistema o ficheros locales; imágenes SVG en línea.
- Textos en español de España; longitudes reales (rutas largas, nombres de modelo como `openai/gpt-oss-120b`, informes de 100 líneas).
- Ancho mínimo soportado 1024 px; el árbol/editor y el visor deben convivir a 1280 px.

## 10. Qué esperamos de la sesión de Claude Design

1. Sistema visual: tokens (claro/oscuro) y los componentes del inventario de §7 con sus estados.
2. Las siete pantallas de §6 en sus estados principales (vacío, éxito, error, consentimiento) a 1440 px, más la variante plegada de la barra lateral.
3. Portada del portal y una página interior con los tokens aplicados.
4. Exportación: HTML/CSS de referencia (o JSX) por pantalla y una hoja de tokens; con eso el Director Técnico implementa en `gui/` y `website/` por sprints (S1 sistema visual y cabecera/barra; S2 Estado, Fuentes, Generar, Salidas; S3 Co-piloto, Revisiones, Ajustes; S4 portal), cada uno con pruebas (Vitest + Playwright) y capturas regeneradas para la guía.

## 11. Prompts sugeridos para Claude Design (en español)

- «Diseña el sistema visual de una app local de escritorio para generar CV: claridad, control y confianza; neutros fríos y un acento azul `#1f4e79`; `system-ui`; rejilla de 8 px; modo claro y oscuro AA. Componentes: [lista de §7].»
- «Diseña la pantalla Generar: formulario por pasos (especialidad, oferta con cuatro orígenes —texto, PDF, fichero del espacio de trabajo en desplegable, URL con consentimiento—, salida) y a la derecha el resultado con visor de PDF y un panel de adecuación a la oferta con barra de porcentaje y tres columnas.»
- «Diseña la pantalla Revisiones del co-piloto: original frente a propuestas con casillas, las rechazadas por la verificación aparecen tachadas con el motivo, y un plan de aplicación con botón Aplicar.»
- «Diseña la portada de un portal de documentación (VitePress) para esta herramienta: qué es, qué no hace, tres caminos de instalación, capturas y galería de temas.»
