/** Aplicar una propuesta del co-piloto al borrador (T-9.5): mover una línea, escribir solo lo que cambia y registrarlo. */
import { describe, expect, it } from 'vitest';

import { applyImportProposal } from '../../src/app/import-apply';
import { appContext } from '../helpers/app-context';
import { MemoryFileSystem } from '../helpers/memory-file-system';

const PROFILE = [
  '---',
  'schemaVersion: 1',
  'locale: es-ES',
  'fullName: Ada Ejemplo',
  'links: []',
  '---',
  '',
].join('\n');

const REPORT = [
  '# Informe del borrador importado',
  '',
  '- Origen: cv.pdf',
  '',
  '## Propuestas del co-piloto (no aplicadas)',
  '',
  'El co-piloto solo PROPONE dónde iría cada línea sin situar; nada se ha escrito en el borrador. Muévelas tú si estás de acuerdo.',
  '',
  '- línea 31 → **habilidad**: Kubernetes _(herramienta suelta)_',
  '- línea 32 → **experiencia**: Finance Chair, Green Club',
  '',
  '## Sin situar (revísalo a mano)',
  '',
  '- línea 31: Kubernetes',
  '- línea 32: Finance Chair, Green Club',
  '- línea 33: Inglés — C1',
  '- línea 34: ada@example.com',
  '',
].join('\n');

function draft(report = REPORT, extra: Record<string, string> = {}): MemoryFileSystem {
  return new MemoryFileSystem({ '/work/import/mio/profile.md': PROFILE, '/work/import/mio/README.md': report, ...extra });
}

async function apply(fs: MemoryFileSystem, request: Parameters<typeof applyImportProposal>[1]) {
  return applyImportProposal(appContext(fs), request);
}

describe('applyImportProposal: lo que rechaza antes de tocar nada', () => {
  it('rechaza un nombre que no deja carpeta, una sección fuera del vocabulario y un borrador inexistente', async () => {
    const fs = draft();
    expect(await apply(fs, { name: '///', line: 31, section: 'habilidad' })).toMatchObject({ ok: false, error: { code: 'invalid-data' } });
    expect(await apply(fs, { name: 'mio', line: 31, section: 'inventada' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-data', message: expect.stringContaining('no es una sección del vocabulario') as string },
    });
    expect(await apply(fs, { name: 'otro', line: 31, section: 'habilidad' })).toMatchObject({ ok: false, error: { code: 'not-found' } });
  });

  it('rechaza una línea que no está sin situar (ya movida, o inventada)', async () => {
    const result = await apply(draft(), { name: 'mio', line: 99, section: 'habilidad' });
    expect(result).toMatchObject({ ok: false, error: { code: 'not-found', message: expect.stringContaining('línea 99') as string } });
  });

  it('no aplica nada sobre un borrador que no valida: primero se arregla el borrador', async () => {
    const fs = draft(REPORT, { '/work/import/mio/profile.md': '---\nschemaVersion: 1\nfullName: ""\n---\n' });
    expect(await apply(fs, { name: 'mio', line: 31, section: 'habilidad' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-data', message: expect.stringContaining('no valida') as string },
    });
    expect(await fs.readTextFile('/work/import/mio/README.md')).toBe(REPORT);
  });
});

describe('applyImportProposal: secciones que se resuelven con la línea sola', () => {
  it('descartar no escribe ninguna fuente, pero registra la decisión en el informe', async () => {
    const fs = draft();
    const result = await apply(fs, { name: 'mio', line: 31, section: 'descartar' });
    expect(result).toMatchObject({ ok: true, outcome: { written: [], section: 'descartar', text: 'Kubernetes' } });
    const report = await fs.readTextFile('/work/import/mio/README.md');
    expect(report).toContain('## Aplicado');
    expect(report).toContain('- línea 31 → **descartar**: Kubernetes → descartada (no se escribió en ningún fichero)');
    expect(report).not.toContain('- línea 31: Kubernetes');
    expect(report).not.toContain('- línea 31 → **habilidad**');
    expect(await fs.readTextFile('/work/import/mio/profile.md')).toBe(PROFILE);
  });

  it('una habilidad va a skills.csv y un logro a achievements.md', async () => {
    const fs = draft();
    const skill = await apply(fs, { name: 'mio', line: 31, section: 'habilidad' });
    expect(skill.ok && skill.outcome.written).toContain('skills.csv');
    expect(await fs.readTextFile('/work/import/mio/skills.csv')).toContain('Kubernetes');
    const logro = await apply(fs, { name: 'mio', line: 32, section: 'logro' });
    expect(logro.ok && logro.outcome.written).toContain('achievements.md');
    expect(await fs.readTextFile('/work/import/mio/achievements.md')).toContain('Finance Chair');
  });

  it('un resumen se añade al que ya hubiera en lugar de sustituirlo', async () => {
    const fs = draft();
    const resumen = await apply(fs, { name: 'mio', line: 31, section: 'resumen' });
    expect(resumen.ok && resumen.outcome.written).toContain('profile.md');
    expect(await apply(fs, { name: 'mio', line: 32, section: 'resumen' })).toMatchObject({ ok: true });
    const profile = await fs.readTextFile('/work/import/mio/profile.md');
    expect(profile).toContain('Kubernetes');
    expect(profile).toContain('Finance Chair');
  });

  it('un proyecto y una certificación toman la línea como nombre', async () => {
    const fs = draft();
    const proyecto = await apply(fs, { name: 'mio', line: 31, section: 'proyecto' });
    expect(proyecto.ok && proyecto.outcome.written.some((path) => path.startsWith('projects/'))).toBe(true);
    const cert = await apply(fs, { name: 'mio', line: 32, section: 'certificacion' });
    expect(cert.ok && cert.outcome.written).toContain('certifications.csv');
    expect(await fs.readTextFile('/work/import/mio/certifications.csv')).toContain('Finance Chair');
  });

  it('los identificadores no chocan con los que ya tiene el borrador', async () => {
    const fs = draft(REPORT.replace('- línea 32: Finance Chair, Green Club', '- línea 32: Kubernetes'));
    expect(await apply(fs, { name: 'mio', line: 31, section: 'habilidad' })).toMatchObject({ ok: true });
    expect(await apply(fs, { name: 'mio', line: 32, section: 'habilidad' })).toMatchObject({ ok: true });
    expect(await fs.readTextFile('/work/import/mio/skills.csv')).toContain('skill-kubernetes-2');
  });

  it('lo que no cabe en la sección se explica y no se escribe', async () => {
    const largo = 'x'.repeat(200);
    const fs = draft(`# Informe\n\n## Sin situar (revísalo a mano)\n\n- línea 7: ${largo}\n`);
    expect(await apply(fs, { name: 'mio', line: 7, section: 'habilidad' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-data', message: expect.stringContaining('no cabe en «habilidad»') as string },
    });
  });
});

describe('applyImportProposal: secciones que piden campos', () => {
  it('un idioma toma el nivel de la propia línea cuando lo declara', async () => {
    const fs = draft();
    const idioma = await apply(fs, { name: 'mio', line: 33, section: 'idioma' });
    expect(idioma.ok && idioma.outcome.written).toContain('profile.md');
    expect(await fs.readTextFile('/work/import/mio/profile.md')).toContain('Inglés');
  });

  it('un idioma sin nivel reconocible lo pide, y el nivel indicado manda sobre la línea', async () => {
    const fs = draft(`# Informe\n\n## Sin situar (revísalo a mano)\n\n- línea 7: Alemán\n- línea 8: — C1\n`);
    expect(await apply(fs, { name: 'mio', line: 7, section: 'idioma' })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('nivel MCER') as string },
    });
    expect(await apply(fs, { name: 'mio', line: 8, section: 'idioma' })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('nombre de idioma') as string },
    });
    // Un nivel en blanco es como no indicarlo: el formulario envía la cadena vacía cuando no se toca.
    expect(await apply(fs, { name: 'mio', line: 7, section: 'idioma', fields: { level: '  ' } })).toMatchObject({ ok: false });
    expect(await apply(fs, { name: 'mio', line: 7, section: 'idioma', fields: { level: 'B2' } })).toMatchObject({ ok: true });
    expect(await fs.readTextFile('/work/import/mio/profile.md')).toContain('B2');
  });

  it('un dato de contacto exige saber qué campo es, y cada campo escribe el suyo', async () => {
    const fs = draft();
    expect(await apply(fs, { name: 'mio', line: 34, section: 'contacto' })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('qué campo es') as string },
    });
    expect(await apply(fs, { name: 'mio', line: 34, section: 'contacto', fields: { contact: 'inventado' } })).toMatchObject({ ok: false });
    expect(await apply(fs, { name: 'mio', line: 34, section: 'contacto', fields: { contact: 'email' } })).toMatchObject({ ok: true });
    expect(await fs.readTextFile('/work/import/mio/profile.md')).toContain('ada@example.com');
  });

  it('teléfono, ubicación y enlace, con la etiqueta deducida del host o la que se indique', async () => {
    const fs = draft(
      ['# Informe', '', '## Sin situar (revísalo a mano)', '', '- línea 1: +34 600 000 000', '- línea 2: Madrid', '- línea 3: https://github.com/ada', '- línea 4: https://ada.dev', ''].join('\n'),
    );
    expect(await apply(fs, { name: 'mio', line: 1, section: 'contacto', fields: { contact: 'phone' } })).toMatchObject({ ok: true });
    expect(await apply(fs, { name: 'mio', line: 2, section: 'contacto', fields: { contact: 'location' } })).toMatchObject({ ok: true });
    expect(await apply(fs, { name: 'mio', line: 3, section: 'contacto', fields: { contact: 'link', label: '  ' } })).toMatchObject({ ok: true });
    expect(await apply(fs, { name: 'mio', line: 4, section: 'contacto', fields: { contact: 'link', label: 'Web' } })).toMatchObject({ ok: true });
    const profile = await fs.readTextFile('/work/import/mio/profile.md');
    expect(profile).toContain('+34 600 000 000');
    expect(profile).toContain('Madrid');
    expect(profile).toContain('Github');
    expect(profile).toContain('Web');
  });

  it('un enlace que no es una URL se queda sin host y el esquema lo rechaza', async () => {
    const fs = draft('# Informe\n\n## Sin situar (revísalo a mano)\n\n- línea 1: no-es-una-url\n');
    expect(await apply(fs, { name: 'mio', line: 1, section: 'contacto', fields: { contact: 'link' } })).toMatchObject({
      ok: false,
      error: { code: 'invalid-data' },
    });
  });

  it('una experiencia exige empresa, puesto y fecha de inicio; con ellas escribe su fichero', async () => {
    const fs = draft();
    expect(await apply(fs, { name: 'mio', line: 32, section: 'experiencia' })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('empresa, puesto y fecha de inicio') as string },
    });
    expect(await apply(fs, { name: 'mio', line: 32, section: 'experiencia', fields: { company: 'Green Club', role: ' ', start: '2018' } })).toMatchObject({ ok: false });
    // Fin en blanco = «en curso»: el formulario manda la cadena vacía cuando no se rellena.
    expect(await apply(fs, { name: 'mio', line: 31, section: 'experiencia', fields: { company: 'Acme', role: 'Dev', start: '2020', end: '' } })).toMatchObject({ ok: true });
    const done = await apply(fs, { name: 'mio', line: 32, section: 'experiencia', fields: { company: 'Green Club', role: 'Finance Chair', start: '2018-09', end: '2019-06' } });
    const file = done.ok ? done.outcome.written.find((path) => path.startsWith('experience/')) : undefined;
    expect(file).toBeDefined();
    const entry = await fs.readTextFile(`/work/import/mio/${file!}`);
    expect(entry).toContain('Green Club');
    expect(entry).toContain('2019-06');
  });

  it('una formación exige institución y titulación; las fechas son opcionales', async () => {
    const fs = draft();
    expect(await apply(fs, { name: 'mio', line: 32, section: 'formacion', fields: { institution: 'UCM' } })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('institución y titulación') as string },
    });
    expect(await apply(fs, { name: 'mio', line: 31, section: 'formacion', fields: { institution: 'UCM', degree: 'Grado', start: '  ' } })).toMatchObject({ ok: true });
    expect(await apply(fs, { name: 'mio', line: 33, section: 'formacion', fields: { institution: 'UNED', degree: 'Curso', start: '2019', end: '' } })).toMatchObject({ ok: true });
    const conFechas = await apply(fs, { name: 'mio', line: 32, section: 'formacion', fields: { institution: 'UPM', degree: 'Máster', start: '2020', end: '2021' } });
    const file = conFechas.ok ? conFechas.outcome.written.find((path) => path.startsWith('education/') && path.includes('upm')) : undefined;
    expect(file).toBeDefined();
    expect(await fs.readTextFile(`/work/import/mio/${file!}`)).toContain('2021');
  });
});

describe('applyImportProposal: fallos de escritura', () => {
  it('un fallo escribiendo una fuente deja el informe intacto', async () => {
    const fs = draft();
    fs.failures.add('writeFile');
    expect(await apply(fs, { name: 'mio', line: 31, section: 'habilidad' })).toMatchObject({ ok: false, error: { code: 'environment' } });
    expect(await fs.readTextFile('/work/import/mio/README.md')).toBe(REPORT);
  });

  it('un fallo escribiendo el informe se explica con su ruta', async () => {
    const fs = draft();
    fs.failures.add('writeFile');
    expect(await apply(fs, { name: 'mio', line: 31, section: 'descartar' })).toMatchObject({
      ok: false,
      error: { code: 'environment', message: expect.stringContaining('README.md') as string },
    });
  });
});
