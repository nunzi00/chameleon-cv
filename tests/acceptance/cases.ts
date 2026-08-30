/**
 * Catálogo de escenarios de aceptación (T-5.5.1): la lista declarativa de flujos que el ejecutor
 * (`runner.ts`) recorre con el binario compilado sobre una copia temporal del banco de pruebas.
 * Cada paso declara sus argumentos, el código de salida esperado y los ficheros que produce; la
 * salida estándar y de error de cada paso se captura siempre (normalizada). Los escenarios son
 * independientes entre sí (cada uno arranca de una copia limpia); dentro de un escenario los pasos
 * son secuenciales y acumulan estado, como lo haría una persona.
 */
export type OutputKind = 'text' | 'json' | 'pdf' | 'tree';

export interface StepOutput {
  /** Ruta relativa al espacio de trabajo. */
  readonly path: string;
  readonly kind: OutputKind;
}

export interface Step {
  readonly id: string;
  readonly args: readonly string[];
  readonly stdin?: string | undefined;
  /** Variables de entorno adicionales solo para este paso. */
  readonly env?: Readonly<Record<string, string>> | undefined;
  readonly exitCode: number;
  readonly outputs?: readonly StepOutput[] | undefined;
  /** `api`: en lugar del binario, el cliente de la API (`api-client.ts`) arranca `cv serve` y recorre su secuencia fija. */
  readonly client?: 'api' | undefined;
}

export interface Scenario {
  readonly id: string;
  readonly description: string;
  /** `bench`: copia del banco; `empty`: directorio vacío. */
  readonly workspace: 'bench' | 'empty';
  /** Requiere el binario de Typst: se omite (de forma visible) si no hay ninguno. */
  readonly requires?: 'typst' | undefined;
  readonly steps: readonly Step[];
}

/** Puerto cerrado: cualquier proveedor local configurado ahí «no responde», haya o no un Ollama real en la máquina. */
const NO_LLM = { CHAMELEON_LLM_BASE_URL: 'http://127.0.0.1:9' } as const;

const LUMEN_OFFER = `Data Engineer\n\nRequisitos:\n- Python y SQL avanzados.\n- Spark y Airflow en producción.\n- Kafka para ingesta en tiempo real.\n\nValorable:\n- dbt y Snowflake.\n`;

export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'init',
    description: 'cv init en un directorio vacío: dataset de ejemplo, .gitignore y negativa a sobrescribir',
    workspace: 'empty',
    steps: [
      { id: 'init', args: ['init'], exitCode: 0, outputs: [{ path: 'data/sources', kind: 'tree' }, { path: '.gitignore', kind: 'text' }] },
      { id: 'init-again', args: ['init'], exitCode: 2 },
      { id: 'validate', args: ['validate'], exitCode: 0 },
      { id: 'build', args: ['build'], exitCode: 0, outputs: [{ path: 'data/dist/profile.json', kind: 'json' }] },
      { id: 'generate', args: ['generate-cv', '-s', 'backend', '-o', 'output/cv-ejemplo-backend.md'], exitCode: 0, outputs: [{ path: 'output/cv-ejemplo-backend.md', kind: 'text' }] },
    ],
  },
  {
    id: 'core',
    description: 'flujos deterministas del núcleo: build, generate-cv (Markdown y pdfkit), analyze-offer, vista previa del co-piloto, estado y temas',
    workspace: 'bench',
    steps: [
      { id: 'validate', args: ['validate'], exitCode: 0 },
      { id: 'build', args: ['build', '-v'], exitCode: 0, outputs: [{ path: 'data/dist/profile.json', kind: 'json' }] },
      { id: 'build-check', args: ['build', '--check'], exitCode: 0 },
      { id: 'generate-full-md', args: ['generate-cv', '-o', 'output/cv-full.md'], exitCode: 0, outputs: [{ path: 'output/cv-full.md', kind: 'text' }] },
      { id: 'generate-backend-md', args: ['generate-cv', '-s', 'backend', '-o', 'output/cv-backend.md'], exitCode: 0, outputs: [{ path: 'output/cv-backend.md', kind: 'text' }] },
      { id: 'generate-platform-md', args: ['generate-cv', '-s', 'platform', '-o', 'output/cv-platform.md'], exitCode: 0, outputs: [{ path: 'output/cv-platform.md', kind: 'text' }] },
      { id: 'generate-em-md', args: ['generate-cv', '-s', 'engineering-manager', '-o', 'output/cv-em.md'], exitCode: 0, outputs: [{ path: 'output/cv-em.md', kind: 'text' }] },
      { id: 'generate-data-en-md', args: ['generate-cv', '-s', 'data', '-l', 'en', '-o', 'output/cv-data-en.md'], exitCode: 0, outputs: [{ path: 'output/cv-data-en.md', kind: 'text' }] },
      { id: 'generate-backend-nexo-explain', args: ['generate-cv', '-s', 'backend', '-f', 'offers/nexo-senior-backend.txt', '--explain', '-o', 'output/cv-backend-nexo.md'], exitCode: 0, outputs: [{ path: 'output/cv-backend-nexo.md', kind: 'text' }] },
      { id: 'generate-orbita-pdf-compact', args: ['generate-cv', '-f', 'offers/pdf/orbita-platform-engineer.pdf', '--compact', '-o', 'output/cv-orbita-compact.md'], exitCode: 0, outputs: [{ path: 'output/cv-orbita-compact.md', kind: 'text' }] },
      { id: 'generate-backend-limits', args: ['generate-cv', '-s', 'backend', '-n', '2', '--max-skills', '6', '--max-projects', '1', '--max-certifications', '2', '-o', 'output/cv-backend-limits.md'], exitCode: 0, outputs: [{ path: 'output/cv-backend-limits.md', kind: 'text' }] },
      { id: 'generate-em-acme-en', args: ['generate-cv', '-s', 'engineering-manager', '-f', 'offers/acme-engineering-manager-en.txt', '-l', 'en', '-o', 'output/cv-em-acme-en.md'], exitCode: 0, outputs: [{ path: 'output/cv-em-acme-en.md', kind: 'text' }] },
      { id: 'generate-data-lumen', args: ['generate-cv', '-s', 'data', '-f', 'offers/lumen-data-engineer.txt', '-o', 'output/cv-data-lumen.md'], exitCode: 0, outputs: [{ path: 'output/cv-data-lumen.md', kind: 'text' }] },
      { id: 'generate-backend-stdout', args: ['generate-cv', '-s', 'backend', '--stdout'], exitCode: 0 },
      { id: 'generate-full-pdfkit', args: ['generate-cv', '--format', 'pdf', '-o', 'output/cv-full.pdfkit.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-full.pdfkit.pdf', kind: 'pdf' }] },
      { id: 'generate-backend-pdfkit', args: ['generate-cv', '-s', 'backend', '--format', 'pdf', '-o', 'output/cv-backend.pdfkit.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-backend.pdfkit.pdf', kind: 'pdf' }] },
      { id: 'generate-nexo-pdf-compact-pdfkit', args: ['generate-cv', '-s', 'backend', '-f', 'offers/pdf/nexo-senior-backend.pdf', '--compact', '--format', 'pdf', '-o', 'output/cv-backend-nexo-compact.pdfkit.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-backend-nexo-compact.pdfkit.pdf', kind: 'pdf' }] },
      { id: 'analyze-nexo', args: ['analyze-offer', 'offers/nexo-senior-backend.txt', '-s', 'backend'], exitCode: 0 },
      { id: 'analyze-nexo-explain', args: ['analyze-offer', 'offers/nexo-senior-backend.txt', '-s', 'backend', '--explain'], exitCode: 0 },
      { id: 'analyze-nexo-json', args: ['analyze-offer', 'offers/nexo-senior-backend.txt', '-s', 'backend', '--json'], exitCode: 0 },
      { id: 'analyze-orbita-pdf-explain', args: ['analyze-offer', 'offers/pdf/orbita-platform-engineer.pdf', '-s', 'platform', '--explain'], exitCode: 0 },
      { id: 'analyze-acme-en', args: ['analyze-offer', 'offers/acme-engineering-manager-en.txt', '-s', 'engineering-manager'], exitCode: 0 },
      { id: 'analyze-lumen-virtual', args: ['analyze-offer', 'offers/lumen-data-engineer.txt'], exitCode: 0 },
      { id: 'analyze-stdin', args: ['analyze-offer', '-', '-s', 'data'], stdin: LUMEN_OFFER, exitCode: 0 },
      { id: 'improve-dry-run', args: ['improve', '-s', 'backend', '--top-n', '3', '--dry-run', '--show-payload'], exitCode: 0 },
      { id: 'improve-show-prompt', args: ['improve', '--show-prompt'], exitCode: 0 },
      { id: 'summarize-dry-run', args: ['summarize', '-s', 'data', '-f', 'offers/lumen-data-engineer.txt', '--dry-run', '--show-payload'], exitCode: 0 },
      { id: 'suggest-tags-dry-run', args: ['suggest', 'tags', '--only', 'exp-nexo-pasarela,exp-orbita-cloud-1', '--dry-run', '--show-payload'], exitCode: 0 },
      { id: 'suggest-tags-text-dry-run', args: ['suggest', 'tags', 'Migré la plataforma a Kubernetes sin ventana de parada', '-s', 'platform', '--dry-run', '--show-payload'], exitCode: 0 },
      { id: 'llm-status', args: ['llm', 'status'], env: NO_LLM, exitCode: 2 },
      { id: 'llm-status-openai-sin-clave', args: ['llm', 'status', '--provider', 'openai'], env: NO_LLM, exitCode: 2 },
      { id: 'theme-list', args: ['theme', 'list'], exitCode: 0 },
      { id: 'theme-path-bench', args: ['theme', 'path', 'bench'], exitCode: 0 },
      { id: 'theme-path-nada', args: ['theme', 'path', 'nada'], exitCode: 1 },
      { id: 'typst-status-ausente', args: ['typst', 'status'], exitCode: 2 },
      { id: 'generate-backend-seleccion', args: ['generate-cv', '-s', 'backend', '--skills', 'PHP,kubernetes,Inexistente', '--projects', 'proj-kafka-guardian,Pipeline Demo', '--explain', '-o', 'output/cv-backend-seleccion.md'], exitCode: 0, outputs: [{ path: 'output/cv-backend-seleccion.md', kind: 'text' }] },
      { id: 'analyze-nexo-historial', args: ['analyze-offer', 'offers/nexo-senior-backend.txt', '-s', 'backend'], exitCode: 0 },
    ],
  },
  {
    id: 'typst',
    description: 'PDF de calidad editorial con Typst: los cinco temas distribuidos (T-8.3: modern, academic y minimal con el CV completo y cada especialidad), tema del proyecto con cv.toml, oferta en PDF y tema creado',
    workspace: 'bench',
    requires: 'typst',
    steps: [
      { id: 'build', args: ['build'], exitCode: 0 },
      { id: 'typst-status', args: ['typst', 'status'], exitCode: 0 },
      { id: 'generate-backend-typst-default', args: ['generate-cv', '-s', 'backend', '--format', 'pdf', '--engine', 'typst', '--theme', 'default', '-o', 'output/cv-backend.typst-default.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-backend.typst-default.pdf', kind: 'pdf' }] },
      { id: 'generate-backend-typst-classic', args: ['generate-cv', '-s', 'backend', '--format', 'pdf', '--engine', 'typst', '--theme', 'classic', '-o', 'output/cv-backend.typst-classic.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-backend.typst-classic.pdf', kind: 'pdf' }] },
      { id: 'generate-full-typst-bench-explain', args: ['generate-cv', '--format', 'pdf', '--engine', 'typst', '--explain', '-o', 'output/cv-full.typst-bench.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-full.typst-bench.pdf', kind: 'pdf' }] },
      { id: 'generate-data-en-typst-classic', args: ['generate-cv', '-s', 'data', '-l', 'en', '--format', 'pdf', '--engine', 'typst', '--theme', 'classic', '-o', 'output/cv-data-en.typst-classic.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-data-en.typst-classic.pdf', kind: 'pdf' }] },
      { id: 'generate-full-typst-modern', args: ['generate-cv', '--format', 'pdf', '--engine', 'typst', '--theme', 'modern', '-o', 'output/cv-full.typst-modern.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-full.typst-modern.pdf', kind: 'pdf' }] },
      { id: 'generate-backend-typst-modern', args: ['generate-cv', '-s', 'backend', '--format', 'pdf', '--engine', 'typst', '--theme', 'modern', '-o', 'output/cv-backend.typst-modern.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-backend.typst-modern.pdf', kind: 'pdf' }] },
      { id: 'generate-data-en-typst-modern', args: ['generate-cv', '-s', 'data', '-l', 'en', '--format', 'pdf', '--engine', 'typst', '--theme', 'modern', '-o', 'output/cv-data-en.typst-modern.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-data-en.typst-modern.pdf', kind: 'pdf' }] },
      { id: 'generate-platform-typst-modern', args: ['generate-cv', '-s', 'platform', '--format', 'pdf', '--engine', 'typst', '--theme', 'modern', '-o', 'output/cv-platform.typst-modern.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-platform.typst-modern.pdf', kind: 'pdf' }] },
      { id: 'generate-full-typst-academic', args: ['generate-cv', '--format', 'pdf', '--engine', 'typst', '--theme', 'academic', '-o', 'output/cv-full.typst-academic.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-full.typst-academic.pdf', kind: 'pdf' }] },
      { id: 'generate-backend-typst-academic', args: ['generate-cv', '-s', 'backend', '--format', 'pdf', '--engine', 'typst', '--theme', 'academic', '-o', 'output/cv-backend.typst-academic.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-backend.typst-academic.pdf', kind: 'pdf' }] },
      { id: 'generate-data-en-typst-academic', args: ['generate-cv', '-s', 'data', '-l', 'en', '--format', 'pdf', '--engine', 'typst', '--theme', 'academic', '-o', 'output/cv-data-en.typst-academic.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-data-en.typst-academic.pdf', kind: 'pdf' }] },
      { id: 'generate-platform-typst-academic', args: ['generate-cv', '-s', 'platform', '--format', 'pdf', '--engine', 'typst', '--theme', 'academic', '-o', 'output/cv-platform.typst-academic.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-platform.typst-academic.pdf', kind: 'pdf' }] },
      { id: 'generate-full-typst-minimal', args: ['generate-cv', '--format', 'pdf', '--engine', 'typst', '--theme', 'minimal', '-o', 'output/cv-full.typst-minimal.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-full.typst-minimal.pdf', kind: 'pdf' }] },
      { id: 'generate-backend-typst-minimal', args: ['generate-cv', '-s', 'backend', '--format', 'pdf', '--engine', 'typst', '--theme', 'minimal', '-o', 'output/cv-backend.typst-minimal.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-backend.typst-minimal.pdf', kind: 'pdf' }] },
      { id: 'generate-data-en-typst-minimal', args: ['generate-cv', '-s', 'data', '-l', 'en', '--format', 'pdf', '--engine', 'typst', '--theme', 'minimal', '-o', 'output/cv-data-en.typst-minimal.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-data-en.typst-minimal.pdf', kind: 'pdf' }] },
      { id: 'generate-platform-typst-minimal', args: ['generate-cv', '-s', 'platform', '--format', 'pdf', '--engine', 'typst', '--theme', 'minimal', '-o', 'output/cv-platform.typst-minimal.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-platform.typst-minimal.pdf', kind: 'pdf' }] },
      { id: 'generate-nexo-pdf-compact-typst', args: ['generate-cv', '-s', 'backend', '-f', 'offers/pdf/nexo-senior-backend.pdf', '--compact', '--format', 'pdf', '--engine', 'typst', '-o', 'output/cv-backend-nexo-compact.typst-bench.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-backend-nexo-compact.typst-bench.pdf', kind: 'pdf' }] },
      { id: 'theme-create-mio', args: ['theme', 'create', 'mio', '--from', 'bench'], exitCode: 0, outputs: [{ path: 'themes/mio/theme.toml', kind: 'text' }, { path: 'themes/mio/template.typ', kind: 'text' }] },
      { id: 'generate-platform-typst-mio', args: ['generate-cv', '-s', 'platform', '--format', 'pdf', '--engine', 'typst', '--theme', 'mio', '--explain', '-o', 'output/cv-platform.typst-mio.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-platform.typst-mio.pdf', kind: 'pdf' }] },
      { id: 'generate-theme-nada', args: ['generate-cv', '-s', 'platform', '--format', 'pdf', '--engine', 'typst', '--theme', 'nada'], exitCode: 1 },
      { id: 'theme-install-comunidad', args: ['theme', 'install', 'themes/comunidad.zip'], exitCode: 0 },
      { id: 'generate-data-typst-comunidad', args: ['generate-cv', '-s', 'data', '--format', 'pdf', '--engine', 'typst', '--theme', 'comunidad', '-o', 'output/cv-data.typst-comunidad.pdf'], exitCode: 0, outputs: [{ path: 'output/cv-data.typst-comunidad.pdf', kind: 'pdf' }] },
    ],
  },
  {
    id: 'apply',
    description: 'cv improve apply sobre revisiones marcadas: cambio mínimo, copia .bak, negativa a repetir y recompilación',
    workspace: 'bench',
    steps: [
      { id: 'build', args: ['build'], exitCode: 0 },
      { id: 'apply-improve-dry-run', args: ['improve', 'apply', 'reviews/revision-improve-marcada.md', '--dry-run'], exitCode: 0 },
      { id: 'apply-improve', args: ['improve', 'apply', 'reviews/revision-improve-marcada.md'], exitCode: 0, outputs: [{ path: 'data/sources/experience/nexo-pagos.md', kind: 'text' }, { path: 'data/sources/experience/nexo-pagos.md.bak', kind: 'text' }] },
      { id: 'apply-summarize', args: ['improve', 'apply', 'reviews/revision-summarize-backend-marcada.md'], exitCode: 0, outputs: [{ path: 'data/sources/specialties/backend.md', kind: 'text' }, { path: 'data/sources/specialties/backend.md.bak', kind: 'text' }] },
      { id: 'apply-improve-again', args: ['improve', 'apply', 'reviews/revision-improve-marcada.md'], exitCode: 1 },
      { id: 'build-after', args: ['build', '-v'], exitCode: 0 },
      { id: 'generate-backend-after', args: ['generate-cv', '-s', 'backend', '-o', 'output/cv-backend-aplicado.md'], exitCode: 0, outputs: [{ path: 'output/cv-backend-aplicado.md', kind: 'text' }] },
    ],
  },
  {
    id: 'theme',
    description: 'gestión de temas sin Typst: create, list, path, negativa a sobrescribir e instalación desde archivos y directorios locales con origen y verify (T-8.3; sin red por diseño)',
    workspace: 'bench',
    steps: [
      { id: 'theme-create-mio', args: ['theme', 'create', 'mio', '--from', 'classic'], exitCode: 0, outputs: [{ path: 'themes/mio/theme.toml', kind: 'text' }, { path: 'themes/mio/template.typ', kind: 'text' }] },
      { id: 'theme-create-again', args: ['theme', 'create', 'mio'], exitCode: 1 },
      { id: 'theme-create-default-shadow', args: ['theme', 'create', 'default'], exitCode: 0, outputs: [{ path: 'themes/default/theme.toml', kind: 'text' }] },
      { id: 'theme-list', args: ['theme', 'list'], exitCode: 0 },
      { id: 'theme-path-mio', args: ['theme', 'path', 'mio'], exitCode: 0 },
      { id: 'theme-install-dry-run', args: ['theme', 'install', 'themes/comunidad.zip', '--dry-run'], exitCode: 0 },
      { id: 'theme-install-comunidad', args: ['theme', 'install', 'themes/comunidad.zip'], exitCode: 0, outputs: [{ path: 'themes/comunidad', kind: 'tree' }] },
      { id: 'theme-list-origen', args: ['theme', 'list', '--verify'], exitCode: 0 },
      { id: 'theme-verify-comunidad', args: ['theme', 'verify', 'comunidad'], exitCode: 0 },
      { id: 'theme-install-existente', args: ['theme', 'install', 'themes/comunidad-v2.tar.gz'], exitCode: 1 },
      { id: 'theme-install-replace-v2', args: ['theme', 'install', 'themes/comunidad-v2.tar.gz', '--replace'], exitCode: 0 },
      { id: 'theme-verify-tras-replace', args: ['theme', 'verify', 'comunidad'], exitCode: 0 },
      { id: 'theme-verify-todos', args: ['theme', 'verify'], exitCode: 0 },
      { id: 'theme-verify-mio-sin-origen', args: ['theme', 'verify', 'mio'], exitCode: 0 },
      { id: 'theme-verify-distribuido', args: ['theme', 'verify', 'classic'], exitCode: 1 },
      { id: 'theme-install-as-sha256', args: ['theme', 'install', 'themes/comunidad.zip', '--as', 'otra', '--sha256', 'bfbc3701c2d7c867d37baf107197d39efdb0845e7211564fdd9820244fe7092e'], exitCode: 0, outputs: [{ path: 'themes/otra/theme.toml', kind: 'text' }] },
      { id: 'theme-install-sha256-distinta', args: ['theme', 'install', 'themes/comunidad.zip', '--as', 'otra-mas', '--sha256', '0000000000000000000000000000000000000000000000000000000000000000'], exitCode: 1 },
      { id: 'theme-install-directorio', args: ['theme', 'install', 'themes/mio', '--as', 'copia-mio'], exitCode: 0, outputs: [{ path: 'themes/copia-mio', kind: 'tree' }] },
      { id: 'theme-install-escapa', args: ['theme', 'install', 'themes/escapa.zip'], exitCode: 1 },
      { id: 'theme-install-sin-plantilla', args: ['theme', 'install', 'themes/sin-plantilla.zip'], exitCode: 1 },
      { id: 'theme-install-nombre-malo', args: ['theme', 'install', 'themes/nombre-malo.zip'], exitCode: 1 },
      { id: 'theme-install-http', args: ['theme', 'install', 'http://ejemplo.org/tema.zip'], exitCode: 1 },
      { id: 'theme-install-https-sin-terminal', args: ['theme', 'install', 'https://ejemplo.org/tema.zip'], exitCode: 2 },
      { id: 'theme-install-inexistente', args: ['theme', 'install', 'themes/no-existe.zip'], exitCode: 2 },
    ],
  },
  {
    id: 'portability',
    description: 'cv export y cv import: exportación por stdout y a fichero, plan con auto-chequeo, importación a un directorio nuevo y la ida y vuelta en vivo, sustitución con copia, y los errores',
    workspace: 'bench',
    steps: [
      { id: 'export-stdout', args: ['export'], exitCode: 0 },
      { id: 'export-file', args: ['export', '-o', 'output/perfil.json'], exitCode: 0, outputs: [{ path: 'output/perfil.json', kind: 'json' }] },
      { id: 'import-dry-run', args: ['import', 'output/perfil.json', '--data', 'data/importado', '--dry-run'], exitCode: 0 },
      { id: 'import', args: ['import', 'output/perfil.json', '--data', 'data/importado'], exitCode: 0, outputs: [{ path: 'data/importado', kind: 'tree' }] },
      { id: 'export-imported', args: ['export', '--data', 'data/importado'], exitCode: 0 },
      { id: 'build-imported', args: ['build', '--data', 'data/importado', '--out', 'output/importado.json', '-v'], exitCode: 0 },
      { id: 'import-occupied', args: ['import', 'output/perfil.json', '--data', 'data/importado'], exitCode: 1 },
      { id: 'import-replace', args: ['import', 'output/perfil.json', '--data', 'data/importado', '--replace'], exitCode: 0, outputs: [{ path: 'data/importado', kind: 'tree' }] },
      { id: 'import-stdin-reordered', args: ['import', '-', '--data', 'data/minimo'], stdin: '{"personal":{"fullName":"Ana Mínima","email":"ana@example.com"},"experience":[{"id":"exp-zeta","company":"Zeta","role":"Dev","dates":{"start":"2020"}},{"id":"exp-alfa","company":"Alfa","role":"Dev","dates":{"start":"2018","end":"2019"}}]}\n', exitCode: 0, outputs: [{ path: 'data/minimo', kind: 'tree' }] },
      { id: 'import-invalid-json', args: ['import', 'offers/nexo-senior-backend.txt', '--data', 'data/nuevo'], exitCode: 1 },
      { id: 'import-invalid-schema', args: ['import', '-', '--data', 'data/nuevo'], stdin: '{"meta":{"schemaVersion":2},"personal":{"fullName":""},"experience":[{"id":"X"}],"extra":1}\n', exitCode: 1 },
      { id: 'import-unrepresentable', args: ['import', '-', '--data', 'data/nuevo'], stdin: '{"personal":{"fullName":"Ana"},"achievements":[{"id":"a","text":"Hice #cosas"}]}\n', exitCode: 1 },
      { id: 'import-missing-file', args: ['import', 'no-existe.json', '--data', 'data/nuevo'], exitCode: 2 },
    ],
  },
  {
    id: 'config',
    description: 'configuración del co-piloto (T-8.2): cv llm status con cv.toml y orígenes, proveedores del registro con cuota publicada, y cv llm key set|list|remove sin mostrar nunca una clave',
    workspace: 'bench',
    steps: [
      { id: 'llm-status', args: ['llm', 'status'], env: NO_LLM, exitCode: 2 },
      { id: 'llm-status-model-flag', args: ['llm', 'status', '--provider', 'openai-compatible', '--model', 'de-la-orden'], env: { ...NO_LLM, CHAMELEON_LLM_MODEL: 'del-entorno' }, exitCode: 2 },
      { id: 'key-list-vacio', args: ['llm', 'key', 'list'], exitCode: 0 },
      { id: 'llm-status-groq-sin-clave', args: ['llm', 'status', '--provider', 'groq'], env: NO_LLM, exitCode: 2 },
      { id: 'key-set-groq', args: ['llm', 'key', 'set', 'groq'], stdin: 'gsk_clave_de_prueba\n', exitCode: 0 },
      { id: 'key-list-con-groq', args: ['llm', 'key', 'list'], exitCode: 0 },
      { id: 'key-set-desconocido', args: ['llm', 'key', 'set', 'gemini'], stdin: 'x\n', exitCode: 1 },
      { id: 'key-set-vacia', args: ['llm', 'key', 'set', 'openai'], stdin: '\n', exitCode: 2 },
      { id: 'key-remove-groq', args: ['llm', 'key', 'remove', 'groq'], exitCode: 0 },
      { id: 'key-remove-otra-vez', args: ['llm', 'key', 'remove', 'groq'], exitCode: 0 },
      { id: 'key-list-final', args: ['llm', 'key', 'list'], exitCode: 0 },
    ],
  },
  {
    id: 'errors',
    description: 'errores de uso y de datos con códigos de salida estables',
    workspace: 'bench',
    steps: [
      { id: 'engine-conflict', args: ['generate-cv', '--format', 'pdf', '--engine', 'typst', '--stdout'], exitCode: 2 },
      { id: 'theme-sin-typst', args: ['generate-cv', '--theme', 'classic'], exitCode: 2 },
      { id: 'sin-artefacto', args: ['generate-cv', '-s', 'backend'], exitCode: 1 },
      { id: 'build', args: ['build'], exitCode: 0 },
      { id: 'especialidad-desconocida', args: ['generate-cv', '-s', 'nope'], exitCode: 1 },
      { id: 'oferta-inexistente', args: ['analyze-offer', 'offers/nope.txt'], exitCode: 2 },
      { id: 'fuentes-inexistentes', args: ['build', '-d', 'nope'], exitCode: 1 },
      { id: 'revision-inexistente', args: ['improve', 'apply', 'reviews/nope.md'], exitCode: 1 },
      { id: 'theme-nombre-invalido', args: ['theme', 'path', '../x'], exitCode: 1 },
      { id: 'motor-desconocido', args: ['generate-cv', '--format', 'pdf', '--engine', 'latex'], exitCode: 2 },
    ],
  },
  {
    id: 'serve',
    description: 'la API local (cv serve): seguridad (401, 403, 404, 405), fuentes con If-Match, validar, compilar, perfil, generar (Markdown y PDF con oferta), salida, análisis, temas y errores de esquema; respuestas byte a byte',
    workspace: 'bench',
    steps: [
      {
        id: 'api',
        client: 'api',
        args: [],
        env: NO_LLM,
        exitCode: 0,
        outputs: [
          { path: 'data/sources/projects/api-proyecto.md', kind: 'text' },
          { path: 'themes/api-tema', kind: 'tree' },
          { path: 'output/cv-lucia-ferrer-montalban-backend.md', kind: 'text' },
          { path: 'output/cv-lucia-ferrer-montalban-backend-nexo-senior-backend.pdf', kind: 'pdf' },
        ],
      },
    ],
  },
];
