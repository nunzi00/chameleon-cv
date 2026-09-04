---
title: La interfaz web
---
# La interfaz web

Desde la versión 1.2.0, `cv serve` sirve en tu máquina una **interfaz web** que hace lo mismo que la CLI sin tocar la terminal: mantener las fuentes, validar y compilar, analizar ofertas y generar el CV. Viaja **dentro del ejecutable y de la imagen Docker** —no se descarga nada de internet— y solo la ve tu navegador, en `127.0.0.1`. Es un cliente más de la [API local](/guide/api): todo lo que muestra o escribe pasa por ella.

## Arrancar

```bash
cv serve --open      # arranca el servidor y abre el navegador con la URL y el token de sesión
```

```text
Chameleon CV 1.8.1 · espacio de trabajo /home/ada/mi-cv
API: http://127.0.0.1:4310/api/v1/ (Authorization: Bearer <token>)
Interfaz: http://127.0.0.1:4310/#token=4f6c…e2
Ctrl-C para parar (o POST /api/v1/shutdown)
```

La URL lleva el **token de sesión** en el fragmento (`#token=…`): el navegador nunca lo envía al servidor. Al cargar, la interfaz lo guarda en la pestaña (vive lo que ella) y lo retira de la URL, así no queda en el historial ni en capturas. Si abres `http://127.0.0.1:4310/` a secas, te pedirá pegarlo. Cada arranque de `cv serve` genera un token nuevo.

## La interfaz

Una barra lateral con tres grupos —**Perfil** (Fuentes, Estado del artefacto), **Producir** (Generar, Salidas) y
**Co-piloto** (Trabajos, Revisiones, Ajustes)— más los enlaces al portal; se pliega a iconos (y se recuerda) y por
debajo de 1024 px va siempre plegada. La cabecera de contexto, presente en todas las pantallas, muestra el espacio
de trabajo y cuatro chips que responden sin navegar: si el artefacto está al día, si Typst está, si el co-piloto
responde y si el servidor permite remotos; a la derecha, el conmutador de tema (claro, oscuro o el del sistema, sin
destello al cargar) y **Apagar**, que detiene `cv serve` tras confirmar.

## Estado del artefacto

![Pantalla Estado: la tarjeta del artefacto con badge, fuentes, especialidades y temas; Typst y co-piloto a su lado; la tabla de temas instalados y la portabilidad](/gui/estado.png)

Lo mismo que `cv build --check`, `cv typst status` y `cv llm status` de un vistazo: si el artefacto está al día, obsoleto o sin compilar (con sus especialidades), si Typst es utilizable, si hay un proveedor de IA local listo y qué temas hay. **Validar** y **Compilar** hacen lo que sus órdenes; **Exportar perfil (JSON)** e **Importar perfil…** son `cv export` y `cv import` (ver [Exportar e importar el perfil](/guide/portability)); la pantalla **Ajustes** configura el co-piloto (ver [Configurar el co-piloto](/guide/copilot-settings)); los problemas de las fuentes salen con fichero y línea, y cada uno enlaza con el editor. **Apagar el servidor** pide confirmación.

## Fuentes

![Pantalla Fuentes: el árbol de ficheros con filtro y badges de incidencias y el editor con un fichero de experiencia abierto, su huella y el pie de estado](/gui/fuentes.png)

El árbol de `data/sources` a la izquierda —con filtro, botón «+» para crear un fichero y un badge rojo con las incidencias de validación de cada fichero— y un editor con resaltado (Markdown y YAML) a la derecha, con la ruta, la huella del fichero, «cambios sin guardar» y un pie con el lenguaje, el fin de línea y la posición del cursor. El editor no reformatea nada. Debajo, **Historial de esta fuente**: las versiones anteriores que dejó cada aplicación de revisión o restauración (`output/historial-fuentes/`), con «Ver diferencias» frente al editor y «Restaurar esta versión» (la actual queda a su vez en el histórico). Nada se escribe hasta que pulsas **Guardar**: la interfaz envía el fichero con la huella que leyó y, si alguien lo cambió entre medias (otra pestaña, tu editor de texto), el servidor lo rechaza y un diálogo te deja **recargar** (descartando tus cambios) o **sobrescribir** con tu versión. Tras guardar se validan las fuentes y se avisa si el artefacto queda obsoleto. **Nuevo fichero** crea uno vacío en la ruta que indiques (`experience/acme.md`).

## Generar

![Pantalla Generar: el formulario en tres pasos a la izquierda y, a la derecha, el CV generado, la adecuación a la oferta con su porcentaje y el informe de decisiones](/gui/generar.png)

Un formulario en tres pasos —**Especialidad** (con la vista previa del titular y de cuánto perfil la reconoce), **Oferta** (opcional: texto pegado, PDF subido o fichero del espacio de trabajo, por pestañas) y **Salida** (formato, motor, tema, límites y más opciones)— y una barra de acciones fija con **Generar CV** y **Analizar oferta**. Las mismas opciones que `cv generate-cv` —incluidos dos selectores de etiquetas para elegir a mano qué skills y qué proyectos entran, alimentados por tu perfil— y, al añadir una oferta, el aviso de si ya se procesó, cuándo y con qué CV (historial de `output/historial-ofertas.json`): especialidad, oferta (pegada como texto, subida como **PDF** —el texto se extrae en local— o un fichero del espacio de trabajo), formato, motor (Typst si está disponible), tema, límites (`Top N`, skills, proyectos, certificaciones), idioma, nombre del fichero, compacto y recompilar antes.

La pantalla **recuerda cómo generas**: especialidad, formato, motor, tema, idioma, límites y compacto vuelven tal
como los dejaste la última vez que generaste (se guarda en tu navegador, nunca en el servidor). No vuelve lo que
es de cada búsqueda —la oferta, la selección de skills y proyectos— ni el co-piloto: dejar marcado algo que envía
datos sería decidir por ti. Si borras una especialidad o desinstalas un tema, lo guardado se descarta solo.

- **Analizar oferta** es `cv analyze-offer`: el porcentaje de requisitos demostrados con su barra, cuáles demuestra tu perfil (y con qué logros), cuáles no, las carencias y las mejores evidencias.
- **Generar CV** escribe el fichero en `output/`. El Markdown se muestra como texto con descarga; el **PDF** se abre en el visor del navegador (se descarga con tu token y se muestra desde la memoria de la pestaña) con su botón de descarga.
- **Informe de decisiones** es `--explain`: la selección por especialidad, la cobertura de la oferta, los recortes y el tema, con las mismas palabras que la CLI.
- **Temas de Typst** (plegable): crea un tema en `themes/<nombre>/` de tu proyecto a partir de otro, como `cv theme create`; e **Instalar tema…**, como `cv theme install`: desde un archivo o directorio del espacio de trabajo, o desde una URL `https://` (el servidor debe arrancar con `--allow-remote` y un diálogo pide confirmar la descarga con el host y el límite). «Ver el plan» es `--dry-run`. El selector de tema muestra la autoría y marca los instalados.

## Salidas

![Pantalla Salidas: la tabla de ficheros de output/ con su tipo y tamaño y la vista previa de un CV en Markdown](/gui/salidas.png)

Los ficheros de `output/` —CV en PDF, ODT y Markdown, revisiones del co-piloto— en una tabla con su tipo y tamaño; cada uno se ve (texto o visor de PDF) y se descarga; un ODT no se previsualiza, se descarga para abrirlo en tu editor. Si no hay nada, la pantalla lleva a Generar.

## Co-piloto

![Pantalla Co-piloto: la tarea y el proveedor elegidos en tarjetas, los límites, el panel «qué sale y a dónde» y un trabajo terminado con su progreso y el enlace a la revisión](/gui/copiloto.png)

Las tres tareas de `cv improve`, `cv summarize` y `cv suggest tags` como **trabajos**: eliges la tarea y sus límites (logros por ejecución, propuestas por logro, longitud máxima, una oferta opcional por texto o fichero), pulsas **Lanzar** y sigues el progreso en directo —las mismas líneas `[n/m]` que la terminal— con un botón para cancelar. Antes de lanzar, el panel «qué sale y a dónde» dice qué se envía al proveedor (los textos de los logros o del perfil, y la oferta si la hay; nunca tus ficheros enteros) y a cuál. Con un proveedor remoto (`cv serve --allow-remote`), el servidor responde primero con una **estimación** de lo que se enviaría y la interfaz pide tu confirmación; solo entonces se lanza. El resultado de mejorar y resumir es una **revisión** en `output/`, enlazada desde el trabajo; el de sugerir etiquetas, la lista de logros con sus **etiquetas nuevas y una casilla por etiqueta**: ninguna viene marcada y «Aplicar en mis fuentes» escribe solo las que marques, al final de la viñeta y con copia `.bak` al lado (después, recompila en «Estado»). Ningún trabajo escribe en tus fuentes por su cuenta: solo esa acción tuya.

## Revisiones

![Pantalla Revisiones: un ítem con su original a la izquierda, las propuestas con casillas a la derecha y el plan de aplicación con el fichero completo antes y después](/gui/revisiones.png)

Cada revisión muestra, ítem a ítem, el **antes** (el logro tal como está en la fuente, con su impacto y su `fichero:línea`) y el **después**: las propuestas del modelo, con casilla las que superaron la verificación (C2) y tachadas las rechazadas. Marcas la que quieras de cada ítem y **Guardar marcas** escribe solo `[ ]`→`[x]` en el fichero de la revisión (el resto queda intacto: `cv improve apply` lee exactamente lo mismo). **Plan de aplicación** enseña qué ficheros e ids cambiarían sin tocar nada; **Escribir en las fuentes** —tras confirmar— aplica las marcadas guardando en el histórico la versión anterior completa de cada fichero, y si un original ya no está tal cual en la fuente no escribe nada y explica por qué. Después, recompila el artefacto en Estado.

Cuando una revisión **ya no deja nada pendiente**, al aplicarla se archiva sola: sale de la lista y pasa a la sección **Archivadas** del árbol, plegada al final. No se borra: se abre, se aplica y se desarchiva igual, con **Desarchivar**. **Archivar** hace lo mismo a mano con cualquier revisión. **Deshacer la aplicación** —solo aparece si esa revisión llegó a escribir algo— devuelve cada fuente a como estaba antes de aplicarla; lo que hubiera ahora queda a su vez en el histórico, así que deshacer también tiene vuelta, y la revisión sale del archivo porque vuelve a estar pendiente. **Eliminar** borra el fichero de la revisión (las fuentes no cambian): si solo quieres que deje de estorbar, archívala.

En cada fuente abierta, **Eliminar** la borra. Primero enseña qué entradas del perfil se lleva por delante —un fichero no siempre aporta lo que uno cree— y solo después pide confirmación; si sin ese fichero tus fuentes dejaran de cargar, se niega y dice por qué. La versión anterior completa queda en el histórico, así que se recupera desde «Historial de esta fuente» de cualquier fuente.

## Vida laboral

Las fechas de un CV se degradan solas: se escribe de memoria y se copia del CV anterior. Esta pantalla compara
tus fuentes con el **informe de vida laboral** de la Seguridad Social —*Sede Electrónica → Ciudadanos → Informes
y certificados → Informe de tu vida laboral*— y te dice qué empleos das por **abiertos** y el informe cierra,
qué **inicios** y **finales** no cuadran, qué empresas registra que tu perfil no tiene y cuáles tienes tú que el
informe no (normal en el extranjero, en becas sin alta o como funcionario).

El PDF **no se guarda**: se sube, se compara y se olvida. Y del informe **solo se leen empresas y fechas**: el
DNI, el número de la Seguridad Social y el domicilio que trae dentro no se leen, no se escriben y no salen de tu
máquina. Cuando la razón social del informe no se parece a la marca de tu CV, el apunte avisa de que el
emparejado fue **por el periodo** y hay que comprobarlo. No se cambia nada: las fechas las corriges tú en
Fuentes.

## LinkedIn

Tu perfil de LinkedIn envejece solo: el titular se queda, las aptitudes se quedan y las fuentes siguen creciendo.
Esta pantalla dice **qué cambiar allí** para que diga lo que dicen tus fuentes, en tres bloques: qué **añadir**
(está en tus fuentes y no allí, con el texto listo para copiar), qué **corregir** (está en los dos y no dice lo
mismo; tus fuentes son la referencia) y qué **falta por actualizar** en tu propio perfil antes de subirlo
—puestos sin logros, sin etiquetas, sin certificaciones—.

Antes del botón están los pasos, porque sin ellos no hay nada que comparar: **exportar** de LinkedIn
(*Configuración y privacidad → Privacidad de los datos → Obtener una copia de tus datos*, marcando «Quiero
algunos datos» con *Positions*, *Education*, *Skills*, *Languages* y *Profile*; o *Más → Guardar como PDF* en tu
perfil) e **importarlo aquí** (el `.zip` y el PDF entran por *Importar CV* y dejan un borrador, nunca escriben
en tus fuentes). Sin borrador con el que comparar el plan sigue saliendo, pero solo puede decir qué tienes tú.

No hay modelo ni red: es una comparación local entre dos perfiles, con la misma regla de «esto es el mismo
empleo» que usa Duplicados.

## Qué escribe la interfaz y qué no

Escribe **solo cuando pulsas un botón con nombre**: Guardar y Eliminar (una fuente), Compilar (el artefacto), Generar CV (un fichero en `output/`), Crear tema e Instalar tema (`themes/<nombre>/`), Lanzar (una revisión en `output/` al terminar un trabajo de mejorar o resumir), Guardar marcas (el fichero de la revisión), Escribir en las fuentes (tus fuentes, con la versión anterior en el histórico, tras confirmar), Archivar y Desarchivar (mueven el fichero de la revisión), Deshacer la aplicación (tus fuentes, tras confirmar) y Eliminar (una revisión). Nunca escribe por su cuenta ni al cerrar. Todo lo demás es lectura. El servidor comprueba cada escritura de fuentes con la huella del fichero, exactamente como la API.

## Seguridad

- Solo `127.0.0.1`; token de sesión por arranque; el servidor rechaza cabeceras `Host` ajenas y escrituras desde otros orígenes; sin CORS.
- La interfaz no carga nada de fuera (ni fuentes, ni iconos, ni analítica) y su política de contenido prohíbe cualquier *script* que no venga del propio ejecutable.
- Nada del contenido de tus ficheros se convierte en HTML: se muestra como texto, y el PDF, en el visor del navegador.
- En Docker: [`compose.serve.yml`](/guide/docker#la-api-desde-el-contenedor) publica el puerto solo en el loopback del anfitrión.

Más detalle en la [nota de diseño de la interfaz](/design/gui-mvp) y en el [modelo de amenazas de la API](/design/api-headless#_6-seguridad-modelo-de-amenazas-de-un-servidor-local).
