---
title: Seguridad y privacidad
---
# Seguridad y privacidad

Un CV es un documento con datos personales. Chameleon CV está diseñado para que **nada salga de tu máquina** sin que tú lo pidas y para que lo que se escribe en disco quede solo a tu alcance.

## Qué sale de tu máquina (y qué no)

| Situación | Red |
|---|---|
| `cv build`, `generate-cv`, `analyze-offer`, `theme`, `validate`, `init` | **Ninguna** conexión. |
| `cv typst install` | La **única operación de red del producto**: descarga el release oficial de Typst desde GitHub, verificada por SHA-256 contra un manifiesto fijado al versionar; solo cuando tú la ejecutas. |
| Co-piloto con proveedor local (`ollama`, `openai-compatible`) | Solo hacia loopback (`127.0.0.1`/`localhost`); cualquier otra dirección se rechaza. |
| Co-piloto con `--provider openai|anthropic` | Solo con la opción explícita en cada orden, hacia una lista blanca de hosts por `https`, tras mostrar el coste estimado y pedir confirmación. |
| Telemetría, actualizaciones automáticas, «mejora del producto» | No existen. |

Lo que sale hacia un modelo está **minimizado y seudonimizado**: el texto del logro y su contexto inmediato, el perfil filtrado para un resumen, o un texto para etiquetar; nombre sustituido por `[NOMBRE]`, empresas por `[EMPRESA-n]` con `--redact-companies`; nunca email, teléfono, ubicación ni enlaces. `--show-payload --dry-run` enseña exactamente qué saldría sin enviar nada.

## Qué se escribe en disco

- `data/dist/profile.json` y los CV de `output/` contienen datos personales: se escriben con permisos **0600** (solo tu usuario) y ambos directorios están en el `.gitignore` que crea `cv init`. Si versionas tu espacio de trabajo, recuerda que `data/sources/` también contiene tus datos: mantenlo en un repositorio privado o exclúyelo.
- Los ficheros de revisión del co-piloto (`output/revision-*.md`) y la caché de respuestas (en tu caché de usuario) son 0600.
- `cv improve apply` (y `cv history restore`) son las únicas órdenes que escriben en `data/sources/`: solo con tu marca `[x]`, tras guardar la versión anterior entera en `output/historial-fuentes/` (0600) y comprobar por huella que el original no cambió; una revisión manipulada no puede apuntar fuera del directorio de fuentes.
- Las claves de proveedores remotos se leen de variables de entorno o de un fichero con permisos 0600; nunca se preguntan, imprimen ni guardan.

## Cómo se trata la entrada

- Solo se leen ficheros `.md`/`.csv` dentro del dataset; los enlaces simbólicos que apuntan fuera son un error; YAML sin tipado implícito ni alias; toda entrada pasa por un esquema estricto (longitudes, caracteres de control, URLs solo `http(s)`).
- Las ofertas en PDF se procesan en un *worker* aislado con límites (10 MiB, 50 páginas, 20 s, 512 MB), sin cargar fuentes ni renderizar; el PDF generado no contiene código ni acciones automáticas y se produce sin red ni binarios externos.
- Typst corre como proceso hijo contenido: entorno vacío, sin red, `--root` limitado al tema, límites de tiempo y memoria; tus datos viajan por stdin, nunca por argumentos ni ficheros temporales.
- El artefacto se **re-valida** cada vez que se lee: no se confía en un fichero de disco aunque lo hayamos escrito nosotros.

## Cadena de suministro

- El ejecutable se construye en la integración continua a partir del binario oficial de Node.js, con las dependencias fijadas por `package-lock.json` y las acciones de CI fijadas por SHA.
- Cada release publica el `.sha256` de cada archivo, un `SHA256SUMS.txt` y una **atestación de procedencia** (SLSA) verificable con `gh attestation verify <archivo> --owner nunzi00`.
- El archivo incluye `THIRD-PARTY-NOTICES.md` con las licencias de todo lo que el ejecutable incorpora. Detalle: [Empaquetado y release](/developers/packaging).

## Informar de una vulnerabilidad

No abras un *issue* público: usa los avisos de seguridad privados del repositorio en GitHub (*Security → Report a vulnerability*).
