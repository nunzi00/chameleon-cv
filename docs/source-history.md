# Histórico de versiones de las fuentes (T-8.10) — PROPUESTA v1

Estado: **APROBADA por el PO (D1–D4) e IMPLEMENTADA el 2026-08-30** · Encargo del Director

Implementación: `src/app/source-history.ts` (entradas `<marca compacta>-<origen>`, `cambio.json`, `index.json` de 500 entradas, `latest`,
restaurar crea entrada), `applyReview` guarda antes de escribir (sin `.bak`), `cv history [--json]` / `show` / `restore`,
`GET /history`, `POST /history/version`, `POST /history/restore`, GUI (Fuentes → «Historial de esta fuente» con «Ver
diferencias» y «Restaurar esta versión»; Revisiones enlaza la entrada). Arnés `apply` con `history`, `show latest` y
`restore latest` (marca compacta normalizada como `<STAMP>`).

## §0 Encargo

Director, 2026-08-30: «cuando se actualiza un improve de skill, trabajos, proyectos… quiero almacenar en un
histórico la versión que se ha modificado al completo».

## §1 Qué pasa hoy

`cv improve apply` (y `POST /reviews/{name}/apply` con `dryRun: false`) escribe cada fuente modificada tras dejar una
copia `<fichero>.<fecha>.bak` junto a ella, en `data/sources/`. Es una copia por escritura, sin índice: para saber
qué cambió, cuándo y por qué revisión hay que mirar el directorio a mano, y las copias se mezclan con las fuentes.

## §2 Propuesta

1. **Un histórico por espacio de trabajo en `output/historial-fuentes/`**: cada aplicación crea
   `output/historial-fuentes/<ISO compacto>-<revisión>/` con el **fichero completo tal como estaba** (misma ruta
   relativa: `experience/acme.md`) y un `cambio.json` con `{ at, review, files: [{ path, sha256Before, sha256After,
   ids }] }`. Un índice `output/historial-fuentes/index.json` (últimas 500 entradas) permite listar sin recorrer.
2. **Las copias `.bak` desaparecen de `data/sources/`**: el histórico las sustituye (una sola verdad, fuera de las
   fuentes). `written[].backup` pasa a ser la ruta del fichero en el histórico.
3. **Listar y ver**: `cv history [--json]` (última primero: fecha, revisión, ficheros, ids) y `cv history show
   <entrada> <ruta>` (imprime la versión guardada); API `GET /history` y `GET /history/{entry}/{path}`; en la
   GUI, Revisiones → «Aplicado» enlaza a la entrada y una sección «Historial» en Fuentes muestra las versiones
   anteriores de la fuente abierta con su antes/después (mismo diff que el plan de aplicación).
4. **Restaurar** (`cv history restore <entrada> <ruta>`, botón «Restaurar esta versión») escribe la versión
   guardada sobre la fuente **creando a su vez una entrada** en el histórico (nunca se pierde nada).

## §3 Fuera de alcance

Versionar ediciones manuales del editor de Fuentes (se propone aparte si el Director lo quiere: sería el mismo
mecanismo al guardar desde la GUI); integrar con git.

## §4 Seguridad y límites

Solo rutas seguras (`isSafeSourcePath`), ficheros 0600, el histórico vive en `output/` (ya ignorado por `.gitignore`
del espacio de trabajo), límite de 500 entradas en el índice (las carpetas no se borran solas).

## §5 Pruebas

Núcleo y capa de aplicación al 100 % (memoria de ficheros), CLI, rutas, GUI; arnés `apply` con el histórico y
`history`; goldens regenerados.

## §6 Decisiones que se piden al PO

1. **D1** Ubicación `output/historial-fuentes/` y supresión de las copias `.bak` en `data/sources/`.
2. **D2** Incluir «Restaurar» en esta tarea (con entrada en el histórico al restaurar).
3. **D3** Las ediciones manuales del editor quedan fuera (tarea aparte si se pide).
4. **D4** Versión 1.8.0.
