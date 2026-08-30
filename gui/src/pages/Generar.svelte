<script lang="ts">
  import { onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Notice from '../components/Notice.svelte';
  import PdfViewer from '../components/PdfViewer.svelte';
  import type { ApiClient, OutputFile } from '../lib/api/client';
  import type { GenerateResponse, ThemesResponse } from '../lib/api/types';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { EMPTY_FORM, buildAnalyzeRequest, buildGenerateRequest, type GenerateForm } from '../lib/generate/form';
  import { analysisView, reportSections, type AnalysisView, type ReportSection } from '../lib/generate/report';
  import type { Route } from '../lib/router';
  import { describeInstalled, installProblem, themeOptionLabel, type InstallProblem } from '../lib/themes/install';

  interface Props {
    api: ApiClient;
    onsession: () => void;
    navigate: (route: Route) => void;
  }
  let { api, onsession, navigate }: Props = $props();

  let form = $state<GenerateForm>({ ...EMPTY_FORM });
  let specialties = $state<readonly string[]>([]);
  let typstUsable = $state(false);
  let themes = $state<ThemesResponse | undefined>(undefined);
  let error = $state<ExplainedError | undefined>(undefined);
  let notice = $state<string | undefined>(undefined);
  let busy = $state<string | undefined>(undefined);
  let generated = $state<GenerateResponse | undefined>(undefined);
  let pdf = $state<OutputFile | undefined>(undefined);
  let markdownUrl = $state<string | undefined>(undefined);
  let report = $state<readonly ReportSection[]>([]);
  let analysis = $state<AnalysisView | undefined>(undefined);
  let newTheme = $state({ name: '', from: 'default' });
  let install = $state({ source: '', name: '', sha256: '', replace: false });
  let installIssue = $state<InstallProblem | undefined>(undefined);

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function loadContext(): Promise<void> {
    try {
      const [status, inventory] = await Promise.all([api.status(), api.themes()]);
      specialties = status.artifact.specialties;
      typstUsable = status.typst.usable;
      themes = inventory;
      if (typstUsable) {
        form = { ...form, engine: 'typst' };
      }
    } catch (caught) {
      fail(caught);
    }
  }

  async function extract(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    if (file === undefined) {
      return;
    }
    busy = 'Extrayendo el texto del PDF…';
    error = undefined;
    try {
      const extracted = await api.extractOffer(file);
      form = { ...form, offerMode: 'text', offerText: extracted.text };
      notice = `Texto extraído de ${file.name}: revísalo antes de generar.`;
    } catch (caught) {
      fail(caught);
    } finally {
      busy = undefined;
      input.value = '';
    }
  }

  async function analyze(): Promise<void> {
    const request = buildAnalyzeRequest(form);
    if (!request.ok) {
      error = { kind: 'data', title: 'Falta algo', detail: request.message, lines: [] };
      return;
    }
    busy = 'Analizando la oferta…';
    error = undefined;
    analysis = undefined;
    try {
      analysis = analysisView(await api.analyze(request.body));
    } catch (caught) {
      fail(caught);
    } finally {
      busy = undefined;
    }
  }

  async function generate(): Promise<void> {
    const request = buildGenerateRequest(form);
    if (!request.ok) {
      error = { kind: 'data', title: 'Falta algo', detail: request.message, lines: [] };
      return;
    }
    busy = 'Generando el CV…';
    error = undefined;
    notice = undefined;
    generated = undefined;
    pdf = undefined;
    report = [];
    try {
      const result = await api.generate(request.body);
      generated = result;
      report = result.report === undefined ? [] : reportSections(result.report);
      if (result.output.kind === 'pdf') {
        pdf = await api.output(result.output.name);
      }
      notice = `CV escrito en ${result.output.path}${result.warnings.length === 0 ? '' : ' (con avisos)'}`;
    } catch (caught) {
      fail(caught);
    } finally {
      busy = undefined;
    }
  }

  async function createTheme(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const name = newTheme.name.trim();
    if (name === '') {
      return;
    }
    error = undefined;
    try {
      const created = await api.createTheme({ name, from: newTheme.from });
      notice = `Tema «${created.name}» creado en ${created.directory} a partir de «${created.from}»`;
      newTheme = { name: '', from: 'default' };
      themes = await api.themes();
      form = { ...form, theme: created.name };
    } catch (caught) {
      fail(caught);
    }
  }

  /** «Instalar tema…»: con una URL, el servidor responde 409 y el diálogo pide confirmar la descarga (mismo patrón que el coste del co-piloto). */
  async function installTheme(estimateId?: string, dryRun = false): Promise<void> {
    const source = install.source.trim();
    if (source === '') {
      return;
    }
    error = undefined;
    installIssue = undefined;
    try {
      const installed = await api.installTheme({
        source,
        ...(install.name.trim() === '' ? {} : { name: install.name.trim() }),
        ...(install.sha256.trim() === '' ? {} : { sha256: install.sha256.trim() }),
        ...(dryRun ? { dryRun: true } : {}),
        ...(install.replace ? { replace: true } : {}),
        ...(estimateId === undefined ? {} : { consent: { estimateId } }),
      });
      notice = describeInstalled(installed);
      if (installed.written) {
        install = { source: '', name: '', sha256: '', replace: false };
        themes = await api.themes();
        form = { ...form, theme: installed.plan.name };
      }
    } catch (caught) {
      const problem = installProblem(caught);
      if (problem === undefined) {
        fail(caught);
      } else {
        installIssue = problem;
      }
    }
  }

  onMount(() => {
    void loadContext();
  });

  $effect(() => {
    if (generated === undefined || generated.output.kind !== 'md' || generated.output.markdown === undefined) {
      markdownUrl = undefined;
      return undefined;
    }
    const created = URL.createObjectURL(new Blob([generated.output.markdown], { type: 'text/markdown' }));
    markdownUrl = created;
    return () => URL.revokeObjectURL(created);
  });
</script>

<section aria-labelledby="cv-generar-title">
  <h2 id="cv-generar-title">Generar</h2>
  {#if error !== undefined}<Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>{/if}
  {#if notice !== undefined}<Notice kind="ok">{notice}</Notice>{/if}
  <form class="cv-card cv-form" onsubmit={(event) => { event.preventDefault(); void generate(); }}>
    <label class="cv-field">
      <span>Especialidad</span>
      <select name="specialty" bind:value={form.specialty}>
        <option value="">Todo el perfil (sin selección)</option>
        {#each specialties as specialty (specialty)}<option value={specialty}>{specialty}</option>{/each}
      </select>
    </label>
    <label class="cv-field">
      <span>Oferta</span>
      <select name="offerMode" bind:value={form.offerMode}>
        <option value="none">Sin oferta</option>
        <option value="text">Texto pegado (o PDF subido)</option>
        <option value="file">Fichero del espacio de trabajo</option>
      </select>
    </label>
    {#if form.offerMode === 'text'}
      <label class="cv-field wide">
        <span>Texto de la oferta</span>
        <textarea name="offerText" bind:value={form.offerText}></textarea>
      </label>
      <label class="cv-field">
        <span>…o sube su PDF (se extrae el texto en local)</span>
        <input name="offerPdf" type="file" accept="application/pdf" onchange={extract} />
      </label>
    {:else if form.offerMode === 'file'}
      <label class="cv-field">
        <span>Fichero (relativo al espacio de trabajo)</span>
        <input name="offerFile" bind:value={form.offerFile} placeholder="ofertas/acme.txt" />
      </label>
    {/if}
    <label class="cv-field">
      <span>Formato</span>
      <select name="format" bind:value={form.format}>
        <option value="pdf">PDF</option>
        <option value="md">Markdown</option>
      </select>
    </label>
    {#if form.format === 'pdf'}
      <label class="cv-field">
        <span>Motor</span>
        <select name="engine" bind:value={form.engine}>
          <option value="pdfkit">pdfkit (sin dependencias)</option>
          <option value="typst" disabled={!typstUsable}>Typst{typstUsable ? '' : ' (no disponible)'}</option>
        </select>
      </label>
      {#if form.engine === 'typst' && themes !== undefined}
        <label class="cv-field">
          <span>Tema</span>
          <select name="theme" bind:value={form.theme}>
            <option value="">Por defecto ({themes.defaultName})</option>
            {#each themes.entries as entry (entry.name)}<option value={entry.name}>{themeOptionLabel(entry)}</option>{/each}
          </select>
        </label>
      {/if}
    {/if}
    <label class="cv-field"><span>Top N logros</span><input name="topN" inputmode="numeric" bind:value={form.topN} placeholder="todos" /></label>
    <label class="cv-field"><span>Skills</span><input name="maxSkills" inputmode="numeric" bind:value={form.maxSkills} placeholder="todas" /></label>
    <label class="cv-field"><span>Proyectos</span><input name="maxProjects" inputmode="numeric" bind:value={form.maxProjects} placeholder="todos" /></label>
    <label class="cv-field"><span>Certificaciones</span><input name="maxCertifications" inputmode="numeric" bind:value={form.maxCertifications} placeholder="todas" /></label>
    <label class="cv-field"><span>Idioma (locale)</span><input name="locale" bind:value={form.locale} placeholder="el del perfil" /></label>
    <label class="cv-field"><span>Nombre del fichero</span><input name="output" bind:value={form.output} placeholder="el de la CLI" /></label>
    <label class="cv-check"><input name="compact" type="checkbox" bind:checked={form.compact} /> Compacto (una página)</label>
    <label class="cv-check"><input name="build" type="checkbox" bind:checked={form.build} /> Recompilar el artefacto antes</label>
    <div class="cv-actions wide">
      <button class="cv-button primary" type="submit" disabled={busy !== undefined}>Generar CV</button>
      <button class="cv-button" type="button" disabled={busy !== undefined || form.offerMode === 'none'} onclick={analyze}>Analizar oferta</button>
      {#if busy !== undefined}<span class="cv-muted" aria-live="polite">{busy}</span>{/if}
    </div>
  </form>

  {#if analysis !== undefined}
    <div class="cv-card">
      <h3>Adecuación a la oferta</h3>
      <p>{analysis.headline}</p>
      <p><strong>{analysis.adequacy}</strong></p>
      <div class="cv-grid">
        <div>
          <h4>Demostrados</h4>
          {#if analysis.demonstrated.length === 0}<p class="cv-muted">Ninguno</p>{:else}<ul>{#each analysis.demonstrated as term (term.term)}<li><strong>{term.term}</strong> <span class="cv-muted">{term.detail}</span> ← {term.evidence.join(', ')}</li>{/each}</ul>{/if}
        </div>
        <div>
          <h4>No demostrados</h4>
          {#if analysis.missing.length === 0}<p class="cv-muted">Ninguno</p>{:else}<ul>{#each analysis.missing as term (term.term)}<li><strong>{term.term}</strong> <span class="cv-muted">{term.detail}</span></li>{/each}</ul>{/if}
        </div>
        <div>
          <h4>Carencias</h4>
          <p>{analysis.gaps.length === 0 ? 'Ninguna detectada' : analysis.gaps.join(' · ')}</p>
          {#if analysis.ranking.length > 0}
            <h4>Mejores evidencias</h4>
            <ol>{#each analysis.ranking as evidence (evidence.id)}<li>{evidence.id} · {evidence.label} ({evidence.score})</li>{/each}</ol>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if generated !== undefined}
    <div class="cv-card">
      <h3>Resultado</h3>
      {#if generated.output.kind === 'md' && generated.output.markdown !== undefined}
        <p class="cv-actions">
          <code>{generated.output.path}</code>
          {#if markdownUrl !== undefined}<a class="cv-button" href={markdownUrl} download={generated.output.name}>Descargar</a>{/if}
          <button class="cv-button" type="button" onclick={() => navigate({ page: 'salidas', item: generated?.output.name })}>Ver en Salidas</button>
        </p>
        <pre class="cv-text">{generated.output.markdown}</pre>
      {:else if pdf !== undefined}
        <p><code>{generated.output.path}</code></p>
        <PdfViewer blob={pdf.blob} name={pdf.name} />
      {/if}
      {#if report.length > 0}
        <details class="cv-report">
          <summary>Informe de decisiones</summary>
          {#each report as section (section.title)}
            <h4>{section.title}</h4>
            <pre>{section.lines.join('\n')}</pre>
          {/each}
        </details>
      {/if}
      {#if generated.warnings.length > 0}
        <Notice kind="warn" title="Avisos">{generated.warnings.map((warning) => warning.kind).join(', ')}</Notice>
      {/if}
    </div>
  {/if}

  {#if themes !== undefined}
    <details class="cv-card">
      <summary>Temas de Typst ({themes.entries.length}; por defecto {themes.defaultName})</summary>
      <form onsubmit={createTheme} class="cv-form">
        <label class="cv-field"><span>Nuevo tema (themes/&lt;nombre&gt;/ en el proyecto)</span><input name="themeName" bind:value={newTheme.name} required /></label>
        <label class="cv-field"><span>A partir de</span><select name="themeFrom" bind:value={newTheme.from}>{#each themes.entries as entry (entry.name)}<option value={entry.name}>{entry.name}</option>{/each}</select></label>
        <div class="cv-actions"><button class="cv-button" type="submit">Crear tema</button></div>
      </form>
      <form onsubmit={(event) => { event.preventDefault(); void installTheme(); }} class="cv-form">
        <label class="cv-field"><span>Instalar tema (URL https a un .zip o .tar.gz, o archivo/directorio del espacio de trabajo)</span><input name="installSource" bind:value={install.source} required /></label>
        <label class="cv-field"><span>Nombre (opcional)</span><input name="installName" bind:value={install.name} /></label>
        <label class="cv-field"><span>Huella SHA-256 publicada (opcional)</span><input name="installSha256" bind:value={install.sha256} /></label>
        <label class="cv-check"><input type="checkbox" name="installReplace" bind:checked={install.replace} /> Reemplazar si ya existe (el anterior se aparta a una copia .bak)</label>
        <div class="cv-actions">
          <button class="cv-button" type="button" onclick={() => void installTheme(undefined, true)}>Ver el plan</button>
          <button class="cv-button" type="submit">Instalar tema…</button>
        </div>
        {#if installIssue?.kind === 'remote-disabled'}<p class="cv-hint">{installIssue.message}</p>{/if}
      </form>
    </details>
    <Dialog open={installIssue?.kind === 'consent-required'} title="Descargar un tema: confirma">
      {#if installIssue?.kind === 'consent-required'}
        <p>Se descargará <code>{installIssue.source}</code> (host {installIssue.host}, máximo {installIssue.limit}). El archivo se leerá en el propio proceso con la política de temas; la huella se mostrará al instalar.</p>
        <div class="cv-actions">
          <button class="cv-button primary" type="button" onclick={() => void installTheme(installIssue?.kind === 'consent-required' ? installIssue.estimateId : undefined)}>Descargar e instalar</button>
          <button class="cv-button" type="button" onclick={() => (installIssue = undefined)}>Cancelar</button>
        </div>
      {/if}
    </Dialog>
  {/if}
</section>
