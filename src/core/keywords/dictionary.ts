/**
 * Diccionario incorporado (`docs/scoring.md` §2): tecnologías y prácticas habituales, usado
 * **solo** para detectar carencias (lo que la oferta pide y el perfil no tiene etiquetado).
 * Nunca puntúa. Términos normalizados: minúsculas, sin acentos.
 */
export const DEFAULT_DICTIONARY: readonly string[] = [
  // Lenguajes
  'php', 'python', 'java', 'javascript', 'typescript', 'go', 'golang', 'rust', 'c', 'c++', 'c#', 'ruby', 'kotlin', 'swift', 'scala',
  'elixir', 'erlang', 'haskell', 'perl', 'bash', 'sql', 'html', 'css',
  // Frameworks y librerías
  'symfony', 'laravel', 'django', 'flask', 'fastapi', 'spring', 'spring boot', 'express', 'nestjs', 'next.js', 'nuxt', 'react',
  'angular', 'vue', 'svelte', 'node.js', '.net', 'asp.net', 'rails', 'ruby on rails', 'doctrine', 'hibernate', 'graphql', 'grpc',
  'rest', 'api rest', 'openapi', 'websockets',
  // Datos y mensajería
  'postgresql', 'postgres', 'mysql', 'mariadb', 'mongodb', 'redis', 'elasticsearch', 'opensearch', 'kafka', 'rabbitmq', 'sqs',
  'pub/sub', 'cassandra', 'dynamodb', 'bigquery', 'snowflake', 'clickhouse', 'sqlite', 'oracle', 'sql server', 'etl',
  // Cloud e infraestructura
  'aws', 'amazon web services', 'gcp', 'google cloud', 'azure', 'kubernetes', 'k8s', 'docker', 'terraform', 'ansible', 'helm',
  'argocd', 'nginx', 'apache', 'linux', 'serverless', 'lambda', 'cloud run', 'ecs', 'eks', 'gke', 'openshift', 'vagrant',
  // Prácticas y calidad
  'ci/cd', 'devops', 'sre', 'observabilidad', 'observability', 'monitorizacion', 'monitoring', 'prometheus', 'grafana', 'datadog',
  'new relic', 'sentry', 'logging', 'tracing', 'opentelemetry', 'tdd', 'bdd', 'ddd', 'clean architecture', 'hexagonal', 'cqrs',
  'event sourcing', 'microservicios', 'microservices', 'event-driven', 'testing', 'unit testing', 'integration testing', 'phpunit',
  'jest', 'cypress', 'playwright', 'seguridad', 'security', 'oauth', 'oauth2', 'openid', 'jwt', 'saml', 'gdpr', 'pci',
  'performance', 'rendimiento', 'escalabilidad', 'scalability', 'alta disponibilidad', 'high availability', 'caching', 'cdn',
  // Metodologías y gestión
  'agile', 'scrum', 'kanban', 'lean', 'okr', 'jira', 'confluence', 'git', 'github', 'gitlab', 'bitbucket', 'code review',
  'pair programming', 'mentoring', 'mentoria', 'liderazgo', 'leadership', 'tech lead', 'team lead', 'engineering manager',
  'product', 'producto', 'stakeholders', 'roadmap', 'arquitectura', 'architecture',
  // Datos e IA
  'machine learning', 'deep learning', 'nlp', 'llm', 'openai', 'langchain', 'pandas', 'numpy', 'spark', 'airflow', 'dbt',
  // Otros
  'ios', 'android', 'react native', 'flutter', 'wordpress', 'shopify', 'magento', 'salesforce', 'sap', 'hubspot', 'stripe',
  'i18n', 'accesibilidad', 'accessibility', 'ux', 'ui', 'figma',
];
