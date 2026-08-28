/**
 * PdfRenderer (T-2.6, `docs/pdf-integration.md` §3.2): `MasterProfile` → PDF con pdfkit, desde
 * la misma `StructuredView` que el motor Typst (T-3.2). Sin plantilla textual: la maquetación
 * es código. Fuente OFL embebida, metadatos fijos → salida reproducible; sin red ni recursos externos.
 */
import PDFDocument from 'pdfkit';

import type { MasterProfile } from '../../core/schema';
import { expandIsoDate } from '../../core/schema';
import { DEFAULT_LOCALE } from '../markdown/renderer';
import { buildStructuredView, type Block, type Run, type StructuredAchievement, type StructuredView } from '../structured';
import { DEFAULT_FONTS, type FontFiles } from './fonts';

export interface PdfRenderOptions {
  readonly locale?: string | undefined;
  readonly fonts?: FontFiles | undefined;
  /** Fecha de creación de los metadatos; por defecto `meta.updatedAt` o una fecha fija (reproducibilidad). */
  readonly createdAt?: Date | undefined;
}

const PAGE = { size: 'A4', margin: 56 } as const;
const COLOR = { text: '#111111', muted: '#555555', rule: '#9a9a9a' } as const;
const SIZE = { name: 22, headline: 12, contact: 9.5, section: 12.5, title: 11.5, meta: 9.5, body: 10.5 } as const;
const BULLET_INDENT = 12;
export const FIXED_CREATION_DATE = new Date('2000-01-01T00:00:00Z');

type Document = InstanceType<typeof PDFDocument>;

/** Fecha reproducible: la del perfil si la declara, si no una constante. */
export function creationDate(profile: MasterProfile): Date {
  return profile.meta.updatedAt === undefined ? FIXED_CREATION_DATE : new Date(`${expandIsoDate(profile.meta.updatedAt, 'start')}T00:00:00Z`);
}

class Layout {
  private readonly doc: Document;
  private readonly contentWidth: number;

  constructor(doc: Document) {
    this.doc = doc;
    this.contentWidth = doc.page.width - PAGE.margin * 2;
  }

  private fontFor(run: Run): string {
    if (run.code) {
      return 'Courier';
    }
    if (run.bold) {
      return 'Bold';
    }
    return run.italic ? 'Italic' : 'Regular';
  }

  /**
   * Escribe runs encadenados; el último cierra la línea. Los runs vacíos se descartan (pdfkit no
   * cierra la línea con un texto vacío y la viñeta siguiente se fundiría con esta); si no queda
   * ninguno se escribe una línea en blanco explícita.
   */
  runs(runs: readonly Run[], size: number, color: string, x: number, width: number): void {
    const nonEmpty = runs.filter((run) => run.text !== '');
    const items = nonEmpty.length === 0 ? [{ text: ' ', bold: false, italic: false, code: false, link: undefined }] : nonEmpty;
    items.forEach((run, index) => {
      const last = index === items.length - 1;
      this.doc.font(this.fontFor(run)).fontSize(size).fillColor(color);
      const options: PDFKit.Mixins.TextOptions = { continued: !last, width };
      if (run.link !== undefined) {
        options.link = run.link;
        options.underline = true;
      }
      if (index === 0) {
        this.doc.text(run.text, x, this.doc.y, options);
      } else {
        this.doc.text(run.text, options);
      }
    });
  }

  paragraph(runs: readonly Run[], size: number = SIZE.body, color: string = COLOR.text): void {
    this.runs(runs, size, color, PAGE.margin, this.contentWidth);
  }

  bullet(runs: readonly Run[], size: number = SIZE.body): void {
    this.ensureRoom(size * 2);
    const y = this.doc.y;
    this.doc.font('Regular').fontSize(size).fillColor(COLOR.text).text('•', PAGE.margin, y, { lineBreak: false, width: BULLET_INDENT });
    this.doc.y = y;
    this.runs(runs, size, COLOR.text, PAGE.margin + BULLET_INDENT, this.contentWidth - BULLET_INDENT);
  }

  blocks(blocks: readonly Block[], size: number = SIZE.body): void {
    for (const block of blocks) {
      if (block.bullet) {
        this.bullet(block.runs, size);
      } else {
        this.paragraph(block.runs, size);
      }
      this.doc.moveDown(0.35);
    }
  }

  section(title: string): void {
    this.ensureRoom(SIZE.section * 4);
    this.doc.moveDown(0.6);
    this.doc.font('Bold').fontSize(SIZE.section).fillColor(COLOR.text).text(title, PAGE.margin, this.doc.y, { width: this.contentWidth });
    const y = this.doc.y + 2;
    this.doc.moveTo(PAGE.margin, y).lineTo(PAGE.margin + this.contentWidth, y).lineWidth(0.6).strokeColor(COLOR.rule).stroke();
    this.doc.y = y + 8;
  }

  title(text: string): void {
    this.ensureRoom(SIZE.title * 3);
    this.doc.font('Bold').fontSize(SIZE.title).fillColor(COLOR.text).text(text, PAGE.margin, this.doc.y, { width: this.contentWidth });
  }

  meta(text: string): void {
    this.doc.font('Italic').fontSize(SIZE.meta).fillColor(COLOR.muted).text(text, PAGE.margin, this.doc.y, { width: this.contentWidth });
    this.doc.moveDown(0.3);
  }

  gap(lines = 0.5): void {
    this.doc.moveDown(lines);
  }

  private ensureRoom(height: number): void {
    if (this.doc.y + height > this.doc.page.height - PAGE.margin) {
      this.doc.addPage();
    }
  }
}

const plain = (text: string): Run[] => [{ text, bold: false, italic: false, code: false, link: undefined }];
const bold = (text: string): Run[] => [{ text, bold: true, italic: false, code: false, link: undefined }];
const italic = (text: string): Run[] => [{ text, bold: false, italic: true, code: false, link: undefined }];

function achievementRuns(achievement: StructuredAchievement): Run[] {
  return achievement.impact === undefined ? [...achievement.runs] : [...achievement.runs, ...italic(` (${achievement.impact})`)];
}

function renderContainer(layout: Layout, view: StructuredView, heading: string, subtitle: string, item: StructuredView['experience'][number] | StructuredView['projects'][number]): void {
  layout.title(heading);
  if (subtitle !== '') {
    layout.meta(subtitle);
  }
  layout.blocks(item.summary);
  for (const achievement of item.achievements) {
    layout.bullet(achievementRuns(achievement));
  }
  if (item.technologies !== '') {
    layout.gap(0.2);
    layout.paragraph([...italic(`${view.labels.technologies}: `), ...plain(item.technologies)], SIZE.meta, COLOR.muted);
  }
  layout.gap(0.7);
}

function renderView(doc: Document, view: StructuredView): void {
  const layout = new Layout(doc);
  layout.paragraph(plain(view.fullName), SIZE.name);
  if (view.headline !== undefined) {
    layout.paragraph(bold(view.headline), SIZE.headline, COLOR.muted);
  }
  if (view.contact.length > 0) {
    layout.gap(0.2);
    layout.paragraph(view.contact, SIZE.contact, COLOR.muted);
  }
  if (view.summary.length > 0) {
    layout.gap(0.6);
    layout.blocks(view.summary);
  }

  if (view.experience.length > 0) {
    layout.section(view.labels.experience);
    for (const item of view.experience) {
      renderContainer(layout, view, `${item.role} · ${item.company}`, item.location === undefined ? item.period : `${item.period} · ${item.location}`, item);
    }
  }

  if (view.projects.length > 0) {
    layout.section(view.labels.projects);
    for (const item of view.projects) {
      renderContainer(layout, view, item.role === undefined ? item.name : `${item.name} · ${item.role}`, item.meta, item);
    }
  }

  if (view.skillGroups.length > 0) {
    layout.section(view.labels.skills);
    for (const group of view.skillGroups) {
      layout.bullet([...bold(`${group.label}: `), ...plain(group.names)]);
    }
  }

  if (view.achievements.length > 0) {
    layout.section(view.labels.achievements);
    for (const achievement of view.achievements) {
      layout.bullet(achievementRuns(achievement));
    }
  }

  if (view.education.length > 0) {
    layout.section(view.labels.education);
    for (const item of view.education) {
      const field = item.field === undefined ? '' : ` (${item.field})`;
      const period = item.period === '' ? '' : ` · ${item.period}`;
      layout.bullet([...bold(item.degree), ...plain(`${field} · ${item.institution}${period}`)]);
    }
  }

  if (view.certifications.length > 0) {
    layout.section(view.labels.certifications);
    for (const item of view.certifications) {
      const parts = [item.issuer, item.date === '' ? undefined : item.date].filter((part): part is string => part !== undefined && part !== '');
      const tail = parts.length === 0 ? '' : ` · ${parts.join(' · ')}`;
      const link: Run[] = item.url === undefined ? [] : [{ text: ` · ${view.labels.link}`, bold: false, italic: false, code: false, link: item.url }];
      layout.bullet([...bold(item.name), ...plain(tail), ...link]);
    }
  }

  if (view.languages.length > 0) {
    layout.section(view.labels.languages);
    for (const language of view.languages) {
      layout.bullet(plain(`${language.name}: ${language.level}`));
    }
  }
}

/** Renderiza el CV en PDF y devuelve los bytes. */
export function renderPdfCv(profile: MasterProfile, options: PdfRenderOptions = {}): Promise<Buffer> {
  const locale = options.locale ?? profile.meta.locale ?? DEFAULT_LOCALE;
  const fonts = options.fonts ?? DEFAULT_FONTS;
  const created = options.createdAt ?? creationDate(profile);
  const view = buildStructuredView(profile, locale);
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: PAGE.size,
      margin: PAGE.margin,
      compress: true,
      info: {
        Title: `CV — ${view.fullName}`,
        Author: view.fullName,
        Creator: 'Chameleon CV',
        Producer: 'Chameleon CV',
        CreationDate: created,
        ModDate: created,
      },
    });
    doc.registerFont('Regular', fonts.regular);
    doc.registerFont('Bold', fonts.bold);
    doc.registerFont('Italic', fonts.italic);
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    doc.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    doc.on('error', reject);
    renderView(doc, view);
    doc.end();
  });
}
