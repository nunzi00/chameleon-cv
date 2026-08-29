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
Chameleon CV 1.2.0 · espacio de trabajo /home/ada/mi-cv
API: http://127.0.0.1:4310/api/v1/ (Authorization: Bearer <token>)
Interfaz: http://127.0.0.1:4310/#token=4f6c…e2
Ctrl-C para parar (o POST /api/v1/shutdown)
```

La URL lleva el **token de sesión** en el fragmento (`#token=…`): el navegador nunca lo envía al servidor. Al cargar, la interfaz lo guarda en la pestaña (vive lo que ella) y lo retira de la URL, así no queda en el historial ni en capturas. Si abres `http://127.0.0.1:4310/` a secas, te pedirá pegarlo. Cada arranque de `cv serve` genera un token nuevo.

## Estado

![Pantalla Estado: artefacto, Typst, co-piloto y temas, con los botones de validar, compilar y apagar](/gui/estado.png)

Lo mismo que `cv build --check`, `cv typst status` y `cv llm status` de un vistazo: si el artefacto está al día, obsoleto o sin compilar (con sus especialidades), si Typst es utilizable, si hay un proveedor de IA local listo y qué temas hay. **Validar** y **Compilar** hacen lo que sus órdenes; los problemas de las fuentes salen con fichero y línea, y cada uno enlaza con el editor. **Apagar el servidor** pide confirmación.

## Fuentes

![Pantalla Fuentes: el árbol de ficheros y el editor con un fichero de experiencia abierto](/gui/fuentes.png)

El árbol de `data/sources` a la izquierda y un editor con resaltado (Markdown y YAML) a la derecha. Nada se escribe hasta que pulsas **Guardar**: la interfaz envía el fichero con la huella que leyó y, si alguien lo cambió entre medias (otra pestaña, tu editor de texto), el servidor lo rechaza y un diálogo te deja **recargar** (descartando tus cambios) o **sobrescribir** con tu versión. Tras guardar se validan las fuentes y se avisa si el artefacto queda obsoleto. **Nuevo fichero** crea uno vacío en la ruta que indiques (`experience/acme.md`).

## Generar

![Pantalla Generar: formulario, análisis de adecuación a la oferta, CV en Markdown e informe de decisiones](/gui/generar.png)

Las mismas opciones que `cv generate-cv`: especialidad, oferta (pegada como texto, subida como **PDF** —el texto se extrae en local— o un fichero del espacio de trabajo), formato, motor (Typst si está disponible), tema, límites (`Top N`, skills, proyectos, certificaciones), idioma, nombre del fichero, compacto y recompilar antes.

- **Analizar oferta** es `cv analyze-offer`: cuántos requisitos reconoce, cuáles demuestra tu perfil (y con qué logros), cuáles no, las carencias y las mejores evidencias.
- **Generar CV** escribe el fichero en `output/`. El Markdown se muestra como texto con descarga; el **PDF** se abre en el visor del navegador (se descarga con tu token y se muestra desde la memoria de la pestaña) con su botón de descarga.
- **Informe de decisiones** es `--explain`: la selección por especialidad, la cobertura de la oferta, los recortes y el tema, con las mismas palabras que la CLI.
- **Temas de Typst** (plegable): crea un tema en `themes/<nombre>/` de tu proyecto a partir de otro, como `cv theme create`.

## Salidas

![Pantalla Salidas: los ficheros de output/ y la vista previa de un CV en Markdown](/gui/salidas.png)

Los ficheros de `output/` —CV en PDF y Markdown, revisiones del co-piloto— con su tamaño; cada uno se ve (texto o visor de PDF) y se descarga.

## Co-piloto y Revisiones

Llegan en la versión 1.3.0 (trabajos con progreso en directo, consentimiento de coste para proveedores remotos, revisiones con comparación antes/después y aplicación). Mientras tanto, `cv improve`, `cv summarize`, `cv suggest tags` y `cv improve apply` hacen lo mismo desde la terminal (ver [Co-piloto de IA](/guide/copilot)).

## Qué escribe la interfaz y qué no

Escribe **solo cuando pulsas un botón con nombre**: Guardar (una fuente), Compilar (el artefacto), Generar CV (un fichero en `output/`), Crear tema (`themes/<nombre>/`). Nunca escribe por su cuenta ni al cerrar. Todo lo demás es lectura. El servidor comprueba cada escritura de fuentes con la huella del fichero, exactamente como la API.

## Seguridad

- Solo `127.0.0.1`; token de sesión por arranque; el servidor rechaza cabeceras `Host` ajenas y escrituras desde otros orígenes; sin CORS.
- La interfaz no carga nada de fuera (ni fuentes, ni iconos, ni analítica) y su política de contenido prohíbe cualquier *script* que no venga del propio ejecutable.
- Nada del contenido de tus ficheros se convierte en HTML: se muestra como texto, y el PDF, en el visor del navegador.
- En Docker: [`compose.serve.yml`](/guide/docker#la-api-desde-el-contenedor) publica el puerto solo en el loopback del anfitrión.

Más detalle en la [nota de diseño de la interfaz](/design/gui-mvp) y en el [modelo de amenazas de la API](/design/api-headless#_6-seguridad-modelo-de-amenazas-de-un-servidor-local).
