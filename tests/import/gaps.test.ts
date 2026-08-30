/**
 * Brazos restantes del módulo de importación (T-8.4b): workers que fallan (lanzan, salen, no responden),
 * el worker por código embebido y por ruta, fechas que el patrón acepta pero el calendario no, DOCX con
 * deflate corrupto o párrafos vacíos, y las degradaciones de draft que aún no tenían prueba.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { DiskAssets, MemoryAssets } from '../../src/shared/assets';
import { DEFAULT_PDF_LIMITS, type PdfLimits } from '../../src/pdf';
import { ITEMS_WORKER_ASSET_KEY, createItemsRunner, extractItems, itemsWorkerScriptPath, itemsWorkerSource, type ItemsRunner } from '../../src/import/items';
import { findDateRange, findSingleDate, parsePoint } from '../../src/import/dates';
import { documentXmlToText, extractDocxText } from '../../src/import/docx';
import { draftFiles, draftReport, firstIssue, linkLabel } from '../../src/import/draft';
import { zipOf } from '../helpers/zip';

const limits = (overrides: Partial<PdfLimits>): PdfLimits => ({ ...DEFAULT_PDF_LIMITS, ...overrides });

describe('extractItems: workers que fallan y worker por código', () => {
  let temporary = '';

  beforeAll(async () => {
    temporary = await mkdtemp(join(tmpdir(), 'chameleon-items-'));
    await writeFile(join(temporary, 'throwing.js'), "throw new Error('boom en items');", 'utf8');
    await writeFile(join(temporary, 'exiting.js'), 'process.exit(3);', 'utf8');
  });

  afterAll(async () => {
    await rm(temporary, { recursive: true, force: true });
  });

  it('el script del worker existe (fuente en desarrollo, compilado si está)', async () => {
    expect(itemsWorkerScriptPath()).toMatch(/items-worker\.m(ts|js)$/);
    const directory = await mkdtemp(join(tmpdir(), 'chameleon-items-path-'));
    try {
      expect(itemsWorkerScriptPath(directory)).toBe(join(directory, 'items-worker.mts'));
      await writeFile(join(directory, 'items-worker.mjs'), '', 'utf8');
      expect(itemsWorkerScriptPath(directory)).toBe(join(directory, 'items-worker.mjs'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('itemsWorkerSource elige ruta (disco) o código embebido (assets)', async () => {
    const code = "const { parentPort } = require('node:worker_threads'); parentPort.postMessage({ ok: true, items: [], pages: 0 });";
    expect(await itemsWorkerSource(new DiskAssets())).toEqual({ kind: 'path', path: itemsWorkerScriptPath() });
    expect(await itemsWorkerSource(new MemoryAssets({ [ITEMS_WORKER_ASSET_KEY]: code }))).toEqual({ kind: 'code', code });
  });

  it('el worker por código (eval) responde; uno que lanza o sale con código se traduce a failed', async () => {
    const code = "const { parentPort, workerData } = require('node:worker_threads'); parentPort.postMessage({ ok: true, items: [{ page: 1, text: `b${workerData.bytes.byteLength}`, x: 0, y: 0, width: 1, fontSize: 10 }], pages: 1 });";
    const viaCode = await extractItems(new Uint8Array([1, 2]), DEFAULT_PDF_LIMITS, createItemsRunner({ kind: 'code', code }));
    expect(viaCode).toEqual({ ok: true, items: [{ page: 1, text: 'b2', x: 0, y: 0, width: 1, fontSize: 10 }], pages: 1 });
    expect(await extractItems(new Uint8Array(1), DEFAULT_PDF_LIMITS, createItemsRunner(join(temporary, 'throwing.js')))).toEqual({ ok: false, code: 'failed', message: 'boom en items' });
    expect(await extractItems(new Uint8Array(1), DEFAULT_PDF_LIMITS, createItemsRunner(join(temporary, 'exiting.js')))).toEqual({ ok: false, code: 'failed', message: 'el worker de items terminó con código 3' });
  });

  it('agota el tiempo terminando el worker, corta el texto excesivo y no arranca con bytes de más', async () => {
    let terminated = false;
    const silent: ItemsRunner = () => ({
      reply: new Promise(() => undefined),
      terminate: () => {
        terminated = true;
        return Promise.resolve();
      },
    });
    expect(await extractItems(new Uint8Array(1), limits({ timeoutMs: 10 }), silent)).toEqual({ ok: false, code: 'timeout', message: 'La extracción superó los 10 ms permitidos' });
    expect(terminated).toBe(true);
    const huge: ItemsRunner = () => ({ reply: Promise.resolve({ ok: true, items: [{ page: 1, text: 'x'.repeat(50), x: 0, y: 0, width: 1, fontSize: 10 }], pages: 1 }), terminate: () => Promise.resolve() });
    expect(await extractItems(new Uint8Array(1), limits({ maxTextBytes: 10 }), huge)).toMatchObject({ ok: false, code: 'too-large' });
    let started = false;
    const never: ItemsRunner = () => {
      started = true;
      return { reply: Promise.resolve({ ok: true, items: [], pages: 0 }), terminate: () => Promise.resolve() };
    };
    expect(await extractItems(new Uint8Array(11), limits({ maxBytes: 10 }), never)).toMatchObject({ ok: false, code: 'too-large' });
    expect(started).toBe(false);
    const errorish: ItemsRunner = () => ({ reply: Promise.resolve({ ok: false, code: 'invalid', message: 'no es un PDF' }), terminate: () => Promise.resolve() });
    expect(await extractItems(new Uint8Array(1), DEFAULT_PDF_LIMITS, errorish)).toEqual({ ok: false, code: 'invalid', message: 'no es un PDF' });
  });
});

describe('fechas que el patrón acepta y el calendario no', () => {
  it('mes 13, nombres que no son meses y la variante «April 20, 2021»', () => {
    expect(parsePoint('April 20, 2021')).toBe('2021-04-20');
    expect(parsePoint('xxxxx 20, 2021')).toBeUndefined();
    expect(parsePoint('20 xxxxx 2021')).toBeUndefined();
    expect(parsePoint('xxxxx 2021')).toBeUndefined();
    expect(findDateRange('13/2020 - 05/2021')).toBeUndefined();
    expect(findDateRange('03/2020 - 13/2021')).toBeUndefined();
    expect(findSingleDate('13/2020')).toBeUndefined();
  });
});

describe('DOCX: párrafos vacíos, atributos y deflate corrupto', () => {
  it('un párrafo con atributos y sin texto se salta; el numerado conserva la viñeta', () => {
    const xml = '<w:document><w:body><w:p w:rsidR="0"><w:r><w:t> </w:t></w:r></w:p><w:p><w:pPr><w:numPr/></w:pPr><w:r><w:t>Uno</w:t></w:r></w:p></w:body></w:document>';
    expect(documentXmlToText(xml)).toBe('- Uno');
  });

  it('un document.xml con el deflate corrupto se degrada a mensaje', () => {
    const good = zipOf([['word/document.xml', '<w:document><w:body><w:p><w:r><w:t>Hola mundo</w:t></w:r></w:p></w:body></w:document>']]);
    const corrupt = Uint8Array.from(good);
    const payload = 30 + 'word/document.xml'.length;
    for (let index = payload; index < payload + 8; index += 1) {
      corrupt[index] = 0xff;
    }
    expect(extractDocxText(corrupt)).toMatchObject({ ok: false, message: expect.stringContaining('word/document.xml') as string });
  });
});

describe('draft: degradaciones aún sin prueba', () => {
  const BASE = {
    fullName: 'Ada',
    headline: undefined,
    email: undefined,
    phone: undefined,
    location: undefined,
    links: [],
    summary: undefined,
    experience: [],
    projects: [],
    education: [],
    certifications: [],
    skills: [],
    achievements: [],
    languages: [],
    sections: [],
    unparsed: [],
  } as const;
  const PROV = { line: 1, text: 'x' };

  it('un nombre imposible reduce los datos personales al marcador y lo avisa', () => {
    const result = draftFiles({ ...BASE, fullName: 'x'.repeat(200) }, 'cv.pdf', '2026-08-30T21:00:00.000Z');
    expect(result.profile.personal.fullName).toBe('Nombre pendiente');
    expect(result.issues.some((issue) => issue.reason.startsWith('datos personales reducidos al nombre'))).toBe(true);
  });

  it('formación sin centro lleva «Centro pendiente»; un logro o un idioma imposibles se descartan con motivo', () => {
    const result = draftFiles(
      {
        ...BASE,
        education: [{ title: 'Grado', subtitle: undefined, location: undefined, start: '2010', end: '2014', current: false, date: undefined, url: undefined, field: undefined, summary: undefined, technologies: [], achievements: [], provenance: PROV }],
        achievements: [{ text: 'x'.repeat(700), impact: undefined, provenance: PROV }],
        languages: [{ name: 'x'.repeat(80), level: 'C1' }],
      },
      'cv.pdf',
      '2026-08-30T21:00:00.000Z',
    );
    expect(result.profile.education[0]?.institution).toBe('Centro pendiente');
    expect(result.issues.some((issue) => issue.reason.startsWith('logro descartado'))).toBe(true);
    expect(result.issues.some((issue) => issue.reason.startsWith('idioma descartado'))).toBe(true);
  });

  it('firstIssue y linkLabel: ruta vacía como «entrada», host sin punto y host inútil', () => {
    expect(firstIssue({ issues: [{ path: [], message: 'raro' }] })).toBe('entrada: raro');
    expect(firstIssue({ issues: [{ path: ['url'], message: 'inválida' }] })).toBe('url: inválida');
    expect(linkLabel('github.com')).toBe('Github');
    expect(linkLabel('localhost')).toBe('Localhost');
    expect(linkLabel('')).toBe('Enlace');
  });

  it('dos campos personales rotos se retiran los dos; el resumen del encabezado sobrevive', () => {
    const result = draftFiles({ ...BASE, summary: 'Perfil breve.', phone: 'x'.repeat(60), email: 'no-es-email' }, 'cv.pdf', '2026-08-30T21:00:00.000Z');
    expect(result.profile.personal.summary).toBe('Perfil breve.');
    expect(result.profile.personal.phone).toBeUndefined();
    expect(result.profile.personal.email).toBeUndefined();
    expect(result.issues.filter((issue) => issue.reason.includes('descartado del borrador'))).toHaveLength(2);
  });

  it('proyecto mínimo (solo título), formación con resumen y sin fechas, certificación pelada y con enlace', () => {
    const minimal = { title: 'Guardian', subtitle: undefined, location: undefined, start: undefined, end: undefined, current: false, date: undefined, url: undefined, field: undefined, summary: undefined, technologies: [], achievements: [], provenance: PROV };
    const result = draftFiles(
      {
        ...BASE,
        projects: [minimal],
        education: [{ ...minimal, title: 'Grado', subtitle: 'UV', summary: 'Mención en datos.' }],
        certifications: [{ ...minimal, title: 'CKA' }, { ...minimal, title: 'CKS', subtitle: 'CNCF', date: '2022', url: 'https://cncf.io/cks' }],
      },
      'cv.pdf',
      '2026-08-30T21:00:00.000Z',
    );
    expect(result.profile.projects[0]).toMatchObject({ name: 'Guardian' });
    expect(result.profile.projects[0]?.dates).toBeUndefined();
    expect(result.profile.education[0]).toMatchObject({ summary: 'Mención en datos.' });
    expect(result.profile.education[0]?.dates).toBeUndefined();
    expect(result.profile.certifications[0]).toMatchObject({ name: 'CKA' });
    expect(result.profile.certifications[1]).toMatchObject({ issuer: 'CNCF', date: '2022', url: 'https://cncf.io/cks' });
  });

  it('una entrada con dos campos opcionales rotos se descarta; una habilidad imposible y un logro vacío también', () => {
    const minimal = { title: 'Web', subtitle: undefined, location: undefined, start: undefined, end: undefined, current: false, date: undefined, url: 'nourl', field: undefined, summary: 'mal\u0007texto', technologies: [], achievements: [], provenance: PROV };
    const result = draftFiles(
      {
        ...BASE,
        projects: [minimal],
        skills: [{ category: undefined, names: ['x'.repeat(100)], provenance: PROV }],
        achievements: [{ text: '', impact: undefined, provenance: PROV }],
        languages: [{ name: 'Klingon', level: 'regular' }],
      },
      'cv.pdf',
      '2026-08-30T21:00:00.000Z',
    );
    expect(result.profile.projects).toHaveLength(0);
    expect(result.issues.some((issue) => issue.reason.includes('proyecto descartada') || issue.reason.includes('descartada: «Web»'))).toBe(true);
    expect(result.issues.some((issue) => issue.reason.startsWith('habilidad descartada'))).toBe(true);
    expect(result.issues.some((issue) => issue.reason.startsWith('logro descartado'))).toBe(true);
    expect(result.issues.some((issue) => issue.reason.includes('(«regular»)'))).toBe(true);
    expect(result.profile.languages[0]).toEqual({ name: 'Klingon', level: 'B2' });
  });

  it('el id de una habilidad sin letras cae al sufijo numérico y el informe cita la línea del degradado', () => {
    const result = draftFiles(
      { ...BASE, skills: [{ category: undefined, names: ['···'], provenance: PROV }], experience: [{ title: 'Sin fechas', subtitle: 'Acme', location: undefined, start: undefined, end: undefined, current: false, date: undefined, url: undefined, field: undefined, summary: undefined, technologies: [], achievements: [], provenance: { line: 7, text: 'contexto original' } }] },
      'cv.pdf',
      '2026-08-30T21:00:00.000Z',
    );
    expect(result.profile.skills[0]?.id).toBe('skill-1');
    const report = draftReport(result, 'cv.pdf', '2026-08-30T21:00:00.000Z');
    expect(report).toContain('(línea 7: «contexto original»)');
  });

  it('una entrada con todos los campos opcionales llena las dos ramas de cada uno', () => {
    const result = draftFiles(
      {
        ...BASE,
        experience: [{ title: 'Backend', subtitle: 'Acme', location: 'Valencia', start: '2020-01', end: undefined, current: true, date: undefined, url: undefined, field: undefined, summary: 'Equipo de pagos.', technologies: ['PHP'], achievements: [{ text: 'Hice cosas.', impact: '+1', provenance: PROV }], provenance: PROV }],
      },
      'cv.pdf',
      '2026-08-30T21:00:00.000Z',
    );
    expect(result.profile.experience[0]).toMatchObject({ company: 'Acme', location: 'Valencia', summary: 'Equipo de pagos.', technologies: ['PHP'] });
    expect(result.profile.experience[0]?.dates).toMatchObject({ start: '2020-01' });
  });
});
