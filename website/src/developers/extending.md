---
title: Extender Chameleon CV
---
# Extender Chameleon CV

Tres extensiones típicas, con los puntos de entrada exactos. En todas rige lo mismo: pruebas con el 100 % de cobertura, sin red ni disco en las unitarias, y la documentación del portal actualizada (referencia generada, tutoriales si cambia el flujo).

## Un formato de fuente nuevo

Hoy el dataset admite Markdown (entidades narrativas) y CSV (skills y certificaciones). Para añadir, por ejemplo, un formato JSON o YAML para las certificaciones:

1. **Parser**: implementa la interfaz `SourceParser` de `src/parsers/` (mira `src/parsers/markdown/` y `src/parsers/csv/`: cada parser declara qué ficheros reconoce y devuelve entidades o problemas con fichero, línea y clave, nunca excepciones).
2. **Registro**: añade tu parser a `defaultSourceParsers()` en `src/parsers/index.ts`. Un fichero que ningún parser reconoce es un error (nada se ignora en silencio): decide si tu extensión debe ser exclusiva o convivir con el CSV.
3. **Esquema**: si el formato aporta claves nuevas, amplía `MasterProfile` en `src/core/schema/master-profile.ts` con la misma disciplina (estricto, longitudes, URL solo `http(s)`) y actualiza la vista estructurada y los renderers si deben mostrarlas.
4. **Seguridad**: solo lectura de ficheros dentro del dataset, sin enlaces simbólicos hacia fuera, sin tipado implícito, límites de tamaño.
5. **Pruebas**: unitarias con `MemoryFileSystem`; un dataset de ejemplo en `tests/fixtures/`; si cambia lo que ve el usuario, un escenario en `tests/acceptance/cases.ts` con sus artefactos esperados.
6. **Documentación**: la guía [Formato de las fuentes](/guide/sources) y la nota de diseño correspondiente ([Formato del dataset](/design/formato-dataset) o [Formato CSV](/design/formato-csv)).

## Un proveedor de modelos nuevo

`src/llm/provider.ts` define `LlmProvider`: `id`, `kind` (`local` o `remote`), `baseUrl`, `model`, `complete(request)` y `health()`. Los tres proveedores existentes son la plantilla: `ollama.ts` y `openai-compatible.ts` (locales), `anthropic.ts` (remoto).

1. **Implementación**: un módulo `src/llm/<proveedor>.ts` sobre `src/llm/http.ts` (cliente con límites de tiempo y tamaño, sin redirecciones). Temperatura 0 y semilla fija cuando el servidor lo admita (C8). La respuesta se valida siempre (`parseModelJson`, esquema de la tarea; C6).
2. **Identidad y política**: `src/llm/config.ts` registra los ids (`LOCAL_PROVIDER_IDS`, `REMOTE_PROVIDER_IDS`), las URL base por defecto, la **lista blanca de hosts** (`DEFAULT_ALLOWED_HOSTS`) y las variables de las claves (`KEY_ENV_VARIABLES`). Un proveedor local solo puede escuchar en loopback; uno remoto solo puede ser elegido con `--provider` explícito (C3) y su clave nunca se pide, imprime ni guarda (`src/llm/keys.ts`).
3. **Selección y estado**: `selectProvider` y `llmStatus` (`src/llm/status.ts`) deben conocerlo para `cv llm status`; el consentimiento de coste de los remotos vive en `src/cli/commands/remote.ts` (C11) y se aplica solo.
4. **Pruebas**: unitarias con un doble del cliente HTTP (respuestas, errores, tiempos agotados, redirecciones rechazadas) y, si es local, una pasada real del arnés de IA (`npm run test:acceptance:ai`) con `CHAMELEON_LLM_PROVIDER` apuntando a él.
5. **Documentación**: [Co-piloto de IA](/guide/copilot) y la doctrina ([Co-piloto de IA: diseño y principios](/design/llm-integration)), que fija los cánones que tu proveedor debe respetar.

## Un tema nuevo

No hace falta tocar el código: `cv theme create mio --from classic` crea `themes/mio/` en tu proyecto con `theme.toml` y `template.typ`. El esquema de `theme.toml` está en `src/themes/schema.ts` (colores `#rrggbb`, fuentes, tamaños 4–72 pt, espaciados en em, papel y márgenes en mm) y el contrato de la plantilla es `cv(d, theme)`. Para **distribuir** un tema con el producto, añádelo a `themes/` del repositorio: la capa de assets lo embebe en el ejecutable y lo materializa en la caché de usuario con su SHA-256. Guía: [Typst y temas](/guide/typst-themes); contrato y contenedor: [Plantillas Typst propias](/design/plantillas-typst); tutorial: [Tu propio tema](/tutorials/own-theme).

## Un comando nuevo

Los comandos viven en `src/cli/commands/` y se registran en `createProgram` (`src/cli/program.ts`); reciben el `CliContext` y devuelven el código de salida (`0`, `1` o `2`). Escribe primero la prueba con el arnés en memoria de `tests/cli/`, luego el comando. La página de la referencia se genera sola desde su ayuda (`npm run docs:generate`); añade los ejemplos en `website/examples/<comando>.md` o el `docs:check` te lo recordará.
