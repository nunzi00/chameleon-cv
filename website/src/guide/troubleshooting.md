---
title: Solución de problemas
---
# Solución de problemas

## Códigos de salida

`0` correcto · `1` datos inválidos (fuentes, artefacto o especialidad desconocida; una plantilla Typst que no compila) · `2` uso incorrecto o fallo del entorno (permisos, disco, plantilla ilegible, binario o servicio ausente, confirmación rechazada). En scripts, comprueba el código antes de usar la salida.

## Mensajes habituales

| Mensaje | Qué significa y qué hacer |
|---|---|
| `experience/acme.md:4: start: Fecha inválida` (y otros errores de validación) | Las fuentes no cumplen el esquema. Cada línea trae fichero, línea y clave; se muestran todos a la vez. Formato: [Formato de las fuentes](/guide/sources). |
| `Aviso: experience/acme.md es más reciente que el artefacto; ejecuta «cv build»` | Editaste las fuentes y no recompilaste. `cv build`, o `--build` en la orden. |
| `No existe el artefacto` / `artefacto inválido` | Falta `data/dist/profile.json` o no supera la validación (se re-valida siempre). `cv build`. |
| `especialidad desconocida «x»` | No hay `specialties/x.md`. `cv build -v` lista las especialidades cargadas. |
| `ya existe … no se escribe nada` (en `cv init`) | `init` nunca sobrescribe. Usa otro directorio (`cv init mi-cv`) o retira los ficheros en conflicto. |
| `No se encuentra Typst` | `--engine typst` sin binario. `cv typst install` (única operación de red), o `CHAMELEON_TYPST=/ruta/typst`, o `--typst-path`. `cv typst status` dice qué se usaría. |
| `SHA-256 no coincide` (en `cv typst install`) | La descarga no es el release oficial esperado; el fichero se elimina sin instalarse. Reintenta; si persiste, no instales: comprueba tu red o proxy. |
| `theme.toml: colors.primary: …` / `cv.toml: …` | Un valor del tema o de la configuración no pasa la validación; la ruta indica la clave. `cv theme list` muestra los temas inválidos con su motivo. |
| `El proveedor local no responde` | No hay Ollama (o servidor compatible) escuchando en `CHAMELEON_LLM_BASE_URL`. Arranca el servicio, descarga el modelo (`ollama pull qwen3:8b`) y comprueba con `cv llm status`. |
| `dirección no local rechazada` | `CHAMELEON_LLM_BASE_URL` apunta fuera de loopback. Los proveedores locales solo pueden ser `127.0.0.1`/`localhost`; para remotos usa `--provider`. |
| `permisos abiertos` (fichero de claves) | `~/.config/chameleon-cv/keys.json` es legible por otros usuarios: `chmod 600` sobre el fichero. |
| `Operación cancelada: sin terminal interactiva, confirma con --yes` | Un proveedor remoto pide confirmación y no hay TTY (script, CI). Añade `--yes` si aceptas el coste. |
| `VIOLATION_C2_…` en una revisión | El verificador rechazó una propuesta del modelo (cifra o entidad añadida u omitida). Es el comportamiento esperado: no la adoptes tal cual. |
| `el original cambió` (en `cv improve apply`) | El fichero fuente ya no coincide con la huella registrada en la revisión (lo editaste, o la revisión es antigua). Genera una revisión nueva. |
| `oferta en PDF: … límite` | El PDF supera 10 MiB o 50 páginas, o tarda más de 20 s. Recórtalo o pega el texto. |

## Ver qué pasa por dentro

- `--explain` en `generate-cv` y `analyze-offer`: cada decisión de selección, puntuación y recorte.
- `--show-payload --dry-run` en el co-piloto: exactamente qué saldría hacia el modelo, sin enviar nada. `--show-prompt`: el prompt versionado.
- `cv build -v`: qué se cargó. `cv typst status`, `cv llm status`, `cv theme list`: el estado del entorno.

## Dónde están los ficheros

| Qué | Dónde |
|---|---|
| Fuentes, artefacto, CV y revisiones | `data/sources/`, `data/dist/profile.json`, `output/` del espacio de trabajo |
| Typst instalado por `cv typst install` | `~/.cache/chameleon-cv/typst/0.15.1/typst` (`~/Library/Caches` en macOS, `%LOCALAPPDATA%` en Windows) |
| Caché de respuestas del co-piloto | caché de usuario, subdirectorio `chameleon-cv`; `cv llm cache clear` la vacía |
| Assets del ejecutable (temas, fuentes, dataset de ejemplo) | `~/.cache/chameleon-cv/assets/<versión>/`, con su SHA-256 comprobado en cada uso |
| Claves de proveedores remotos | `~/.config/chameleon-cv/keys.json` (0600) o variables `CHAMELEON_*_API_KEY` |

¿Algo que no está aquí? Abre un *issue* en [GitHub](https://github.com/nunzi00/chameleon-cv/issues) con la orden exacta, el mensaje completo y `cv --version`.
