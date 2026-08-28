# Co-piloto de IA: diseño técnico y principios (Hito 4)

| | |
|---|---|
| **Tarea** | T-4.1 · [DESIGN] Propuesta de diseño técnico y principios para la integración de LLM |
| **Estado** | **APROBADA Y CANONIZADA** por el Director de Ingeniería el 2026-08-28: doctrina oficial para la integración de IA (los seis puntos de §8 ratificados; C2 y C3 elevados a invariantes). T-4.2 entregada (§9). |
| **Autor** | Claude (Director Técnico) |
| **Decide** | Qué problema resuelve la IA, con qué cánones, con qué arquitectura (CLI, flujo de datos, elección y abstracción del modelo) y con qué garantías de seguridad y privacidad; y cómo se replanifica el Hito 4. |
| **Base** | `docs/arquitectura.md` §3 (propuesta original y anotaciones canónicas), `docs/scoring.md` y `docs/trimming-cli.md` (lo que ya es determinista), `docs/typst-integration.md` (principios de consentimiento explícito de red y contenedor estricto), `docs/consolidacion.md`. |

## 0. Resumen ejecutivo

- **Qué**: la IA entra donde el determinismo no llega: **redactar**. El caso de uso principal es **`cv improve`**: reescribir logros para que tengan más impacto (verbo de acción, qué, cómo, resultado), opcionalmente orientados a una oferta; sin inventar nada. Casos secundarios, por orden: **`cv summarize`** (resumen profesional general, por especialidad o por oferta) y **`cv suggest tags`** (etiquetas y skills que el texto sugiere). Todo lo que ya es determinista —selección, puntuación, recorte, adecuación— **sigue siendo determinista**: el LLM no decide qué entra en el CV.
- **Cómo**: la IA **sugiere** en un *fichero de revisión*; **nunca** escribe en `data/sources/`. Toda salida es JSON con esquema, validada con zod y **verificada semánticamente** por código (ninguna cifra, entidad o fecha que no exista en el original). Prompts versionados en el repositorio y visibles con `--show-prompt`.
- **Con qué modelo**: un proveedor abstracto sobre REST con `fetch` (sin SDKs, cero dependencias nuevas). **Local por defecto** (Ollama en loopback, o cualquier servidor compatible con la API de OpenAI en loopback). Remoto (OpenAI, Anthropic) solo con **consentimiento explícito por ejecución**, tras mostrar exactamente qué saldrá, seudonimizado y sin datos de contacto; claves solo en variables `CHAMELEON_*` o ficheros 0600, jamás en argumentos.
- **Replanificación**: de las cinco tareas T-4.x heredadas, tres ya están cubiertas por el Hito 2 (extracción de requisitos, perfil a medida, `cv match` = `analyze-offer` + `generate-cv -f`). Se proponen T-4.2–T-4.7 (§6) y la ingestión desde URL pasa al backlog.

## 1. Objetivo, alcance y relación con lo existente

`docs/arquitectura.md` §3 propuso (2026-08-28) un «co-piloto de carrera» centrado en el *matchmaking*: el modelo extraería requisitos de la oferta y adaptaría el perfil. Desde entonces el Hito 2 entregó exactamente eso **sin modelo**: `extractJobRequirements` (T-2.1), `tailorToOffer` y el informe de adecuación (T-2.2), el recorte (T-2.3) y `cv analyze-offer`/`generate-cv -f` (T-2.4), con 100 % de cobertura y resultados explicables. Reemplazarlo por un LLM sería cambiar determinismo por probabilidad sin ganancia de usuario.

Por tanto, esta nota **redefine el papel de la IA**: no selecciona ni puntúa; **redacta y propone**. Las anotaciones canónicas de §3.3 (zod en toda salida, egreso opt-in, minimización, sin persistir páginas, temperatura baja y caché) se mantienen íntegras y se amplían en §3. Fuera de alcance: chat libre, generación de contenido desde cero, agentes que actúen sobre el sistema de ficheros, y la ingestión de ofertas desde URL (backlog, §6).

## 2. Caso de uso principal (pregunta 1)

### 2.1 `cv improve`: logros con más impacto, sin inventar

El problema real del usuario no es elegir qué contar (ya lo hace el selector con sus etiquetas) sino **contarlo bien**: los logros suelen estar escritos como tareas («Encargado del despliegue») en lugar de como resultados («Automaticé el despliegue con GitLab CI, reduciendo el tiempo de entrega de 2 días a 20 minutos»). Es trabajo de lenguaje, repetitivo, y donde un modelo aporta valor inmediato.

`cv improve` toma los logros (todos, los de una especialidad, o los que sobreviven a una oferta y a los límites) y, por cada uno, propone hasta N reescrituras que:

1. empiezan por un verbo de acción en primera persona (o el estilo que el usuario fije en `profile.md`: `meta.voice`, futuro),
2. mantienen **todos los hechos** del original y **no añaden ninguno** (cifras, tecnologías, empresas, fechas, magnitudes): regla verificada por código (§3, canon C2),
3. si hay oferta, usan el **vocabulario de la oferta** cuando el logro ya lo demuestra (nunca para reclamar lo que no está),
4. caben en dos líneas (límite de caracteres configurable) y no repiten el `impact` cuantificado, que sigue siendo un campo aparte.

Salida: un **fichero de revisión** (§4.1) con original, propuestas, justificación breve y el resultado de la verificación; nada se modifica.

### 2.2 Casos secundarios (por prioridad)

| Comando | Qué resuelve | Entrada mínima | Salida |
|---|---|---|---|
| `cv summarize [-s] [-f]` | Un resumen profesional de 3–5 líneas, general, para una especialidad o para una oferta concreta (hoy `summary` es estático y manual). | titular, logros seleccionados (texto e impacto), skills por categoría, años por rol | 2–3 propuestas de `summary` en el fichero de revisión |
| `cv suggest tags` | Etiquetas que el texto de un logro sugiere y no tiene (mejora el selector y el *scoring*, que dependen de las tags). | texto del logro + vocabulario del perfil (tags y skills existentes) | propuestas de tags **solo del vocabulario existente**, o marcadas explícitamente como «nueva» |
| `cv explain-gaps -f` (más adelante) | Convertir las carencias de `analyze-offer` en una narrativa útil para la carta o la entrevista. | `MatchSummary` + logros relacionados | texto en el fichero de revisión |

Lo que **no** hará la IA: decidir la selección o el orden del CV (es del motor determinista y explicable), generar experiencias o certificaciones, rellenar campos vacíos con suposiciones, ni tocar `data/sources/` por su cuenta.

## 3. Principios rectores de la IA (pregunta 2)

Extienden los principios del proyecto (local-first, seguridad, control del usuario, determinismo donde sea posible) y los ya canonizados en el Hito 3 (consentimiento explícito de red; ejecución en contenedor estricto). Propuestos como **cánones**:

| # | Canon | Cómo se hace cumplir |
|---|---|---|
| **C1** | **La IA sugiere; el usuario decide.** | Única salida: el fichero de revisión. Ningún comando de IA escribe en `data/sources/` ni en el artefacto. Aplicar una sugerencia es un acto explícito del usuario (edición manual o, en una tarea posterior, `cv improve apply` ítem por ítem, §4.1). |
| **C2** | **Sin invención.** Una sugerencia no puede contener hechos que no estén en la entrada. | Verificador determinista sobre cada propuesta: números, porcentajes, monedas, fechas, tecnologías y nombres propios de la propuesta deben aparecer en el original (normalizados); si no, la propuesta se **rechaza y se muestra por qué**. Es el mismo espíritu que el round-trip de los PDF: la prueba la hace el código, no el modelo. |
| **C3** | **Local por defecto; remoto solo con consentimiento explícito y visible.** | Proveedor por defecto en loopback. Un proveedor remoto exige `--provider <remoto>` en la propia orden (nunca por configuración silenciosa) y la CLI imprime, **antes de enviar**, qué sale (nº de fragmentos, palabras, campos suprimidos, host destino). `--dry-run` y `--show-payload` lo muestran sin enviar. |
| **C4** | **Minimización y seudonimización.** Solo salen los fragmentos que la tarea necesita, sin datos de contacto. | Canal de datos único (`redact`, §4.2): nunca `personal.email/phone/location/links`; el nombre se sustituye por `[NOMBRE]`; nombres de empresa opcionalmente por `[EMPRESA-1]`… (`--redact companies`); nunca se envía el perfil completo. Cubierto por tests con un doble de proveedor que captura el payload. |
| **C5** | **Transparencia de prompts.** | Prompts en ficheros versionados del repositorio (`prompts/<tarea>.v<n>.md`) con esquema de salida; `--show-prompt` imprime el prompt exacto; el fichero de revisión registra tarea, versión del prompt, proveedor, modelo y hash de la entrada. |
| **C6** | **Salida estructurada, validada y verificada.** | JSON con esquema (JSON Schema derivado de zod) cuando el proveedor lo soporta; validación zod siempre; JSON inválido = error, no *best effort*, con un único reintento que devuelve al modelo el error de validación; después, C2. |
| **C7** | **Sin entrenamiento ni retención con datos del usuario.** | Local: nada sale. Remoto: solo proveedores cuya API declara que no entrena con los datos enviados (OpenAI API y Anthropic API lo declaran para uso vía API); se documenta y se enlaza; sin *fine-tuning* con datos de usuario, nunca. |
| **C8** | **Determinismo razonable.** | `temperature: 0`, `seed` cuando exista, modelo fijado por nombre y etiqueta; caché local por hash de (tarea, prompt, modelo, entrada) para que repetir sea gratis e idéntico; cada sugerencia lleva su procedencia. |
| **C9** | **Reversible y trazable.** | Nada destructivo; el fichero de revisión es un artefacto normal (0600, en `output/`) que se puede versionar o borrar; un eventual `apply` produce cambios mínimos y localizables (`fichero:línea` gracias a la procedencia del cargador). |
| **C10** | **Presupuesto y límites.** | Máximo de ítems por ejecución, `max_tokens`, tiempo por llamada (contenedor de red: 60 s), estimación de tokens antes de enviar a un remoto; sin bucles de reintento ilimitados. |

## 4. Arquitectura propuesta (pregunta 3)

### 4.1 Interfaz de usuario (CLI)

```
cv improve   [-s <esp>] [-f <oferta>] [--top-n …] [--only <id,…>] [--proposals 2]
             [--provider ollama|openai-compatible|openai|anthropic] [--model <nombre>]
             [--redact companies] [--show-prompt] [--show-payload] [--dry-run] [--no-cache] [-o <revisión.md>]
cv summarize [-s <esp>] [-f <oferta>] [--lines 4] [mismas opciones de proveedor y transparencia]
cv suggest tags [-s <esp>] [--only <id,…>] [ídem]
cv llm status            # proveedor y modelo que se usarían, si el local responde, qué claves hay definidas (nunca su valor)
cv llm cache clear       # vacía la caché local de respuestas
cv improve apply <revisión.md>   # (T-4.7, opcional) aplica solo los ítems marcados [x], mostrando el diff, ítem a ítem
```

El **fichero de revisión** (`output/revision-<tarea>-<fecha>.md`, 0600) es Markdown legible y a la vez parseable:

```markdown
# Revisión: improve · backend · oferta acme-backend · 2026-08-28
proveedor: ollama · modelo: qwen2.5:7b-instruct · prompt: improve.v1 · entrada: sha256:3f2a…

## exp-acme-1 (experience/acme.md:14)
- [ ] original: Reduje la latencia p95 del checkout un **40 %** rediseñando la capa de caché.
- [ ] propuesta 1: Rediseñé la capa de caché del checkout y reduje la latencia p95 un **40 %**.
      justificación: verbo de acción al inicio; el resultado cierra la frase. verificación: ✓ hechos conservados
- [ ] propuesta 2: … verificación: ✗ rechazada (introduce «60 %», que no está en el original)
```

Las propuestas rechazadas por C2 se muestran tachadas con el motivo: el usuario ve lo que el modelo intentó y por qué no pasa.

### 4.2 Flujo de datos

```
perfil (artefacto) ──selección/puntuación/recorte deterministas──► fragmentos (ids)
   └─► redact (C4): sin contacto, [NOMBRE], [EMPRESA-n] opcional ──► LlmTask.input (zod)
         └─► prompt versionado (C5) + JSON Schema de salida ──► LlmProvider.complete()
                └─► JSON ──zod (C6)──► verificador de hechos (C2) ──► fichero de revisión (C1, C9)
                                                                └─► caché local por hash (C8)
```

1. **Fragmentos**: la selección la hace el motor existente (`selectForSpecialty`, `tailorToOffer`, `applyLimits`); la IA recibe ítems con su `id`, texto, `impact`, contenedor (rol, empresa —o seudónimo—, tecnologías), titular de la especialidad y, si hay oferta, los términos reconocidos (nunca la oferta entera, salvo `summarize -f`, que la necesita resumida a sus términos y años).
2. **Redacción** (`redact`): función pura, testeada, única puerta de salida de datos. Devuelve también la tabla de seudónimos para deshacer la sustitución en las propuestas.
3. **Tarea** (`LlmTask<I, O>`): `{ name, promptVersion, inputSchema, outputSchema, render(input) → mensajes, verify(input, output) → veredictos }`. Tres tareas en el Hito 4: `improve`, `summarize`, `suggest-tags`.
4. **Proveedor** (`LlmProvider`): `{ id, kind: 'local' | 'remote', host, complete({ messages, schema, maxTokens, temperature, seed }) → { json, model, usage } }`. Sin SDKs: `fetch` a los endpoints REST documentados, con las mismas garantías de T-3.3 (https para remotos, tiempo acotado, tamaño acotado).
5. **Respuesta**: zod → verificación C2 → deshacer seudónimos → fichero de revisión + resumen en consola (`3 logros · 6 propuestas · 5 verificadas · 1 rechazada`). Errores de proveedor (sin conexión, modelo ausente, cuota) = código 2 con instrucción; salida inválida tras el reintento = código 1 con el motivo.

### 4.3 Elección del modelo: local frente a API

| | Local (Ollama, llama.cpp `llama-server`, LM Studio) | API (OpenAI, Anthropic, Google) |
|---|---|---|
| Privacidad | Nada sale de la máquina (loopback). | Datos seudonimizados salen a un tercero; depende de su política (C7). |
| Calidad en nuestras tareas | Suficiente para reescritura y resumen con modelos instruidos de 7–14 B; peor en matices de idioma y en seguir esquemas complejos (mitigación: tareas pequeñas, ejemplos en el prompt, esquema simple, reintento con error). | Excelente; siguen esquemas y estilo con fiabilidad. |
| Coste y latencia | Gratis; en esta máquina (20 núcleos, 30 GB, sin GPU) un 7–8 B cuantizado en CPU responde a ~3–8 tokens/s: 10–30 s por logro, aceptable en lote (`--only`, caché). Con GPU, segundos. | Céntimos por CV; 1–5 s por llamada. |
| Instalación | Binario/runtime aparte, descarga de modelos de 4–9 GB (fuera de nuestro alcance: lo hace el usuario con su gestor; `cv llm status` diagnostica). | Solo una clave. |
| Determinismo | `seed` y `temperature: 0` bien soportados. | `temperature: 0`; `seed` solo en algunos; los modelos cambian con el tiempo (fijar versión). |

**Propuesta**: abstraer sobre la **API compatible con OpenAI** (`/v1/chat/completions` con `response_format: json_schema` donde exista; Ollama, llama.cpp y LM Studio la exponen en loopback, y OpenAI la define), más un proveedor **Anthropic** (Messages API; salida estructurada mediante *tool use* con `input_schema`) y el **nativo de Ollama** (`/api/chat` con `format: <JSON Schema>`, que garantiza salida estructurada incluso con modelos pequeños). Por defecto: `ollama` en `http://127.0.0.1:11434` con un modelo fijado y documentado (candidatos a evaluar en el *spike* de T-4.2: `qwen2.5:7b-instruct`, `llama3.1:8b-instruct`, `gemma3:12b`); configurable con `CHAMELEON_LLM_PROVIDER`, `CHAMELEON_LLM_BASE_URL`, `CHAMELEON_LLM_MODEL`. **Regla de localidad**: un proveedor es «local» solo si su host resuelve a loopback; cualquier otra URL base se trata como remota y exige el consentimiento de C3, aunque sea de la LAN.

Estas capacidades (JSON Schema en Ollama ≥ 0.5, `response_format` en OpenAI, *tool use* en Anthropic) constan en la documentación pública de cada proveedor; la primera tarea de implementación las **verificará con un spike** antes de fijar nada, como hicimos con pdf.js y Typst.

## 5. Seguridad y privacidad (pregunta 4)

- **Claves**: solo por variables `CHAMELEON_OPENAI_API_KEY` / `CHAMELEON_ANTHROPIC_API_KEY` o `--api-key-file <ruta>` (0600). Deliberadamente **no** se leen `OPENAI_API_KEY` ni similares: una clave presente en la shell para otra herramienta no debe activar egreso aquí sin querer. Nunca en argumentos (`ps`), nunca en ficheros del repositorio, nunca en logs ni en mensajes de error (se enmascaran antes de imprimir), nunca en la caché.
- **Red**: por proveedor, una **lista blanca de hosts** (`api.openai.com`, `api.anthropic.com`, o la URL base configurada) y https obligatorio; el resto se rechaza en código, con el mismo envoltorio de `fetch` acotado de T-3.3 (tiempo, tamaño, sin redirecciones a otros hosts). Local = loopback verificado. Ninguna otra parte del sistema gana acceso a la red por esta capa.
- **Datos**: canal único `redact` (C4) con tests que afirman qué campos **no** pueden salir; vista previa «lo que sale» antes de enviar (C3); ninguna página, oferta ni respuesta se persiste fuera de `output/` y de la caché de usuario (0600, borrable con `cv llm cache clear`).
- **Entradas hostiles**: el texto de una oferta es **datos no confiables** (puede contener instrucciones para el modelo). Mitigaciones: la oferta nunca se envía entera a `improve` (solo términos ya extraídos por T-2.1), los prompts delimitan claramente datos e instrucciones, la salida es JSON validado y verificado (C2, C6), y **ninguna salida del modelo se ejecuta ni se escribe** en las fuentes: el peor caso de una inyección es una sugerencia absurda, visible y rechazable.
- **Cadena de suministro**: sin SDKs de proveedores (superficie de dependencias cero, como en T-3.3); zod para las respuestas; prompts versionados y revisables en el repositorio.
- **Amenazas y respuesta** (resumen): exfiltración de PII (C3+C4+lista blanca) · uso de datos para entrenar (C7, local por defecto) · alucinación en el CV (C2, C1) · inyección vía oferta (JSON validado, sin ejecución, sin escritura) · deriva del modelo (versión fijada y registrada) · coste descontrolado (C10).

## 6. Plan propuesto para el Hito 4 y replanificación

| Tarea | Contenido | Sustituye a |
|---|---|---|
| **T-4.1** | Esta nota (aprobación). | — |
| **T-4.2** | `src/core/llm/`: `LlmProvider`, proveedores `ollama` (nativo) y `openai-compatible` (loopback), doble de test; `redact` con tests; `cv llm status`; **spike** con un modelo local real en esta máquina (calidad y latencia en `improve`; con `CHAMELEON_LLM_BASE_URL` los tests de integración se activan como con `CHAMELEON_TYPST`). | T-4.1 antigua (abstracción `LlmService`) |
| **T-4.3** | `cv improve`: tarea, prompt `improve.v1`, verificador C2, fichero de revisión, caché. | T-4.4 antigua (perfil a medida) en su parte de lenguaje |
| **T-4.4** | `cv summarize` (general, especialidad, oferta). | — |
| **T-4.5** | Proveedores remotos (`openai`, `anthropic`) con consentimiento C3, claves §5, lista blanca, estimación de coste. | T-4.1 antigua (remotos) |
| **T-4.6** | `cv suggest tags`. | — |
| **T-4.7** (opcional) | `cv improve apply <revisión>`: aplicar ítems marcados con diff previo, usando la procedencia `fichero:línea` del cargador. | — |
| Backlog **B-5** | Ingestión de ofertas desde URL (`cheerio`, egreso explícito). | T-4.2 antigua |
| Cubiertas por el Hito 2 | Extracción de requisitos (T-2.1), perfil a medida y adecuación (T-2.2/2.3), `cv match` = `cv analyze-offer` + `cv generate-cv -f` (T-2.4). | T-4.3, T-4.4 y T-4.5 antiguas |

Criterios de aceptación comunes: 100 % de cobertura con el doble de proveedor; tests de `redact` que prueban qué no sale; tests del verificador C2 con propuestas que inventan cifras, entidades y fechas; tests de consentimiento (un proveedor remoto sin `--provider` explícito nunca se usa; ninguna clave aparece en salida ni errores); integración opcional con modelo local real.

## 7. Riesgos

- **Calidad de los modelos locales pequeños**: tareas acotadas, ejemplos en el prompt, esquema simple, verificación C2 y la opción remota explícita. El spike de T-4.2 decide el modelo por defecto con datos.
- **Latencia en CPU**: lotes acotados, `--only`, caché por hash, y avisos de progreso por ítem.
- **Exceso de confianza del usuario**: el fichero de revisión muestra siempre original y propuesta, marca lo rechazado y explica por qué; nunca se aplica nada solo.
- **Deriva y disponibilidad de proveedores**: modelo fijado y registrado en cada revisión; sin SDKs que arrastren cambios.
- **Idioma**: las tareas respetan el idioma del perfil (`meta.locale`); el prompt lo fija explícitamente.

## 8. Puntos de decisión (todos aprobados el 2026-08-28)

1. **Caso de uso principal**: `cv improve` (logros), con `summarize` y `suggest tags` como secundarios; el *matchmaking* sigue determinista y `cv match` queda sustituido por `analyze-offer` + `generate-cv -f`. Recomendación: aprobar.
2. **Cánones C1–C10** (§3), en especial C1 (solo sugiere), C2 (sin invención, verificada por código) y C3 (remoto solo con consentimiento explícito y visible). Recomendación: aprobar como canon.
3. **Arquitectura**: proveedor abstracto sobre REST con `fetch` y zod, sin SDKs; local por defecto en loopback (Ollama nativo + API compatible con OpenAI); remotos OpenAI y Anthropic. Recomendación: aprobar, con el spike de T-4.2 como verificación previa.
4. **Datos y claves**: `redact` como única puerta de salida (sin contacto, `[NOMBRE]`, empresas opcionales), vista previa antes de enviar, claves solo `CHAMELEON_*` o fichero 0600. Recomendación: aprobar.
5. **Salida**: el fichero de revisión como único canal; `apply` explícito e ítem a ítem en T-4.7 opcional. Recomendación: aprobar.
6. **Replanificación del Hito 4** (§6: T-4.2–T-4.7, B-5; tres tareas antiguas cubiertas por el Hito 2). Recomendación: aprobar.

## 9. Estado de la implementación

- **T-4.2 (2026-08-28)**: entregada. `src/llm/http.ts` (cliente JSON con política explícita: en T-4.2 solo loopback, sin redirecciones, tiempo y tamaño acotados, errores tipificados), `provider.ts` (contrato `LlmProvider`), `ollama.ts` (API nativa `/api/chat` con `format: <JSON Schema>`, `/api/tags`, `/api/version`), `openai-compatible.ts` (`/v1/chat/completions` con `response_format: json_schema`, `/v1/models`), `config.ts` (solo `CHAMELEON_LLM_PROVIDER`/`BASE_URL`/`MODEL`; URL no local rechazada), `status.ts` + `cv llm status`, `tasks/improve.ts` (fragmento mínimo por construcción, prompt versionado `prompts/improve.v1.md`, JSON Schema derivado del mismo zod que valida la salida, seudónimos deshechos en las propuestas) y `src/core/llm/redact.ts` (canon C4). Cobertura 100 % con dobles HTTP locales; ninguna prueba toca la red.
- **Spike real** (`npm run llm:spike -- templates/dataset exp-acme-1 php kubernetes`): esta máquina no tiene Ollama; se usó **llama.cpp `llama-server` b10679** (binario oficial CPU) sirviendo **Qwen2.5-7B-Instruct Q4_K_M** (4,7 GB, bartowski) en `127.0.0.1:8080`, es decir, el proveedor `openai-compatible`. Flujo completo verificado: logro → fragmento seudonimizado (`[NOMBRE]`, `[EMPRESA-1]`, sin contacto) → petición con esquema → JSON válido según zod → propuestas restauradas. Latencia 35 s en frío y 24 s en caliente (493 tokens de entrada, ~120 de salida, CPU Zen 5 de 10 núcleos); **determinista**: dos ejecuciones con `seed: 7` y `temperature: 0` devolvieron propuestas idénticas.
- **Hallazgos**: (1) el modelo respetó las cifras (la comprobación informal de C2 no detectó ninguna inventada) pero **añadió hechos no numéricos** en un logro sin contexto («ingenieros backend», «mejorando su rendimiento»): el verificador C2 de T-4.3 debe comprobar entidades y términos —tecnologías, roles, sustantivos del vocabulario del perfil— además de números, y avisar también de los **hechos perdidos** (una propuesta omitió el «40 %»). (2) La seudonimización sustituía partes del nombre sin distinguir mayúsculas y convirtió «un programa de ejemplo» en «un programa de [NOMBRE]» (apellido «Ejemplo»): corregido en T-4.2 (partes del nombre y empresas con grafía exacta; el nombre completo, en cualquier grafía). (3) `llama-server` devuelve en `/v1/models` tanto `data` (OpenAI) como `models` (estilo Ollama); el proveedor lee `data`. (4) El proveedor Ollama nativo está verificado contra un doble local que reproduce su API documentada; queda pendiente ejecutarlo contra un Ollama real cuando esté disponible (mismo mecanismo que `CHAMELEON_TYPST` para Typst: variables `CHAMELEON_LLM_*`).
- **Pendiente**: T-4.3 (`cv improve` con verificador C2 completo y fichero de revisión), T-4.4, T-4.5 (remotos con consentimiento), T-4.6, T-4.7.
- **T-4.3 (2026-08-28)**: entregada. **Verificador de integridad semántica** (`src/core/llm/verify.ts`, canon C2 extendido): sin modelo, tokeniza original y propuesta (cifras, tokens técnicos, nombres propios, palabras de contenido, verbos por sufijo, palabras vacías), reduce a raíces aproximadas y compara: `VIOLATION_C2_NUMBER_ADDED` (cifra nueva), `VIOLATION_C2_ENTITY_ADDED` (nombre propio, token técnico o término del vocabulario del perfil —tags, skills, alias, tecnologías y diccionario base— que no estaba), `VIOLATION_C2_CONTEXT_ADDED` (otras palabras de contenido nuevas), `VIOLATION_C2_FACT_OMITTED` (cifra, entidad o término del original ausente), más `VIOLATION_LENGTH`, `VIOLATION_NO_CHANGE` y `VIOLATION_EMPTY`. El contexto permitido (impacto, rol, empresa) no cuenta como invención. Es deliberadamente conservador: una paráfrasis con sustantivos nuevos se rechaza y se muestra tachada con el motivo; el usuario ve ambas versiones. **Caché** (`src/llm/cache.ts`): clave SHA-256 del JSON canónico de (tarea, versión del prompt, proveedor, modelo, entrada seudonimizada); solo respuestas válidas; ficheros 0600 en `~/.cache/chameleon-cv/llm`; `cv llm cache clear`. **Fichero de revisión** (`src/llm/review.ts`): cabecera con procedencia, una sección por logro, casillas `- [ ]` para lo aceptado y tachado con motivo para lo rechazado. **`cv improve`**: misma selección determinista que `generate-cv` (especialidad, oferta, límites) o `--only`; presupuesto `--max-items`; consentimiento visible antes de enviar; `--dry-run`/`--show-payload`/`--show-prompt`; un fallo por logro no aborta el lote; código 2 solo si todos fallan.
- **Verificación real de T-4.3** (binario compilado, `llama-server` + Qwen2.5-7B, `cv improve -s backend --top-n 2 --redact-companies`): de 4 propuestas, el verificador aceptó 1 (conservaba el 40 %) y rechazó 3 con motivo (`FACT_OMITTED (40)`; `CONTEXT_ADDED (paros, servicio)`; `CONTEXT_ADDED (Automatice, continuidad, operativa)`); 38 s + 25 s; la segunda ejecución salió íntegra de la caché. Exactamente el cinturón de seguridad que el spike pedía.
