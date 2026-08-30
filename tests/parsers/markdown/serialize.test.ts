import { describe, expect, it } from 'vitest';

import type { Achievement, Education, Experience, MasterProfile, Project, Specialty } from '../../../src/core/schema';
import { entityKindForDirectory, parseEntityFile } from '../../../src/parsers/markdown/entities';
import { parseFrontmatter } from '../../../src/parsers/markdown/frontmatter';
import { parseAchievementsFile } from '../../../src/parsers/markdown/markdown-parser';
import { parseProfileFile } from '../../../src/parsers/markdown/profile';
import {
  achievementLines,
  achievementProblem,
  assignFileNames,
  entityFileName,
  serializeAchievementList,
  serializeAchievementsFile,
  serializeEducation,
  serializeExperience,
  serializeFrontmatter,
  serializeProfileFile,
  serializeProject,
  serializeSpecialty,
} from '../../../src/parsers/markdown/serialize';

function kind(directory: string) {
  const found = entityKindForDirectory(directory);
  if (found === undefined) {
    throw new Error(directory);
  }
  return found;
}

function contribution(directory: string, fileName: string, content: string): unknown {
  const result = parseEntityFile(kind(directory), fileName, content, `${directory}/${fileName}.md`);
  if (!result.ok) {
    throw new Error(result.errors.map((error) => `${error.line}: ${error.message}`).join('\n'));
  }
  return (result.contribution as Record<string, unknown[]>)[directory]?.[0];
}

describe('entityFileName', () => {
  it('quita el prefijo por defecto cuando lo que queda es un nombre válido; si no, id completo y explícito', () => {
    expect(entityFileName('experience', 'exp-acme')).toEqual({ fileName: 'acme', explicitId: false });
    expect(entityFileName('projects', 'proj-cv-2024')).toEqual({ fileName: 'cv-2024', explicitId: false });
    expect(entityFileName('education', 'edu-uni')).toEqual({ fileName: 'uni', explicitId: false });
    expect(entityFileName('experience', 'acme-corp')).toEqual({ fileName: 'acme-corp', explicitId: true });
    expect(entityFileName('experience', 'exp--x')).toEqual({ fileName: 'exp--x', explicitId: true });
    expect(entityFileName('experience', 'exp-')).toEqual({ fileName: 'exp-', explicitId: true });
    expect(entityFileName('specialties', 'backend')).toEqual({ fileName: 'backend', explicitId: false });
  });

  it('resuelve las colisiones con el primer sufijo libre y id explícito', () => {
    const names = assignFileNames('experience', ['exp-acme', 'exp-acme-2', 'acme', 'exp-zeta']);
    expect([...names.entries()]).toEqual([
      ['exp-acme', { fileName: 'acme', explicitId: false }],
      ['exp-acme-2', { fileName: 'acme-2', explicitId: false }],
      ['acme', { fileName: 'acme-3', explicitId: true }],
      ['exp-zeta', { fileName: 'zeta', explicitId: false }],
    ]);
  });
});

describe('serializeFrontmatter', () => {
  it('entrecomilla solo lo que YAML exige, pone las listas de escalares en flujo y omite ausentes y vacíos', () => {
    const yaml = serializeFrontmatter([
      ['company', 'ACME: Corp'],
      ['role', 'Senior #1'],
      ['start', '2021-03'],
      ['end', '2024'],
      ['count', 'yes'],
      ['spaced', ' x '],
      ['quoted', 'Dijo "hola"'],
      ['missing', undefined],
      ['none', []],
      ['tags', ['php', 'c++', '#x']],
      ['location', { city: 'Madrid', region: undefined, country: 'España' }],
      ['links', [{ label: 'Web: mía', url: 'https://x.example', extra: undefined }]],
      ['schemaVersion', 1],
    ]);
    expect(yaml).toBe(
      [
        '---',
        'company: "ACME: Corp"',
        'role: "Senior #1"',
        'start: 2021-03',
        'end: "2024"',
        'count: yes',
        'spaced: " x "',
        'quoted: Dijo "hola"',
        'tags: [php, c++, "#x"]',
        'location:',
        '  city: Madrid',
        '  country: España',
        'links:',
        '  - label: "Web: mía"',
        '    url: https://x.example',
        'schemaVersion: 1',
        '---',
        '',
      ].join('\n'),
    );
    const parsed = parseFrontmatter(yaml.slice('---\n'.length, -'---\n'.length), 'x.md', 1);
    expect(parsed.ok && parsed.frontmatter.data).toEqual({
      company: 'ACME: Corp',
      role: 'Senior #1',
      start: '2021-03',
      end: '2024',
      count: 'yes',
      spaced: ' x ',
      quoted: 'Dijo "hola"',
      tags: ['php', 'c++', '#x'],
      location: { city: 'Madrid', country: 'España' },
      links: [{ label: 'Web: mía', url: 'https://x.example' }],
      schemaVersion: '1',
    });
  });
});

describe('logros', () => {
  it('detecta los textos que el parser no leería igual', () => {
    expect(achievementProblem({ text: 'Línea 1\nlínea 2' })).toMatch(/saltos de línea/);
    expect(achievementProblem({ text: 'Mejoré el #rendimiento' })).toMatch(/«#rendimiento»/);
    expect(achievementProblem({ text: 'Solo un #' })).toBeUndefined();
    expect(achievementProblem({ text: 'Con #tag en medio del texto' })).toBeUndefined();
    expect(achievementProblem({ text: '' })).toBeUndefined();
  });

  it('escribe la viñeta con etiquetas finales y los metadatos presentes; el id solo si no es el derivado', () => {
    const full: Achievement = { id: 'custom', text: 'Reduje la latencia', impact: '-40 % p95', date: '2023-05', tags: ['perf', 'php'] };
    expect(achievementLines(full, 'exp-acme-1')).toEqual(['- Reduje la latencia #perf #php', '  - id: custom', '  - impact: -40 % p95', '  - date: 2023-05']);
    const bare: Achievement = { id: 'exp-acme-1', text: 'Hice cosas', tags: [] };
    expect(achievementLines(bare, 'exp-acme-1')).toEqual(['- Hice cosas']);
    expect(serializeAchievementList([bare, { ...full, id: 'exp-acme-2', impact: undefined, date: undefined }], 'exp-acme')).toBe(
      '- Hice cosas\n- Reduje la latencia #perf #php\n',
    );
  });

  it('achievements.md vuelve igual por el parser real (ids ach-<n> por defecto y explícitos)', () => {
    const items: Achievement[] = [
      { id: 'ach-1', text: 'Charla en una conferencia', tags: ['talks'] },
      { id: 'premio', text: 'Premio interno: mejor equipo', impact: 'Reconocimiento', date: '2022', tags: [] },
    ];
    const content = serializeAchievementsFile(items);
    expect(content).toBe('- Charla en una conferencia #talks\n- Premio interno: mejor equipo\n  - id: premio\n  - impact: Reconocimiento\n  - date: 2022\n');
    const parsed = parseAchievementsFile(content, 'achievements.md');
    expect(parsed.ok && parsed.contribution.achievements).toEqual(items);
  });
});

describe('ficheros de entidad y profile.md: la ida y vuelta por los parsers reales', () => {
  const experience: Experience = {
    id: 'exp-acme',
    company: 'ACME Corp',
    role: 'Senior Backend Engineer',
    location: 'Madrid',
    dates: { start: '2021-03', end: '2024-06' },
    summary: 'Plataforma de pagos.\n\nSegundo párrafo con **negrita**.',
    technologies: ['PHP 8', 'Symfony'],
    achievements: [
      { id: 'exp-acme-1', text: 'Reduje la latencia p95 un **40 %**', impact: '-40 % p95', date: '2023-05', tags: ['performance', 'php'] },
      { id: 'pagos', text: 'Lideré la migración', tags: [] },
    ],
    tags: ['php', 'symfony'],
  };

  it('experience: completa y mínima', () => {
    const full = serializeExperience(experience);
    expect(full).toEqual({
      fileName: 'acme',
      explicitId: false,
      content: [
        '---',
        'company: ACME Corp',
        'role: Senior Backend Engineer',
        'location: Madrid',
        'start: 2021-03',
        'end: 2024-06',
        'tags: [php, symfony]',
        'technologies: [PHP 8, Symfony]',
        '---',
        '',
        'Plataforma de pagos.',
        '',
        'Segundo párrafo con **negrita**.',
        '',
        '## Logros',
        '',
        '- Reduje la latencia p95 un **40 %** #performance #php',
        '  - impact: -40 % p95',
        '  - date: 2023-05',
        '- Lideré la migración',
        '  - id: pagos',
        '',
      ].join('\n'),
    });
    expect(contribution('experience', full.fileName, full.content)).toEqual(experience);
    const minimal: Experience = { id: 'freelance', company: 'Yo', role: 'Dev', dates: { start: '2020' }, technologies: [], achievements: [], tags: [] };
    const bare = serializeExperience(minimal);
    expect(bare).toEqual({ fileName: 'freelance', explicitId: true, content: '---\nid: freelance\ncompany: Yo\nrole: Dev\nstart: "2020"\n---\n' });
    expect(contribution('experience', bare.fileName, bare.content)).toEqual(minimal);
    const renamed = serializeExperience(experience, { fileName: 'exp-acme', explicitId: true });
    expect(renamed.fileName).toBe('exp-acme');
    expect(renamed.content.startsWith('---\nid: exp-acme\ncompany: ACME Corp\n')).toBe(true);
    expect(contribution('experience', renamed.fileName, renamed.content)).toEqual(experience);
  });

  it('projects y education', () => {
    const project: Project = {
      id: 'proj-cv',
      name: 'Chameleon CV',
      role: 'Autor',
      url: 'https://github.com/x/cv',
      dates: { start: '2024-01' },
      summary: 'CLI de CV.',
      technologies: ['TypeScript'],
      achievements: [{ id: 'proj-cv-1', text: 'Publiqué la 1.0', tags: ['oss'] }],
      tags: ['cli'],
    };
    const serializedProject = serializeProject(project);
    expect(serializedProject.fileName).toBe('cv');
    expect(serializedProject.content).toContain('url: https://github.com/x/cv\nstart: 2024-01\ntags: [cli]\ntechnologies: [TypeScript]\n---\n\nCLI de CV.\n\n## Logros\n\n- Publiqué la 1.0 #oss\n');
    expect(contribution('projects', serializedProject.fileName, serializedProject.content)).toEqual(project);
    const noDates: Project = { id: 'proj-x', name: 'X', technologies: [], achievements: [], tags: [] };
    expect(serializeProject(noDates).content).toBe('---\nname: X\n---\n');
    expect(contribution('projects', 'x', serializeProject(noDates).content)).toEqual(noDates);
    const sideProject: Project = { ...noDates, id: 'side-project' };
    expect(serializeProject(sideProject)).toEqual({ fileName: 'side-project', explicitId: true, content: '---\nid: side-project\nname: X\n---\n' });
    expect(contribution('projects', 'side-project', serializeProject(sideProject).content)).toEqual(sideProject);

    const education: Education = { id: 'edu-uni', institution: 'Universidad', degree: 'Grado', field: 'Informática', dates: { start: '2010', end: '2014' }, summary: 'Mención.', tags: ['cs'] };
    const serializedEducation = serializeEducation(education);
    expect(serializedEducation).toEqual({
      fileName: 'uni',
      explicitId: false,
      content: '---\ninstitution: Universidad\ndegree: Grado\nfield: Informática\nstart: "2010"\nend: "2014"\ntags: [cs]\n---\n\nMención.\n',
    });
    expect(contribution('education', serializedEducation.fileName, serializedEducation.content)).toEqual(education);
    const bareEducation: Education = { id: 'edu-x', institution: 'U', degree: 'D', tags: [] };
    expect(contribution('education', 'x', serializeEducation(bareEducation).content)).toEqual(bareEducation);
    const bootcamp: Education = { ...bareEducation, id: 'bootcamp' };
    expect(serializeEducation(bootcamp).content).toBe('---\nid: bootcamp\ninstitution: U\ndegree: D\n---\n');
    expect(contribution('education', 'bootcamp', serializeEducation(bootcamp).content)).toEqual(bootcamp);
  });

  it('specialties: sin id en el frontmatter', () => {
    const specialty: Specialty = { id: 'backend', title: 'Backend', summary: 'APIs y datos.', tags: ['php', 'sql'] };
    const serialized = serializeSpecialty(specialty);
    expect(serialized).toEqual({ fileName: 'backend', explicitId: false, content: '---\ntitle: Backend\ntags: [php, sql]\n---\n\nAPIs y datos.\n' });
    expect(contribution('specialties', serialized.fileName, serialized.content)).toEqual(specialty);
    expect(serializeSpecialty({ id: 'x', title: 'X', tags: [] }).content).toBe('---\ntitle: X\n---\n');
  });

  it('profile.md: claves planas, location, links, languages y el resumen en el cuerpo', () => {
    const profile: MasterProfile = {
      meta: { schemaVersion: 1, locale: 'es-ES', updatedAt: '2026-08-30' },
      personal: {
        fullName: 'Ada Ejemplo',
        headline: 'Ingeniera',
        summary: 'Resumen: breve.',
        email: 'ada@example.com',
        phone: '+34 600 000 000',
        location: { city: 'Madrid', country: 'España' },
        links: [{ label: 'GitHub', url: 'https://github.com/ada' }],
      },
      specialties: [],
      experience: [],
      projects: [],
      education: [],
      skills: [],
      achievements: [],
      certifications: [],
      languages: [
        { name: 'Español', level: 'native' },
        { name: 'Inglés', level: 'C1' },
      ],
    };
    const content = serializeProfileFile(profile);
    expect(content).toBe(
      [
        '---',
        'schemaVersion: 1',
        'locale: es-ES',
        'updatedAt: 2026-08-30',
        'fullName: Ada Ejemplo',
        'headline: Ingeniera',
        'email: ada@example.com',
        'phone: +34 600 000 000',
        'location:',
        '  city: Madrid',
        '  country: España',
        'links:',
        '  - label: GitHub',
        '    url: https://github.com/ada',
        'languages:',
        '  - name: Español',
        '    level: native',
        '  - name: Inglés',
        '    level: C1',
        '---',
        '',
        'Resumen: breve.',
        '',
      ].join('\n'),
    );
    const parsed = parseProfileFile(content, 'profile.md');
    expect(parsed.ok && parsed.contribution).toEqual({ meta: profile.meta, personal: profile.personal, languages: profile.languages });
    const minimal = serializeProfileFile({ ...profile, meta: { schemaVersion: 1 }, personal: { fullName: 'Ada', links: [] }, languages: [] });
    expect(minimal).toBe('---\nschemaVersion: 1\nfullName: Ada\n---\n');
    const parsedMinimal = parseProfileFile(minimal, 'profile.md');
    expect(parsedMinimal.ok && parsedMinimal.contribution).toEqual({ meta: { schemaVersion: 1 }, personal: { fullName: 'Ada', links: [] }, languages: [] });
  });
});
