# Pruebas de aceptación (Hito 5.5)

Única fuente de verdad de las pruebas de aceptación de `cv`, en dos niveles (`docs/acceptance-testing.md`, T-5.5.4): un arnés **determinista** que exige coincidencia perfecta con artefactos esperados y un arnés de **IA** que valida la integridad del proceso contra un modelo local. Nada de lo que hay aquí es real: la persona, las empresas, las ofertas y las direcciones son sintéticas.

## Contenido

| Ruta | Qué es |
|---|---|
| `bench/workspace/` | El proyecto de una usuaria ficticia tal como lo ve `cv`: `data/sources/` (perfil de once años con 4 especialidades, 5 experiencias y 3 proyectos con logros etiquetados, `impact`, ids explícitos, Markdown en línea y `#pin`; skills con alias; certificaciones; formación; idiomas), `offers/` (cuatro ofertas en texto, dos de ellas también en PDF), `themes/bench/` (tema propio derivado de `classic`), `cv.toml` (tema por defecto y anulaciones) y `reviews/` (revisiones de `improve`/`summarize` marcadas para `cv improve apply`). |
| `bench/generate.ts` | Genera los ficheros **derivados** del banco: los PDF de las ofertas (pdfkit, fecha fija, fuentes embebidas: bytes reproducibles) y las revisiones marcadas (con `Fuente:` y huella calculadas sobre las fuentes). `npm run acceptance:bench`. |
| `cases.ts` | Catálogo declarativo de escenarios y pasos: argumentos, entrada estándar, entorno, código de salida esperado y ficheros producidos. Escenarios independientes; pasos secuenciales. |
| `runner.ts` | Ejecuta el **binario compilado** (`dist/index.js`) sobre una copia temporal del banco con un entorno mínimo y determinista (`PATH` vacío, `HOME`/XDG dentro de la copia, `TZ=UTC`) y captura stdout, stderr y código de cada paso, normalizando rutas volátiles (`<WS>`, `<TMP>`, `<REPO>`, `<TYPST>`). `npm run acceptance:update` regenera los artefactos esperados (T-5.5.1); la comparación es el arnés determinista (T-5.5.2). |
| `bench/expected/<escenario>/` | Artefactos esperados: por paso, `NN-id.exit.txt`, `.stdout.txt`, `.stderr.txt`; y en `files/` los ficheros producidos con su ruta relativa (Markdown, `profile.json`, PDF de pdfkit y de Typst, fuentes tras `apply`, temas creados). |

Escenarios: `init` (directorio vacío), `core` (build, generate-cv Markdown y pdfkit, analyze-offer, vista previa del co-piloto sin modelo, estado, temas), `typst` (requiere el binario: temas distribuidos, tema del proyecto con `cv.toml`, oferta en PDF, tema creado), `apply`, `theme` y `errors`.

## Reglas

- Los artefactos esperados **solo** se regeneran de forma deliberada (`npm run acceptance:update`, tras `npm run build`), y el cambio se revisa en el diff del control de versiones. Sin binario de Typst, el escenario `typst` se omite de forma visible y sus artefactos no se tocan.
- Nada escribe en `bench/workspace/`: cada ejecución trabaja sobre una copia temporal que se elimina al terminar (canon C9).
- Los PDF esperados son deterministas byte a byte (pdfkit con fecha fija; Typst 0.15.1 con `--creation-timestamp` y las fuentes embebidas). Si cambia la versión de Typst, cambian sus PDF: regenerar y revisar.
- Sin red: ningún paso contacta con un proveedor de modelos (los de estado apuntan a un puerto cerrado) ni descarga nada.
