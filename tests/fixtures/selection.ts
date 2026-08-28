import { parseMasterProfile, type MasterProfile, type MasterProfileInput } from '../../src/core/schema';

/** Dataset mínimo de `docs/selector-engine.md` §3, como entrada del esquema. */
export function selectionProfileInput(): MasterProfileInput {
  return {
    meta: { schemaVersion: 1, locale: 'es-ES' },
    personal: {
      fullName: 'Ada Ejemplo',
      headline: 'Ingeniera de software',
      summary: 'Resumen por defecto.',
      email: 'ada@example.com',
      location: { city: 'Madrid', country: 'España' },
      links: [{ label: 'GitHub', url: 'https://github.com/ada-ejemplo' }],
    },
    specialties: [
      {
        id: 'backend',
        title: 'Senior Backend Engineer',
        summary: 'APIs y sistemas distribuidos para esta especialidad.',
        tags: ['php', 'symfony', 'kubernetes'],
      },
      { id: 'engineering-manager', title: 'Engineering Manager', tags: ['liderazgo', 'gestion', 'agile'] },
    ],
    experience: [
      {
        id: 'exp-acme',
        company: 'ACME Corp',
        role: 'Senior Backend Engineer',
        location: 'Madrid (remoto)',
        dates: { start: '2021-03', end: '2024-06' },
        summary: 'Plataforma de pagos con 2 M de transacciones/mes.',
        technologies: ['PHP 8.3', 'Symfony 6.4', 'Kubernetes'],
        achievements: [
          { id: 'exp-acme-1', text: 'Reduje la latencia p95 un 40 %.', impact: '-40 % p95', tags: ['performance', 'php'] },
          { id: 'exp-acme-2', text: 'Lideré la migración a Kubernetes.', tags: ['kubernetes', 'liderazgo'] },
          { id: 'exp-acme-3', text: 'Mentoricé a 4 desarrolladores.', tags: ['liderazgo', 'gestion'] },
          { id: 'exp-acme-4', text: 'Responsable del área de pagos.' },
        ],
      },
      {
        id: 'exp-startup',
        company: 'Startup Ejemplo',
        role: 'Tech Lead',
        dates: { start: '2024-07' },
        tags: ['node.js', 'typescript'],
        achievements: [{ id: 'exp-startup-1', text: 'Definí la arquitectura del producto.', tags: ['arquitectura', 'typescript'] }],
      },
    ],
    projects: [
      {
        id: 'proj-platform',
        name: 'Plataforma interna',
        dates: { start: '2023' },
        tags: ['terraform'],
        achievements: [{ id: 'proj-platform-1', text: 'Diseñé el proceso de guardias (on-call).', tags: ['gestion'] }],
      },
    ],
    education: [
      { id: 'edu-uni', institution: 'Universidad Ejemplo', degree: 'Grado en Ingeniería Informática', field: 'Software', dates: { start: '2010', end: '2014' } },
    ],
    skills: [
      { id: 'skill-php', name: 'PHP', category: 'language', tags: ['php', 'backend'] },
      { id: 'skill-kubernetes', name: 'Kubernetes', category: 'platform', tags: ['kubernetes', 'devops'] },
      { id: 'skill-liderazgo', name: 'Liderazgo técnico', category: 'soft', tags: ['liderazgo'] },
      { id: 'skill-comunicacion', name: 'Comunicación', category: 'soft' },
    ],
    certifications: [{ id: 'cert-cka', name: 'CKA', issuer: 'CNCF', date: '2022-05', url: 'https://example.com/cert/cka', tags: ['kubernetes', 'devops'] }],
    achievements: [
      { id: 'ach-1', text: 'Ponente en una conferencia.', tags: ['comunidad'] },
      { id: 'ach-2', text: 'Mentora en un programa.', tags: ['liderazgo'] },
    ],
    languages: [
      { name: 'Español', level: 'native' },
      { name: 'Inglés', level: 'C1' },
    ],
  };
}

/** El mismo dataset ya validado y canónico. */
export function selectionProfile(): MasterProfile {
  return parseMasterProfile(selectionProfileInput());
}

/** Congela recursivamente un valor para que cualquier mutación lance en modo estricto. */
export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) {
      deepFreeze(child);
    }
  }
  return value;
}
