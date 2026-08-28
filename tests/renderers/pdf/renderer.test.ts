import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { parseMasterProfile, type MasterProfileInput } from '../../../src/core/schema';
import { selectForSpecialty } from '../../../src/core/selection';
import { extractPdfText } from '../../../src/pdf';
import { DEFAULT_FONTS, FIXED_CREATION_DATE, FONTS_DIRECTORY, creationDate, renderPdfCv } from '../../../src/renderers/pdf';
import { fullProfileInput, minimalProfileInput } from '../../fixtures/master-profile';
import { selectionProfile } from '../../fixtures/selection';

const GOLDEN = readFileSync(join(__dirname, '../../fixtures/golden/cv-backend.pdf.txt'), 'utf8');

async function textOf(pdf: Buffer): Promise<{ text: string; pages: number }> {
  const extracted = await extractPdfText(pdf);
  if (!extracted.ok) {
    throw new Error(extracted.message);
  }
  return { text: extracted.text, pages: extracted.pages };
}

function backendPdf(): Promise<Buffer> {
  const selection = selectForSpecialty(selectionProfile(), 'backend');
  if (!selection.ok) {
    throw new Error('selección inválida');
  }
  return renderPdfCv(selection.selection.profile);
}

describe('renderPdfCv', () => {
  it('round-trip: el texto extraído del PDF (T-2.5) reproduce el golden del CV backend en una página', async () => {
    expect(await textOf(await backendPdf())).toEqual({ text: GOLDEN, pages: 1 });
  });

  it('es reproducible byte a byte, embebe la fuente y no contiene código ni acciones automáticas', async () => {
    const first = await backendPdf();
    const second = await backendPdf();
    expect(first.equals(second)).toBe(true);
    const bytes = first.toString('latin1');
    expect(bytes.startsWith('%PDF-1.')).toBe(true);
    expect(bytes).toContain('/FontFile2');
    for (const expected of ['/Creator', '/Producer', '(Chameleon CV)', '/Author', '(Ada Ejemplo)', '(D:20000101000000Z)']) {
      expect(bytes).toContain(expected);
    }
    for (const forbidden of ['/JavaScript', '/JS', '/Launch', '/OpenAction', '/AA', '/EmbeddedFile']) {
      expect(bytes).not.toContain(forbidden);
    }
  });

  it('las fuentes OFL y su licencia viajan con el repositorio', () => {
    for (const path of Object.values(DEFAULT_FONTS)) {
      expect(existsSync(path)).toBe(true);
    }
    expect(existsSync(join(FONTS_DIRECTORY, 'LICENSE-SourceSans3.md'))).toBe(true);
  });

  it('la fecha de creación es la del perfil, una constante si no la declara, o la que se indique', async () => {
    const full = parseMasterProfile(fullProfileInput());
    const minimal = parseMasterProfile(minimalProfileInput());
    expect(creationDate(full)).toEqual(new Date('2026-08-28T00:00:00Z'));
    expect(creationDate(minimal)).toBe(FIXED_CREATION_DATE);
    expect((await renderPdfCv(full)).toString('latin1')).toContain('D:20260828');
    expect((await renderPdfCv(minimal)).toString('latin1')).toContain('D:20000101');
    expect((await renderPdfCv(minimal, { createdAt: new Date('2024-05-06T00:00:00Z') })).toString('latin1')).toContain('D:20240506');
  });

  it('respeta el locale del perfil o el forzado, y un perfil mínimo es solo el nombre', async () => {
    const full = parseMasterProfile(fullProfileInput());
    expect((await textOf(await renderPdfCv(full))).text).toContain('\nExperiencia\n');
    expect((await textOf(await renderPdfCv(full, { locale: 'en' }))).text).toContain('\nExperience\n');
    const minimal = await textOf(await renderPdfCv(parseMasterProfile(minimalProfileInput())));
    expect(minimal).toEqual({ text: 'Ada Ejemplo', pages: 1 });
  });

  it('cubre todas las secciones y los campos opcionales ausentes, con Markdown en línea en los logros', async () => {
    const input: MasterProfileInput = {
      personal: { fullName: 'Ada Ejemplo', summary: 'Resumen con lista:\n\n- uno\n- dos' },
      experience: [
        {
          id: 'exp-1',
          company: 'ACME',
          role: 'Dev',
          dates: { start: '2020' },
          achievements: [
            { id: 'ach-1', text: 'Uso `k6` con **carga** *real* en [ACME](https://acme.example)' },
            { id: 'ach-2', text: '-' },
          ],
        },
      ],
      projects: [
        { id: 'proj-1', name: 'Sin rol ni fechas', achievements: [{ id: 'ach-3', text: 'Logro del proyecto', impact: 'x2' }], technologies: ['Rust'] },
        { id: 'proj-2', name: 'Con rol', role: 'Autora', dates: { start: '2021', end: '2022' } },
      ],
      education: [{ id: 'edu-1', institution: 'Uni', degree: 'Grado' }],
      certifications: [
        { id: 'cert-1', name: 'Solo nombre' },
        { id: 'cert-2', name: 'Con fecha', date: '2020-01' },
        { id: 'cert-3', name: 'Con emisor y enlace', issuer: 'Org', url: 'https://cert.example' },
      ],
      achievements: [{ id: 'ach-4', text: 'Transversal' }],
    };
    const { text, pages } = await textOf(await renderPdfCv(parseMasterProfile(input)));
    expect(pages).toBe(1);
    expect(text).toContain('Resumen con lista:\n• uno\n• dos\n');
    expect(text).toContain('Dev · ACME\n2020 – actualidad\n• Uso k6 con carga real en ACME\n•\n');
    expect(text).toContain('Proyectos\nCon rol · Autora\n2021 – 2022\nSin rol ni fechas\n• Logro del proyecto (x2)\nTecnologías: Rust\n');
    expect(text).toContain('Logros destacados\n• Transversal\n');
    expect(text).toContain('Formación\n• Grado · Uni\n');
    expect(text).toContain('Certificaciones\n• Con fecha · ene 2020\n• Solo nombre\n• Con emisor y enlace · Org · enlace');
  });

  it('pagina automáticamente los CV largos', async () => {
    const achievements = Array.from({ length: 70 }, (_, index) => ({ id: `ach-${index}`, text: `Logro número ${index} con texto suficiente para ocupar una línea entera del documento.` }));
    const input: MasterProfileInput = {
      personal: { fullName: 'Ada Ejemplo' },
      experience: [{ id: 'exp-1', company: 'ACME', role: 'Dev', dates: { start: '2020' }, achievements }],
      skills: [{ id: 'skill-1', name: 'PHP' }],
      languages: [{ name: 'Español', level: 'native' }],
    };
    const { text, pages } = await textOf(await renderPdfCv(parseMasterProfile(input)));
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(text).toContain('Logro número 69');
    expect(text).toContain('Idiomas\n• Español: nativo');
  });
});
