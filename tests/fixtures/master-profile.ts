import type { MasterProfileInput } from '../../src/core/schema';

/** Perfil mínimo válido: solo el nombre; el resto lo rellenan los valores por defecto. */
export function minimalProfileInput(): MasterProfileInput {
  return { personal: { fullName: 'Ada Ejemplo' } };
}

/**
 * Perfil sintético completo que ejercita todas las secciones y la normalización
 * (texto sin recortar, tags en mayúsculas, duplicados). No contiene datos reales.
 */
export function fullProfileInput(): MasterProfileInput {
  return {
    meta: { schemaVersion: 1, locale: 'es-ES', updatedAt: '2026-08-28' },
    personal: {
      fullName: '  Ada Ejemplo  ',
      headline: 'Ingeniera de software',
      summary: 'Primera línea.\nSegunda línea con\ttabulador.',
      email: 'ada@example.com',
      phone: '+34 600 000 000',
      location: { city: 'Madrid', region: 'Comunidad de Madrid', country: 'España' },
      links: [{ label: 'GitHub', url: 'https://github.com/ada-ejemplo' }],
    },
    specialties: [
      {
        id: 'backend',
        title: 'Senior Backend Engineer',
        summary: 'APIs y sistemas distribuidos.',
        tags: ['PHP', 'node.js', 'kubernetes'],
      },
    ],
    experience: [
      {
        id: 'exp-acme',
        company: 'ACME Corp',
        role: 'Senior Backend Engineer',
        location: 'Madrid (remoto)',
        dates: { start: '2021-03', end: '2024-06' },
        summary: 'Plataforma de pagos.',
        technologies: [' PHP 8 ', 'PHP 8', 'Symfony'],
        achievements: [
          {
            id: 'ach-acme-latency',
            text: 'Reduje la latencia p95 un **40 %**.',
            impact: '-40 % p95',
            date: '2023',
            tags: ['performance', 'php'],
          },
        ],
        tags: ['PHP', ' php ', 'Symfony'],
      },
      { id: 'exp-current', company: 'Startup', role: 'Tech Lead', dates: { start: '2024-07' } },
    ],
    projects: [
      {
        id: 'proj-cli',
        name: 'Chameleon CLI',
        role: 'Autora',
        url: 'https://example.com/chameleon',
        dates: { start: '2026-08' },
        technologies: ['TypeScript'],
        tags: ['typescript', 'cli'],
      },
    ],
    education: [
      {
        id: 'edu-uni',
        institution: 'Universidad Ejemplo',
        degree: 'Grado en Ingeniería Informática',
        field: 'Software',
        dates: { start: '2010', end: '2014' },
      },
    ],
    skills: [
      {
        id: 'skill-kubernetes',
        name: 'Kubernetes',
        category: 'platform',
        level: 'advanced',
        years: 5,
        aliases: ['K8S', 'k8s'],
        tags: ['kubernetes', 'devops'],
      },
      { id: 'skill-php', name: 'PHP' },
    ],
    achievements: [{ id: 'ach-talk', text: 'Ponente en una conferencia de ejemplo.', tags: ['comunidad'] }],
    certifications: [
      {
        id: 'cert-cka',
        name: 'CKA',
        issuer: 'CNCF',
        date: '2022-05-10',
        url: 'https://example.com/cert',
        tags: ['kubernetes'],
      },
    ],
    languages: [
      { name: 'Español', level: 'native' },
      { name: 'Inglés', level: 'C1' },
    ],
  };
}
