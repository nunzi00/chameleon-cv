# Pantallas: contenido, medidas y estados

Referencia visual: `Chameleon CV.dc.html` (prototipo navegable; conmutador de estados abajo a la izquierda).
Todas las medidas son las del prototipo a **1440 px** de ancho. Ancho mínimo soportado: **1024 px**
(por debajo de 1280 px la comparación antes/después pasa a una columna; por debajo de 1024 px la barra
lateral queda plegada de forma permanente).

Reglas transversales:

- Toda escritura es un botón con nombre + resultado visible con **la ruta del fichero**.
- Todo informe largo tiene **resumen de una línea** en el `<summary>` y el detalle plegado.
- Rutas, comandos, huellas, nombres de modelo y literales: **siempre monoespaciada**, nunca el cuerpo.
- Los estados de error dicen explícitamente **qué NO se ha escrito**.
- Cuerpo mínimo 12,5 px (metadatos) / 13,5 px (texto normal). Nada por debajo de 11,5 px.

---

## Armazón (todas las pantallas de la app)

`grid-template-columns: 232px 1fr` (plegada: `58px 1fr`), `height: 100vh`, `overflow: hidden`.
Columna derecha: `flex-direction: column` con cabecera fija (`flex: none`) y `main` con `overflow: auto`.

### Barra lateral (`.cv-nav`)

Padding 14px 10px, `gap: 2px`. Marca arriba (icono 22px + «Chameleon CV» 14px/600).
Cuatro grupos con encabezado 11px/600, `letter-spacing: .08em`, mayúsculas, color `--cv-muted`:

| Grupo | Ítems |
|---|---|
| Perfil | Fuentes · Estado del artefacto |
| Producir | Generar · Salidas |
| Co-piloto | Trabajos · Revisiones (contador «2») · Ajustes |
| Portal | Portada · Guía (interior) |

Ítem: alto 33px (padding 8px), radio 7px, icono 17px monocolor `currentColor`, texto 13,5px.
Reposo `background: transparent`; hover `--cv-surface-2`; activo `--cv-accent-soft` + texto `--cv-accent`
y `aria-current="page"`. Al final, «Plegar a iconos» (12,5px, `--cv-muted`).
Plegada: solo iconos centrados; el texto del ítem se oculta y el `title` hace de tooltip accesible.

### Cabecera de contexto (`.cv-header`)

Alto 56px a 1440 px, padding 10px 20px, `gap: 14px`, fondo `--cv-surface`, borde inferior 1px.
Orden: nombre del espacio (13,5px/600) + ruta (11,5px mono, `--cv-muted`, con elipsis) · separador 1×26px ·
grupo de chips (`flex-wrap: wrap; min-width: 0`) · espaciador · conmutador de tema · botón «Apagar».

Chips: «Artefacto al día» (ok), «Typst 0.12.0» (neutro), «Co-piloto local · `qwen2.5:14b`» (neutro),
«Remotos: no permitidos» (quiet, con icono de escudo). El chip de artefacto tiene tres variantes:
`al día` (ok) · `obsoleto` (warn) · `sin compilar` (neutro).

**Crítico:** el conmutador de tema y «Apagar» llevan `flex: none; white-space: nowrap`; el grupo de chips
es el único que encoge y envuelve. Sin esto, a anchos pequeños se recorta la etiqueta «Oscuro».

---

## 1 · Estado del artefacto

**Propósito:** saber si el perfil está listo para generar, y arreglarlo si no.
**Layout:** una columna, `.cv-page` (padding 22px 24px 60px, `max-width: 1180px`).
Rejilla `1.35fr 1fr`, `gap: 14px`, `align-items: start`. Cuatro tarjetas: Artefacto (grande, ocupa la
primera celda), Typst + Co-piloto (apiladas en la segunda), Temas instalados, Portabilidad.

- **Título:** «Estado del artefacto» 22px/600, `letter-spacing: -.01em`; a su lado «v0.9.3 · compilado hace 6 min» 13px `--cv-muted`.
- **Artefacto:** título 15px/600 + badge `al día` + ruta `data/dist/profile.json` alineada a la derecha (11,5px mono).
  `dl.cv-kv` con Fuentes («31 ficheros · 0 incidencias»), Especialidades (chips píldora 12px:
  backend, plataforma, datos, engineering-manager) y Huella (`sha256:4f19c8a2…d7b1`).
  Acciones: **Compilar** (primario) · **Validar** (secundario) + nota «Escribe en `data/dist/`».
- **Typst:** badge con la versión + ruta de instalación + «Reinstalar…».
- **Co-piloto:** badge `alcanzable` + proveedor/URL/modelo en `cv-kv` + «Comprobar».
- **Temas instalados:** tabla compacta `1fr auto auto` (Tema · Origen · Estado); `default` (integrado, intacto),
  `classic` (integrado, intacto), `nunzi-dark` (`themes/nunzi-dark/`, **modificado** en `--cv-warn`).
- **Portabilidad:** párrafo + «Exportar perfil (JSON)» y «Importar perfil…» (el import muestra plan antes de escribir).

**Vacío:** centrado, `max-width: 560px`. Icono 56px en caja con borde, «Sin fuentes todavía»,
explicación con `data/sources/`, bloque de comando `$ cv init` con botón «Copiar», y dos acciones:
«Volver a comprobar» (primario) · «Importar un perfil JSON…».

**Cargando:** spinner 16px + «Consultando el estado del espacio de trabajo…» (`aria-live="polite"`),
y esqueletos con la misma rejilla y altura que el éxito (196px / 2×91px), `cvpulse 1.4s` desfasado 0/.2/.4s.

**Error:** aviso rojo arriba: «3 problemas en las fuentes: el artefacto no se ha compilado» +
«Ninguna fuente se ha modificado». Lista de incidencias con enlace `fichero:línea` en mono
(`achievements.csv:42`, `experience/acme.md:8`, `skills.csv:117`) y su motivo.
Acciones: «Abrir la primera en Fuentes» (primario) · «Volver a validar».
Debajo, la tarjeta Artefacto con badge `obsoleto` y la fecha de la última compilación válida.

---

## 2 · Fuentes

**Propósito:** mantener las fuentes; la verdad es el fichero.
**Layout:** `grid-template-columns: 288px 1fr`, altura completa, ambas columnas con scroll propio.

- **Árbol (izquierda):** cabecera con filtro (input 12,5px) + botón «+» 30×30. Carpetas por tipo
  (`experience/`, `projects/`, y ficheros raíz `achievements.csv`, `skills.csv`, `profile.md`).
  Fichero: 12,5px mono, radio 6px; activo `--cv-accent-soft`; con incidencias, badge rojo con el número
  a la derecha (`globex.md` → 2). Pie: «31 ficheros · 2 con incidencias».
- **Barra del editor:** ruta relativa completa (12,5px mono) · huella `sha256:9c02…41ae` (11,5px mono, atenuada) ·
  espaciador · «cambios sin guardar» en `--cv-warn` · **Guardar** (primario, deshabilitado si no hay cambios) ·
  «Descartar» (deshabilitado en reposo).
- **Editor:** rejilla `44px 1fr`; canal de líneas alineado a la derecha, `--cv-muted` al 65 %, borde derecho.
  Texto 13px/1,75 mono. Resaltado mínimo: claves del *frontmatter* en `--cv-accent`, encabezados en 700,
  el resto en `--cv-text`. Selección de búsqueda: fondo `--cv-accent-soft`. **El editor no reformatea el Markdown.**
- **Pie de estado:** «Markdown · UTF-8 · LF» · «Línea 16, columna 34» · nota a la derecha.

**Conflicto de edición:** diálogo (ver §Diálogos) disparado al guardar si la huella del disco no coincide.

---

## 3 · Generar

**Propósito:** producir un CV en ≤ 3 clics y entender qué se ha decidido.
**Layout:** `grid-template-columns: minmax(420px, 480px) 1fr`. Izquierda formulario por pasos sobre
`--cv-surface` con borde derecho; derecha resultado sobre `--cv-bg`.

**Formulario (3 pasos, `.cv-step`):**

1. **Especialidad** — desplegable + vista previa del titular en panel hundido:
   «Staff Backend Engineer · pagos y plataforma» (13px/600) y «14 logros etiquetados · 22 skills · 5 proyectos» (12,5px).
2. **Oferta (opcional)** — cuatro orígenes como pestañas internas: **Texto · PDF · Del espacio · URL** (con icono de escudo;
   la URL abre el diálogo de consentimiento). Textarea mono 12,5px, mínimo 96px. Nota: «El texto se queda en tu máquina».
3. **Salida** — rejilla 2×2: Formato (PDF/Markdown), Motor (Typst / pdfkit), Tema (`default`, `classic`, `nunzi-dark (modificado)`),
   Top N logros. Casillas: «Compacto (una página)» y «Recompilar el artefacto antes».

Barra de acciones pegajosa al fondo con degradado a `--cv-surface`: **Generar CV** (CTA 9px 16px, 13,5px/600) ·
«Analizar oferta» · a la derecha «→ `output/`».
Plegable «Temas de Typst · 3 instalados · por defecto default» con instalar desde URL/archivo, «Ver el plan» e «Instalar tema…».

**Resultado — éxito:**

- Aviso ok: «CV escrito en `output/cv-nunzi-backend.pdf` · 1 página · 148 KB» + «Descargar» y «Ver en Salidas».
- Rejilla `1fr 1.15fr`: visor de PDF enmarcado (`aspect-ratio: 1/1.414`, papel blanco siempre, sombra suave,
  contador «1 / 1») y, a la derecha, adecuación + informe.
- **Adecuación a la oferta:** cifra 26px/600 («68 %»), barra `.cv-meter` al 68 %, bajo la barra
  «11 de 16 términos demostrados» y «umbral orientativo 70 %». Tres columnas separadas por línea superior:
  **Demostrados** (punto `--cv-ok`, 11) con evidencias «← ach-payments-slo, ledger-migration»;
  **No demostrados** (punto `--cv-warn`, 3) con el motivo; **Carencias** (punto `--cv-error`, 2)
  y botón «Pedir sugerencias al co-piloto».
- **Informe de decisiones:** plegable con resumen «9 de 16 ítems · 3 recortes · 0 avisos»; dentro,
  dos secciones (`Logros incluidos`, `Recortes por «compacto»`) en `pre` mono 11,5px/1,7 sobre `--cv-surface-2`.

**Vacío:** panel derecho centrado, icono de documento en caja discontinua, «Todavía no hay resultado» + qué aparecerá.
**Cargando:** tarjeta con spinner, «Generando el CV con Typst…» + «Paso 2 de 3 · componiendo el documento», y esqueleto de 420px.
**Error:** aviso rojo «Typst no ha podido compilar el tema "nunzi-dark"» + «No se ha escrito ningún fichero en `output/`» +
salida literal del compilador en `pre` (con el cursor `^^^^`) + «Generar con "default"» y «Abrir cv.typ:12».
**Consentimiento:** el formulario sigue visible detrás; diálogo de descarga de tema.

---

## 4 · Salidas

**Layout:** `grid-template-columns: minmax(400px, 44%) 1fr`.
Izquierda: título + «6 ficheros · 1,4 MB» + ruta `~/proyectos/chameleon-cv/output/` (11,5px mono) y tabla
compacta con columnas `1fr 62px 96px` (Fichero · Tamaño · Modificado). Cada fila: etiqueta de tipo
(`PDF` en acento, `MD`/`JSON` neutros) + nombre 12,5px mono; fila activa `--cv-accent-soft`.
Derecha: ruta del fichero + «Descargar» + «Eliminar…» (peligroso discreto) y visor enmarcado (papel 340px de ancho).

**Vacío:** «`output/` está vacío» + «Generar mi primer CV» (primario, lleva a Generar).

---

## 5 · Co-piloto (Trabajos)

**Layout:** `grid-template-columns: minmax(430px, 46%) 1fr`.

Izquierda:

- Tres tareas como opciones en tarjeta con radio: **Mejorar logros** (`improve`), **Resumen profesional**
  (`summarize`), **Sugerir etiquetas** (`suggest-tags`). Cada una con su descripción de una línea; la
  seleccionada en `--cv-accent-soft` con borde de acento. El nombre del comando va en mono 11,5px.
- **Límites de la ejecución:** Logros (8) · Propuestas (3) · Longitud máx. (240) + Especialidad.
- **Proveedor:** Local (`ollama · qwen2.5:14b`) marcado y con badge «recomendado»; `groq` con
  «clave presente · exige consentimiento» (al elegirlo se abre el diálogo); `cerebras` deshabilitado, «sin clave».
- **Panel «Qué sale y a dónde»** (`--cv-surface-2`): Destino (`http://127.0.0.1:11434` · tu máquina),
  Se envía (8 logros y la especialidad; ni nombre, ni contacto, ni empresas), Se escribe
  (`output/review-improve-…md` · las fuentes no se tocan).
- CTA **Lanzar trabajo**.

Derecha: «Trabajos · 1 en curso · 3 hoy» y `.cv-jobs`:
en curso (borde de acento, spinner, barra al 62 %, «Logro 5 de 8 · `ach-observability`», «~40 s restantes», «Cancelar»);
terminado (check verde, «8 ítems · 21 propuestas (4 rechazadas)», «Abrir revisión» + ruta del fichero);
fallido (icono de error, «el proveedor local no respondió (tiempo agotado a los 30 s)», «Reintentar»,
«No se ha escrito nada. Comprueba que `ollama serve` sigue en marcha»).

---

## 6 · Revisiones

**Layout:** `grid-template-columns: 280px 1fr`. Barra de acciones **pegajosa** arriba del panel derecho
(`position: sticky; top: 0`).

- **Lista:** encabezado «En output/», entradas con nombre 12px mono y subtítulo «mejorar logros · 8 ítems · 3 marcadas».
- **Barra:** nombre del fichero + «mejorar logros · especialidad backend · fuentes en `data/sources`» ·
  «3 propuestas marcadas» · «Guardar marcas» · «Plan de aplicación» (primario; deshabilitado si hay marcas sin guardar).
- **Ítem** (`.cv-review-item`): cabecera con `id` en mono 600, `fichero:línea` atenuado y contador «1 de 3 marcada».
  Cuerpo `1fr 1.25fr`: **Antes** (texto original 13,5px + «Impacto: …» 12,5px) | **Después** (propuestas).
  - Propuesta aceptable: casilla + «1 · texto»; marcada → borde de acento y fondo `--cv-accent-soft`.
  - Propuesta rechazada: caja discontinua sobre `--cv-surface-2`, icono ✕ rojo, texto en `<del>` atenuado,
    badge **«rechazada (C2)»** y el motivo literal: «cifras que no están en la fuente: "95 ms", "1,2 M €"».
    No tiene casilla: no se puede marcar.
- **Plan de aplicación:** tarjeta con borde de acento, resumen «3 cambios · 2 ficheros · copia .bak de cada uno»,
  lista por fichero con `línea N · id → texto`, y **«Aplicar y escribir en las fuentes»** (peligroso) con la
  advertencia «Si un original ya no está tal cual en la fuente, no se escribe nada».

**Vacío:** «Ninguna revisión pendiente» + explicación de que son ficheros Markdown en `output/` +
«Lanzar un trabajo del co-piloto».

---

## 7 · Ajustes

**Layout:** una columna, `max-width: 940px`.

- **Co-piloto local:** rejilla de 3 campos (Proveedor · URL base loopback · Modelo). Un campo fijado por el
  entorno se muestra **deshabilitado** con la etiqueta «(fijado por el entorno)» en `--cv-warn`.
  Línea «Efectivo: … (cv.toml) · … (por defecto) · … (variable de entorno)» — cada valor con su procedencia.
  Acciones: «Guardar en cv.toml» (primario) · «Comprobar» + resultado en verde con latencia.
- **Proveedores externos:** título + chip «este servidor no envía nada». Párrafo con
  `cv serve --allow-remote`, `cv llm key set <proveedor>` y `~/.config/chameleon-cv/keys.toml`.
  Ficha por proveedor: nombre, badge de clave, plan, host; **Modelos** con tarea recomendada
  (`openai/gpt-oss-120b` → improve, estable; `llama-3.3-70b-versatile` → summarize, preview) y **Cuota**
  publicada + viva con barra («2 640 / 14 400»); pie con enlaces de política y límites y su fecha de verificación.
  Botón «Comprobar groq» **deshabilitado** con `title="El servidor no admite remotos"`.
  `cerebras` al 72 % de opacidad, «sin clave», con la nota de verificación pendiente.
- **Lista blanca de hosts:** píldoras mono + «+ añadir» discontinuo.

---

## 8 · Portal · portada (VitePress, `layout: home`)

Marco de navegador (solo en el prototipo) + cabecera del portal: marca, nav (Guía · Referencia · Tutoriales ·
Desarrolladores · Cambios), chip `v0.9.3 · MIT`. Contenido `max-width: 1080px`, padding 52px 40px 70px.

- **Hero** `1.05fr .95fr`: chip «Local y soberano · sin cuenta, sin telemetría» (punto verde);
  h1 44px/1,08/700 `letter-spacing: -.025em` («Un perfil, / muchos CV.»); párrafo 16,5px/1,55 `--cv-muted`;
  tres acciones (Inicio rápido en acento, Galería de temas, Referencia de comandos); bloque de tres comandos
  en mono 12,5px/1,9 con comentarios atenuados. A la derecha, captura de la app nueva enmarcada
  (`box-shadow: 0 10px 34px rgba(16,24,40,.10)`) — **sustituir por captura real regenerada de la GUI**.
- **Qué hace / Qué no hace**: dos tarjetas a 1fr 1fr, con check verde y ✕ rojo. Cuatro puntos cada una,
  cada punto con lema en 600 y explicación atenuada. Es el bloque que responde «en 10 segundos».
- **Tres caminos**: tres tarjetas iguales (Binario · Docker · Galería), con número en cuadro `--cv-accent-soft`,
  párrafo, y comando en `code` sobre `--cv-surface-2` (la tercera, un enlace-botón).
- **Temas**: cuatro tarjetas 1fr con miniatura `aspect-ratio: 1/1.414` (papel blanco), nombre en mono y
  descripción; la cuarta discontinua «El tuyo» con `cv theme new`.
- **Pie**: «MIT · sin telemetría · es-ES» + enlaces.

**Tokens de VitePress** (`website/.vitepress/theme/custom.css`): mapear `--vp-c-brand-1: #1f4e79`,
`-2: #2a6399`, `-3: #16405f`, `brand-soft: rgba(31,78,121,.14)`; en `.dark`, `-1: #6ea8d8`, `-2: #5c95c7`,
`-3: #8dbde5`, soft `rgba(110,168,216,.16)`. Fondos: `--vp-c-bg: #f4f6f8`/`#0f1216`,
`--vp-c-bg-soft: #ffffff`/`#161a20`, `--vp-c-divider: #dfe4ea`/`#2a313b`. Fuente: `system-ui` (quitar la
fuente descargada del tema por defecto para cumplir «sin recursos externos»).

## 9 · Portal · página interior (guía)

`grid-template-columns: 230px minmax(0,1fr) 200px`, `gap: 36px`, `max-width: 1180px`.
Barra izquierda con grupos (Empezar · Producir · Co-piloto) y enlaces con línea vertical
(`border-left: 1px solid var(--cv-border); padding-left: 12px`); activo en acento 600.
Artículo: migas 12,5px, h1 32px/1,15/700, entradilla 16px/1,6 atenuada, aviso informativo en
`--cv-accent-soft` con borde izquierdo de 4px, h2 22px/600 con línea inferior, cuerpo 14,5px/1,65,
`code` en línea con fondo `--cv-surface-2` y borde, bloques de comando en `pre` mono 12,5px/1,8 con
`✓` en `--cv-ok`, pestañas Binario/Docker sobre el bloque, y navegación anterior/siguiente en dos tarjetas.
Derecha: «En esta página» pegajoso (`top: 20px`).

---

## Diálogos

Todos: `dialog` de 500–560px, radio 12px, padding 20px, `::backdrop rgba(10,14,20,.45)`,
**foco atrapado**, `Esc` cancela, el botón de cancelar recibe el foco inicial cuando la acción es destructiva,
y la acción destructiva nunca es la que responde al `Enter` por defecto.

1. **Consentimiento remoto** (560px) — «Vas a enviar 8 logros a groq». `dl` con Host, Modelo, **Se envía**,
   **No se envía**, Límite, **Coste estimado** («0,00 € · plan gratuito, 2 640 de 14 400 peticiones usadas hoy»)
   y **Se escribe**. Pie con enlace de política + fecha de verificación. Casilla «Recordar para esta sesión».
   Botones: Cancelar · **Enviar y lanzar**.
2. **Consentimiento de descarga** (500px) — «Esto sale de tu máquina» + «Una descarga HTTPS, nada más: no se
   envía ningún dato tuyo». `dl` con Host, Origen (URL completa, `word-break: break-all`), Límite («2 MB · 15 s»),
   Coste («0,00 €») y Se escribe (`themes/nord-cv/`). Nota «La huella SHA-256 se mostrará al instalar».
3. **Conflicto de edición** (520px) — «Otro proceso ha cambiado este fichero» + «No se ha guardado nada. Tus
   cambios siguen en el editor». `dl` con Fichero, Huella al abrir y **Huella en disco** (en `--cv-warn`).
   Botones: Recargar del disco · Ver diferencias · **Guardar encima (copia .bak)** (peligroso).
4. **Apagar el servidor** (420px) — «¿Apagar cv serve?» + «No hay trabajos en curso». Cancelar · Apagar (peligroso).
5. **Sesión caducada** (pendiente de diseño, ver README §Pendiente) — pantalla-puerta con campo de token,
   el comando `cv serve` para recuperar la URL y explicación de por qué ha pasado.
