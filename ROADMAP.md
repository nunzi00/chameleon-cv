# Roadmap del Proyecto: Chameleon CV

## Stack Tecnológico: Node.js con TypeScript

## Épica: Generador de CVs Dinámicos

### Hito 1: MVP - Generador por Especialidad (Target: 3 días)

-   [x] **T-1.1: [CORE] Diseño del Esquema de Datos Unificado.** Definir una interfaz TypeScript ('MasterProfile') que represente de forma agnóstica toda la información de un candidato (datos personales, experiencia, proyectos, skills, logros).
    -   Hecho 2026-08-28: `src/core/schema/` (esquema zod como fuente única, tipos derivados, validación y saneado en tiempo de ejecución, unicidad de ids; 100 % de cobertura). Commits 9aee96e y a700395.
-   [ ] **T-1.2: [PARSER] Implementar parser para Markdown.** Crear un módulo usando una librería robusta como `marked` o `unified` para leer los ficheros .md y mapearlos a la interfaz 'MasterProfile'.
    -   Propuesta de formato del dataset (2026-08-28): `docs/formato-dataset.md`, pendiente de aprobación del Director. Spike `remark`/`unified` + `yaml` desde CommonJS (`require(esm)`, Node ≥ 22.12) verificado.
-   [ ] **T-1.3: [PARSER] Implementar parser para CSV.** Usar `csv-parse` para leer skills o proyectos desde un CSV y añadirlos al 'MasterProfile'.
-   [ ] **T-1.4: [GENERATOR] Implementar el motor de plantillas.** Configurar `Handlebars` o `EJS` para renderizar un CV en formato Markdown a partir de un 'MasterProfile' y una plantilla base.
-   [ ] **T-1.5: [CLI] Crear la interfaz de línea de comandos básica.** Implementar con `commander.js` o `yargs`. El comando principal será `npx ts-node src/index.ts generate --specialty <name> --data <path> --output <path>`.
-   [ ] **T-1.6: [TESTS] Pruebas unitarias.** Configurar `Jest` o `Vitest` para testear la lógica de los parsers y las funciones de selección de datos. Cobertura del 100% en la lógica de negocio.
    -   En curso 2026-08-28: harness adelantado (Vitest 4 + cobertura v8 con umbral 100 % sobre `src/core/**`, commit a700395). Pendiente: cubrir parsers y selección conforme se implementen T-1.2 a T-1.5.

### Hito 2: Evolución - Adaptación por Oferta de Empleo (Target: 1 semana post-MVP)

-   [ ] **T-2.1: [NLP] Módulo de extracción de keywords de ofertas.** Implementar una función que reciba el texto de una oferta y extraiga entidades clave (tecnologías, skills) usando librerías como `natural` o, inicialmente, una combinación de regex y diccionarios predefinidos para mantenerlo ligero.
-   [ ] **T-2.2: [CORE] Lógica de 'scoring' y selección.** Diseñar un algoritmo que puntúe los logros y skills del 'MasterProfile' en función de las keywords extraídas de la oferta.
-   [ ] **T-2.3: [GENERATOR] Mejorar el motor de plantillas.** Permitir que la plantilla renderice dinámicamente solo los 'N' mejores puntos para cada sección, basado en el scoring.
-   [ ] **T-2.4: [CLI] Ampliar la CLI.** Añadir el comando `generate --from-job-offer <path_to_offer.txt>`.
-   [ ] **T-2.5: [PARSER] Soporte básico para PDF (entrada).** Investigar e implementar `pdf-parse` para extraer texto de ofertas de empleo en formato PDF.
