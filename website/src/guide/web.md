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
Chameleon CV 1.8.0 · espacio de trabajo /home/ada/mi-cv
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

- **Analizar oferta** es `cv analyze-offer`: el porcentaje de requisitos demostrados con su barra, cuáles demuestra tu perfil (y con qué logros), cuáles no, las carencias y las mejores evidencias.
- **Generar CV** escribe el fichero en `output/`. El Markdown se muestra como texto con descarga; el **PDF** se abre en el visor del navegador (se descarga con tu token y se muestra desde la memoria de la pestaña) con su botón de descarga.
- **Informe de decisiones** es `--explain`: la selección por especialidad, la cobertura de la oferta, los recortes y el tema, con las mismas palabras que la CLI.
- **Temas de Typst** (plegable): crea un tema en `themes/<nombre>/` de tu proyecto a partir de otro, como `cv theme create`; e **Instalar tema…**, como `cv theme install`: desde un archivo o directorio del espacio de trabajo, o desde una URL `https://` (el servidor debe arrancar con `--allow-remote` y un diálogo pide confirmar la descarga con el host y el límite). «Ver el plan» es `--dry-run`. El selector de tema muestra la autoría y marca los instalados.

## Salidas

![Pantalla Salidas: la tabla de ficheros de output/ con su tipo y tamaño y la vista previa de un CV en Markdown](/gui/salidas.png)

Los ficheros de `output/` —CV en PDF y Markdown, revisiones del co-piloto— en una tabla con su tipo y tamaño; cada uno se ve (texto o visor de PDF) y se descarga. Si no hay nada, la pantalla lleva a Generar.

## Co-piloto

![Pantalla Co-piloto: la tarea y el proveedor elegidos en tarjetas, los límites, el panel «qué sale y a dónde» y un trabajo terminado con su progreso y el enlace a la revisión](/gui/copiloto.png)

Las tres tareas de `cv improve`, `cv summarize` y `cv suggest tags` como **trabajos**: eliges la tarea y sus límites (logros por ejecución, propuestas por logro, longitud máxima, una oferta opcional por texto o fichero), pulsas **Lanzar** y sigues el progreso en directo —las mismas líneas `[n/m]` que la terminal— con un botón para cancelar. Antes de lanzar, el panel «qué sale y a dónde» dice qué se envía al proveedor (los textos de los logros o del perfil, y la oferta si la hay; nunca tus ficheros enteros) y a cuál. Con un proveedor remoto (`cv serve --allow-remote`), el servidor responde primero con una **estimación** de lo que se enviaría y la interfaz pide tu confirmación; solo entonces se lanza. El resultado de mejorar y resumir es una **revisión** en `output/`, enlazada desde el trabajo; el de sugerir etiquetas, una lista que copias y aplicas tú en la fuente. Ningún trabajo escribe en tus fuentes.

## Revisiones

![Pantalla Revisiones: un ítem con su original a la izquierda, las propuestas con casillas a la derecha y el plan de aplicación con el fichero completo antes y después](/gui/revisiones.png)

Cada revisión muestra, ítem a ítem, el **antes** (el logro tal como está en la fuente, con su impacto y su `fichero:línea`) y el **después**: las propuestas del modelo, con casilla las que superaron la verificación (C2) y tachadas las rechazadas. Marcas la que quieras de cada ítem y **Guardar marcas** escribe solo `[ ]`→`[x]` en el fichero de la revisión (el resto queda intacto: `cv improve apply` lee exactamente lo mismo). **Plan de aplicación** enseña qué ficheros e ids cambiarían sin tocar nada; **Escribir en las fuentes** —tras confirmar— aplica las marcadas dejando una copia `.bak` de cada fichero, y si un original ya no está tal cual en la fuente no escribe nada y explica por qué. Después, recompila el artefacto en Estado. **Eliminar** borra solo el fichero de la revisión.

## Qué escribe la interfaz y qué no

Escribe **solo cuando pulsas un botón con nombre**: Guardar (una fuente), Compilar (el artefacto), Generar CV (un fichero en `output/`), Crear tema e Instalar tema (`themes/<nombre>/`), Lanzar (una revisión en `output/` al terminar un trabajo de mejorar o resumir), Guardar marcas (el fichero de la revisión), Escribir en las fuentes (tus fuentes, con copia `.bak`, tras confirmar) y Eliminar (una revisión). Nunca escribe por su cuenta ni al cerrar. Todo lo demás es lectura. El servidor comprueba cada escritura de fuentes con la huella del fichero, exactamente como la API.

## Seguridad

- Solo `127.0.0.1`; token de sesión por arranque; el servidor rechaza cabeceras `Host` ajenas y escrituras desde otros orígenes; sin CORS.
- La interfaz no carga nada de fuera (ni fuentes, ni iconos, ni analítica) y su política de contenido prohíbe cualquier *script* que no venga del propio ejecutable.
- Nada del contenido de tus ficheros se convierte en HTML: se muestra como texto, y el PDF, en el visor del navegador.
- En Docker: [`compose.serve.yml`](/guide/docker#la-api-desde-el-contenedor) publica el puerto solo en el loopback del anfitrión.

Más detalle en la [nota de diseño de la interfaz](/design/gui-mvp) y en el [modelo de amenazas de la API](/design/api-headless#_6-seguridad-modelo-de-amenazas-de-un-servidor-local).
