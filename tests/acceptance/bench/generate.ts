/**
 * Generador de los artefactos **derivados** del banco de pruebas (T-5.5.1): las ofertas en PDF y las
 * revisiones marcadas para `cv improve apply`. Todo sale de las fuentes del banco de forma
 * reproducible (fecha fija, fuentes embebidas, huellas calculadas sobre las fuentes); nunca se
 * descarga nada. Uso: `npm run acceptance:bench`; los ficheros generados se versionan y cualquier
 * cambio se revisa en el diff.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import PDFDocument from 'pdfkit';

import { buildSourceIndex, type SourceIndex } from '../../../src/cli';
import { fingerprint, formatReview, type ReviewHeader, type ReviewItem, type ReviewSource } from '../../../src/llm';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../../../src/parsers';
import { FONTS_DIRECTORY } from '../../../src/renderers/pdf';

export const BENCH_WORKSPACE = resolve(__dirname, 'workspace');
/** La misma fecha que `updatedAt` en profile.md: todo artefacto del banco lleva esta fecha. */
export const BENCH_DATE = new Date(Date.UTC(2026, 7, 15, 9, 0, 0));
export const OFFER_PDFS = ['nexo-senior-backend', 'orbita-platform-engineer'] as const;

/** PDF de una oferta a partir de su texto: A4, Source Sans 3 embebida, fechas fijas → bytes reproducibles. */
export function renderOfferPdf(text: string, title: string): Promise<Buffer> {
  return new Promise((resolvePdf, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margins: { top: 64, bottom: 64, left: 64, right: 64 },
      pdfVersion: '1.7',
      info: { Title: title, Author: 'Banco de pruebas de Chameleon CV', Creator: 'tests/acceptance/bench/generate.ts', Producer: 'pdfkit', CreationDate: BENCH_DATE, ModDate: BENCH_DATE },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolvePdf(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.registerFont('Regular', join(FONTS_DIRECTORY, 'SourceSans3-Regular.ttf'));
    doc.registerFont('Semibold', join(FONTS_DIRECTORY, 'SourceSans3-Semibold.ttf'));
    const [heading = '', ...rest] = text.replace(/\r\n?/g, '\n').trimEnd().split('\n');
    doc.font('Semibold').fontSize(17).text(heading);
    doc.moveDown(0.6);
    doc.font('Regular').fontSize(11);
    for (const line of rest) {
      if (line.trim() === '') {
        doc.moveDown(0.5);
      } else {
        doc.text(line, { lineGap: 2 });
      }
    }
    doc.end();
  });
}

export async function generateOfferPdfs(workspace: string = BENCH_WORKSPACE): Promise<string[]> {
  const directory = join(workspace, 'offers', 'pdf');
  await mkdir(directory, { recursive: true });
  const written: string[] = [];
  for (const name of OFFER_PDFS) {
    const text = await readFile(join(workspace, 'offers', `${name}.txt`), 'utf8');
    const path = join(directory, `${name}.pdf`);
    await writeFile(path, await renderOfferPdf(text, name));
    written.push(path);
  }
  return written;
}

const HEADER: Omit<ReviewHeader, 'task' | 'promptVersion'> = {
  generatedAt: BENCH_DATE.toISOString(),
  specialty: 'backend',
  dataDir: 'data/sources',
  provider: { id: 'ollama', baseUrl: 'http://127.0.0.1:11434', model: 'banco-de-pruebas' },
  temperature: 0,
  seed: 7,
};
const ACCEPTED = { accepted: true, violations: [] } as const;

function achievementSource(index: SourceIndex, id: string): { readonly original: string; readonly source: ReviewSource } {
  const located = index.achievements.get(id);
  if (located === undefined) {
    throw new Error(`El banco no tiene el logro «${id}»`);
  }
  return { original: located.text, source: { file: located.file, line: located.line, hash: fingerprint(located.text) } };
}

/** Revisiones «como si» las hubiera escrito el co-piloto, con una propuesta marcada `[x]` en cada una. */
export async function generateReviews(workspace: string = BENCH_WORKSPACE): Promise<string[]> {
  const dataset = await loadDataset(join(workspace, 'data', 'sources'), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    throw new Error(`Banco inválido: ${dataset.errors.map((error) => `${error.file}: ${error.message}`).join('; ')}`);
  }
  const index = buildSourceIndex(dataset.profile, dataset.provenance);
  const latency = achievementSource(index, 'exp-nexo-pagos-2');
  const terraform = achievementSource(index, 'exp-orbita-cloud-2');
  const improveItems: ReviewItem[] = [
    {
      id: 'exp-nexo-pagos-2',
      location: 'Staff Backend Engineer · Nexo Pagos',
      original: latency.original,
      impact: '-56 % p99',
      source: latency.source,
      proposals: [
        { text: 'Rediseñé la capa de caché y los índices de la API de autorización, bajando la latencia `p99` de 480 ms a 210 ms.', rationale: 'verbo de acción y resultado al final', verdict: ACCEPTED },
        {
          text: 'Rediseñé la capa de caché de la API de autorización, bajando la latencia `p99` de 480 ms a 150 ms.',
          rationale: 'inventa la cifra final',
          verdict: { accepted: false, violations: [{ code: 'VIOLATION_C2_NUMBER_ADDED', details: ['150'] }, { code: 'VIOLATION_C2_FACT_OMITTED', details: ['210'] }] },
        },
      ],
      fromCache: false,
      elapsedMs: 21400,
      usage: { promptTokens: 512, completionTokens: 118 },
    },
    {
      id: 'exp-orbita-cloud-2',
      location: 'Platform Engineer · Órbita Cloud',
      original: terraform.original,
      impact: 'de 3 días a 40 minutos',
      source: terraform.source,
      proposals: [{ text: 'Automaticé con Terraform el aprovisionamiento de entornos, que pasó de 3 días a 40 minutos.', rationale: 'más directo', verdict: ACCEPTED }],
      fromCache: true,
      elapsedMs: 0,
      usage: {},
    },
  ];
  const improve = formatReview({ ...HEADER, task: 'improve', promptVersion: 'improve.v1' }, improveItems).replace('- [ ] Propuesta 1: Rediseñé la capa de caché y los índices', '- [x] Propuesta 1: Rediseñé la capa de caché y los índices');
  const backend = index.summaries.get('specialty:backend');
  if (backend === undefined) {
    throw new Error('El banco no tiene la especialidad backend');
  }
  const summarize = formatReview({ ...HEADER, task: 'summarize', promptVersion: 'summarize.v1' }, [
    {
      id: 'summary',
      location: 'Resumen profesional · backend',
      original: backend.text,
      source: { file: backend.file, line: backend.line, hash: fingerprint(backend.text) },
      proposals: [
        {
          text: 'Senior Backend Engineer con once años construyendo plataformas de pago: PHP, Symfony, Kafka y PostgreSQL sobre Kubernetes, con la latencia y la resiliencia como primer requisito.\n\nDiseñé la pasarela que procesa 9 M de transacciones al mes sin pérdida de eventos y bajé la latencia p99 de autorización de 480 ms a 210 ms.',
          rationale: 'dos párrafos: perfil y prueba',
          verdict: { ...ACCEPTED, coverage: { mentioned: ['php', 'symfony', 'kafka', 'postgresql', 'kubernetes'], missing: ['api', 'performance'] } },
        },
      ],
      fromCache: false,
      elapsedMs: 38900,
      usage: { promptTokens: 1480, completionTokens: 210 },
    },
  ]).replace('- [ ] Propuesta 1:', '- [x] Propuesta 1:');
  const directory = join(workspace, 'reviews');
  await mkdir(directory, { recursive: true });
  const improvePath = join(directory, 'revision-improve-marcada.md');
  const summarizePath = join(directory, 'revision-summarize-backend-marcada.md');
  await writeFile(improvePath, improve, { mode: 0o644 });
  await writeFile(summarizePath, summarize, { mode: 0o644 });
  return [improvePath, summarizePath];
}

if (require.main === module) {
  Promise.all([generateOfferPdfs(), generateReviews()])
    .then(([pdfs, reviews]) => {
      for (const path of [...pdfs, ...reviews]) {
        console.log(`generado ${path}`);
      }
    })
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}
