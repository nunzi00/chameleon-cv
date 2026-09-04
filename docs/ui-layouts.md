# Organizaciones y paletas de la interfaz (T-9.29, T-9.30)

## §0 Encargo

**Del PO (2026-09-04)**: «un rediseño total, que la web disponga de temas visuales, que no solo sea cambio de
colores, que cada estilo sea un enfoque distinto en la **organización** de la web, y que con un simple click se
cambie de tema. Al menos 4 temas».

La interfaz tenía **una sola forma** desde T-8.6: barra lateral con doce pantallas en tres grupos, cabecera de
contexto con chips, contenido a la derecha. El conmutador claro/oscuro cambiaba el color y nada más.

## §1 Qué es una «organización» aquí

No es una paleta. Una organización cambia **dónde vive la navegación, cuánta cabecera hay y cuánto aire respira
el contenido**, y con ello a qué invita la pantalla. Seis, y cada una responde a una forma distinta de usar el
producto:

| Organización | Navegación | Cabecera | Contenido | Para |
| --- | --- | --- | --- | --- |
| **Barra** (por defecto) | lateral permanente, con grupos | completa, con chips | fluido | trabajar muchas horas seguidas, saltando entre pantallas |
| **Raíl** | lateral reducida a iconos, 56 px | completa | casi todo el ancho | el mejor aprovechamiento vertical: la navegación siempre visible por 56 px |
| **Cinta** | fila superior, sin lateral | integrada y compacta | todo el ancho, más densidad | pantallas anchas y sesiones largas de una sola pantalla |
| **Pestañas** | dos niveles arriba: grupos y, debajo, el grupo actual | integrada y compacta | todo el ancho | doce pantallas no caben en una fila con su nombre; por grupos, sí |
| **Tablero** | ninguna permanente: mosaico bajo demanda | completa | en tarjetas, más aire y radios mayores | entrar, mirar el estado y hacer una cosa |
| **Foco** | ninguna permanente: mosaico bajo demanda | mínima, sin chips | columna de 780 px, tipografía mayor | leer y escribir sin ruido |

«Tablero» y «Foco» comparten la forma de navegación —un lanzador— y se distinguen en lo demás: uno es **ancho y
con tarjetas**, el otro **estrecho y silencioso**. Seis organizaciones con **cinco** formas de navegación
(`sidebar`, `rail`, `ribbon`, `tabs`, `launcher`), no seis interfaces.

**«Cinta» fue la que más gustó al PO por aprovechamiento del espacio (4-sep)**, y de ahí salieron «Raíl» y
«Pestañas»: las tres atacan el mismo problema —que la navegación no se coma el ancho— por caminos distintos.
«Raíl» lo resuelve estrechando, «Cinta» pasando a horizontal y «Pestañas» enseñando solo un grupo cada vez.

## §1.5 Paletas (T-9.30)

El **tercer eje**, y los tres son ortogonales a propósito: `data-theme` es la luz de la habitación,
`data-ui` es cómo trabajas y `data-palette` es qué color quieres mirar. Cinco: **Pizarra** (la de siempre, azul
frío), **Bosque**, **Ámbar**, **Índigo** y **Carbón** (monocroma).

Cada paleta trae sus valores para claro **y** para oscuro, porque un acento que funciona sobre blanco casi nunca
funciona sobre casi-negro. Y ninguna toca `--cv-surface` ni `--cv-text`: ahí vive el contraste verificado del
texto, y teñirlo sería cambiar un color a costa de poder leer. Sí tiñen `--cv-bg`, que es superficie de fondo, y
por eso **las ocho combinaciones (cuatro paletas × claro y oscuro) se comprueban en las pruebas leyendo la hoja
de estilos**: acento sobre superficie, texto del acento sobre acento, y texto y texto atenuado sobre el fondo
teñido. Todas dan AA.

## §2 Una sola carcasa, dirigida por datos

**Consulta al Director Técnico (4-sep)**, cuya respuesta se sigue: «no puedes tener cinco archivos o clases
distintas que se carguen según el tema; mantén el componente base y cambia únicamente su modo».

- `gui/src/lib/ui-layout.ts` es el modelo: las cuatro organizaciones, su descripción y **la forma de navegación
  de cada una** (`sidebar`, `ribbon`, `launcher`). Tres formas para cuatro temas.
- `Nav.svelte` pinta **el mismo** `NAV_GROUPS` de esas tres formas. No hay una lista de pantallas por tema.
- Las **pantallas no saben** en qué organización viven: reciben las mismas props y no leen el layout.
- El resto lo hace la hoja de estilos con `data-ui` en `<html>`. La organización por defecto **no escribe
  atributo**, así que la hoja base sigue siendo la de siempre y no hay que repetirla dentro de un selector.

## §3 Decisiones

- **Dos conmutadores, no uno.** El Director propuso combinar claro/oscuro y organización en una sola decisión.
  **No se sigue**, y conviene que conste por qué: son preferencias de naturaleza distinta —el color depende de
  la luz de la habitación y la organización de cómo trabajas—, cambian en momentos distintos, y combinarlas
  daría **doce** opciones para dos decisiones que nadie toma a la vez. Se quedan separadas y ortogonales.
- **Se aplica antes del primer render** (`main.ts`), como el tema: sin eso, abrir la aplicación en «Foco» se
  vería como un salto de la carcasa entera al cargar.
- **En «Foco» se ocultan los chips y el conmutador de tema, pero NUNCA el de organización**: es lo único que
  devuelve al usuario a las otras vistas, y esconderlo dejaría a alguien atrapado en una interfaz sin salida.
- **Cambiar de organización cierra el mosaico**: la nueva puede tener la navegación siempre a la vista, y
  dejarlo abierto taparía el contenido sin motivo.
- **Por debajo de 1024 px manda el ancho, no el gusto**: la barra se pliega y la cinta se hace desplazable.

## §4 Qué NO cambia

El **contenido** de cada pantalla, sus acciones y su orden lógico. Una organización mueve la carcasa; si además
reordenara lo de dentro, cambiar de tema obligaría a reaprender el producto y nadie lo tocaría dos veces.

## §5 Accesibilidad (segunda consulta al Director, 4-sep)

El Director señaló tres riesgos al cambiar de organización; esto es lo que se hace con cada uno.

| Riesgo | Qué se hace |
| --- | --- |
| **El foco se pierde al cambiar de carcasa** | El conmutador vive en la **cabecera, que está en las cuatro organizaciones**, así que al pulsar el foco se queda donde estaba. Ninguna organización lo mueve. |
| **Sin navegación permanente cuesta encontrar las pantallas** | El botón que abre el mosaico lleva `aria-expanded`, el mosaico es un `<nav aria-label="Pantallas">` con **encabezados por grupo y enlaces**: una estructura lineal y anunciable, no una rejilla muda. Y marca la pantalla actual con `aria-current`. |
| **«Foco» retira los chips de estado** | Se retiran a propósito —es el modo sin ruido— y **nada crítico vive solo ahí**: lo mismo está en Estado del artefacto y en Ajustes. Lo que **no** se retira nunca es el conmutador de organización: sin él, alguien se quedaría atrapado en una interfaz sin salida. |

Cada opción del conmutador lleva además su `title` con lo que cambia, y el grupo su `aria-label`: elegir no
puede ser adivinar.
