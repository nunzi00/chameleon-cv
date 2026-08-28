# Roadmap del Proyecto: Chameleon CV

> **Estado (2026-08-28): Hito 1 (MVP) completado — victoria declarada por el Director de Ingeniería.** Flujo `cv validate → cv build-profile → cv generate-cv` operativo, 292 tests, 100 % de cobertura en toda la lógica. **Hito 2 en curso.**

## Stack Tecnológico: Node.js con TypeScript

## Épica: Generador de CVs Dinámicos

### Hito 1: MVP - Generador por Especialidad (Target: 3 días)

Replanificado el 2026-08-28 por el Director de Ingeniería: la lógica de selección por especialidad (T-1.5) se especifica e implementa antes que sus consumidores. Orden de ejecución: **T-1.5 → T-1.7 → T-1.4 → T-1.8**. **Hito 1 completado el 2026-08-28** (MVP: flujo `cv validate → cv build-profile → cv generate-cv`).

-   [x] **T-1.1: [CORE] Diseño del Esquema de Datos Unificado.** Definir una interfaz TypeScript ('MasterProfile') que represente de forma agnóstica toda la información de un candidato (datos personales, experiencia, proyectos, skills, logros).
    -   Hecho 2026-08-28: `src/core/schema/` (esquema zod como fuente única, tipos derivados, validación y saneado en tiempo de ejecución, unicidad de ids; 100 % de cobertura). Commits 9aee96e y a700395.
-   [x] **T-1.2: [PARSER] Implementar parser para Markdown.** Crear un módulo usando una librería robusta como `marked` o `unified` para leer los ficheros .md y mapearlos a la interfaz 'MasterProfile'.
    -   Hecho 2026-08-28: formato aprobado (`docs/formato-dataset.md`, disposición A) e implementado en `src/parsers/markdown/` (unified/remark + yaml failsafe, errores `fichero:línea`) y `src/parsers/dataset/` (recorrido estricto, enlaces acotados, límites, fusión con procedencia, validación global). Dataset de ejemplo en `tests/fixtures/dataset/`. Node ≥ 22.12 (`engines`).
-   [x] **T-1.3: [PARSER] Implementar parser para CSV.** Usar `csv-parse` para leer skills o proyectos desde un CSV y añadirlos al 'MasterProfile'.
    -   Hecho 2026-08-28: formato aprobado (`docs/formato-csv.md`; certificaciones en CSV) e implementado en `src/parsers/csv/` (`csv-parse` 7, cabecera con claves del esquema, «;» detectado, multivalor «|», ids posicionales, errores fichero:línea). `skills.csv` y `certifications.csv` en el dataset de ejemplo.
-   [x] **T-1.4: [CLI] Comando `build-profile`.** Compilador de fuentes: recorre `data/sources/`, valida y escribe el artefacto canónico `data/dist/profile.json` (`docs/arquitectura.md` §2.3–2.4); incluye `validate`. Se ejecuta tras T-1.7.
    -   Hecho 2026-08-28: binario **`cv`** (`bin` en package.json; `npm run cv -- …` con ts-node). `cv build-profile [--data] [--out] [-v]` (silencioso en éxito; errores `fichero:línea` en stderr; artefacto atómico con permisos 0600 en `src/artifact/`) y `cv validate`. Códigos de salida: 0 ok, 1 datos inválidos, 2 uso o entorno. CLI testeable con contexto inyectado (`src/cli/`).
-   [x] **T-1.5: [CORE] `SelectorEngine`.** Módulo de lógica pura que filtra un `MasterProfile` según la especialidad (tags): algoritmo de selección, firma principal e informe explicable. Especificación aprobada en `docs/selector-engine.md`.
    -   Hecho 2026-08-28: `src/core/selection/` (`selectForSpecialty`, `specialtyVocabulary`, `relevanceOf`; informe con motivos universal/matched/via-achievements/no-match). Suite con los ejemplos de la especificación y los seis invariantes canónicos (invariante 5 precisado en §2.5).
-   [x] **T-1.6: [TESTS] Pruebas unitarias.** Configurar `Jest` o `Vitest` para testear la lógica de los parsers y las funciones de selección de datos. Cobertura del 100% en la lógica de negocio.
    -   En curso 2026-08-28: harness adelantado (Vitest 4 + cobertura v8 con umbral 100 % sobre `src/core/**` y `src/parsers/**`; commit a700395). Umbral aplicado a `src/core`, `src/parsers`, `src/renderers`, `src/artifact`, `src/cli` y `src/shared`; solo queda fuera `src/index.ts` (cableado del proceso). Cerrada 2026-08-28 con T-1.8: 292 tests y el flujo completo documentado en README.md.
-   [x] **T-1.7: [GENERATOR] `MarkdownRenderer`.** Convierte un `MasterProfile` (seleccionado) en un CV en Markdown mediante Handlebars y un modelo de vista; plantilla base aprobada en `docs/selector-engine.md` §5.
    -   Hecho 2026-08-28: `src/renderers/markdown/` (`buildCvView` puro, etiquetas es/en por locale, fechas con Intl, orden cronológico, Handlebars `noEscape` + normalización) y `templates/cv.md.hbs`; golden `tests/fixtures/golden/cv-backend.md` = §5.4.
-   [x] **T-1.8: [CLI] Comando `generate-cv`.** Orquesta `profile.json` → `SelectorEngine` → `MarkdownRenderer` → `output/<cv>.md`. Culminación del MVP.
    -   Hecho 2026-08-28: `cv generate-cv [-s <id>] [-p artefacto] [-o salida] [-t plantilla] [-l locale] [--explain] [--stdout]`; lee y re-valida `profile.json`, avisa si alguna fuente es más reciente (nunca reconstruye por su cuenta), selecciona por especialidad o genera el CV completo, escribe `output/cv-<nombre>[-<especialidad>].md` con permisos 0600. README de uso con el flujo `validate → build-profile → generate-cv`.

### Hito 2: Evolución - Adaptación por Oferta de Empleo (Target: 1 semana post-MVP)

-   [x] **T-2.1: [NLP] Módulo de extracción de keywords de ofertas.** Implementar una función que reciba el texto de una oferta y extraiga entidades clave (tecnologías, skills) usando librerías como `natural` o, inicialmente, una combinación de regex y diccionarios predefinidos para mantenerlo ligero.
    -   Hecho 2026-08-28 (`docs/scoring.md` aprobado): `src/core/keywords/` — contrato `JobRequirements` (zod), el perfil como diccionario (tags + nombres y alias de skills), énfasis por secciones es/en, años exigidos, matching con límites propios y enmascarado, carencias con diccionario incorporado. Sin `natural`.
-   [x] **T-2.2: [CORE] Lógica de 'scoring' y selección.** Diseñar un algoritmo que puntúe los logros y skills del 'MasterProfile' en función de las keywords extraídas de la oferta.
    -   Hecho 2026-08-28: `src/core/scoring/` — especialidad virtual `offer` sobre `selectForSpecialty` sin cambios (`tailorToOffer`, con `--specialty` real opcional), `scoreSelection` aditivo (contenedor = propio + logros), reordenación solo de logros y skills, `MatchReport` con cobertura; informe `--explain` de adecuación (`formatMatchReport`).
-   [ ] **T-2.3: [GENERATOR] Mejorar el motor de plantillas.** Permitir que la plantilla renderice dinámicamente solo los 'N' mejores puntos para cada sección, basado en el scoring.
    -   Especificación conjunta con T-2.4 en `docs/trimming-cli.md` (2026-08-28, pendiente de aprobación): recorte en el núcleo (`trim.ts`), un solo ranking (puntuación · orden de documento), universales sin privilegio, límites `--top-n` / `--max-*` y preset `--compact`.
-   [ ] **T-2.4: [CLI] Ampliar la CLI.** Añadir el comando `generate --from-job-offer <path_to_offer.txt>`.
    -   Especificación conjunta con T-2.3 en `docs/trimming-cli.md` (2026-08-28, pendiente de aprobación): matriz `--from-job-offer` × `--specialty`, sufijo de oferta en el nombre de salida, `cv analyze-offer` (resumen / `--explain` / `--json`, stdin con `-`).
-   [ ] **T-2.5: [PARSER] Soporte básico para PDF (entrada).** Investigar e implementar `pdf-parse` para extraer texto de ofertas de empleo en formato PDF.
-   [ ] **T-2.6: [RENDER] Salida PDF (propuesto 2026-08-28).** Renderer PDF a partir de `profile.json` (evaluar `pandoc` frente a `puppeteer`, `docs/arquitectura.md` §2.5).

### Hito 3: Co-piloto de carrera - Matchmaking asistido por LLM (Propuesto 2026-08-28, pendiente de planificación)

Visión y restricciones en `docs/arquitectura.md` §3. Todo egreso de red es opt-in explícito; por defecto, modelos locales.

-   [ ] **T-3.1: [LLM] Abstracción `LlmService`.** Interfaz (`extractJobRequirements`, `tailorProfile`) con implementación local por defecto (Ollama) y proveedores remotos opcionales (Anthropic, OpenAI); claves solo por variables de entorno; doble de test.
-   [ ] **T-3.2: [INGEST] Texto de una oferta desde URL.** Obtención y saneado del HTML (`cheerio`); egreso de red explícito; sin persistir páginas.
-   [ ] **T-3.3: [LLM] Extracción estructurada de requisitos.** `JobRequirements` (skills, años, responsabilidades, keywords) validado con zod; caché local por hash de la oferta.
-   [ ] **T-3.4: [LLM] Perfil a medida y análisis de adecuación.** `TailoredResult { profile, analysis }` validado con zod; el perfil pasa por `parseMasterProfile`; envío minimizado (perfil filtrado por especialidad, sin datos de contacto).
-   [ ] **T-3.5: [CLI] Comando `match <url|fichero>`.** CV a medida + informe `strengths / perfectMatches / potentialGaps` en consola.

### Backlog (mejoras registradas; se priorizarán en la fase de consolidación «Hito 2.5», según el Director de Ingeniería)

-   [ ] **B-1: [CLI] `cv generate-cv --build`.** Recompilar el artefacto antes de generar, como atajo explícito del flujo `build-profile → generate-cv` (registrado 2026-08-28).
-   [ ] **B-2: [CLI] `cv init`.** Copiar el dataset de ejemplo a `data/sources/` para arrancar un perfil nuevo (registrado 2026-08-28).
-   [ ] **B-3: [CORE] Tag reservada `#pin`.** Fijar un ítem en cualquier oferta, no solo por especialidad (registrado 2026-08-28 en `docs/trimming-cli.md` §3.3).
