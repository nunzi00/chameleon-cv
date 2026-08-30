<script lang="ts">
  import { onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import PdfViewer from '../components/PdfViewer.svelte';
  import TagPicker from '../components/TagPicker.svelte';
  import type { ApiClient, OutputFile } from '../lib/api/client';
  import type { GenerateResponse, HistoryEntry, ProfileResponse, ThemesResponse } from '../lib/api/types';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { EMPTY_FORM, buildAnalyzeRequest, buildGenerateRequest, offerOf, projectOptions, skillGroups, specialtyPreview, type GenerateForm } from '../lib/generate/form';
  import { describeHistoryEntries } from '../lib/generate/history';
  import { analysisView, reportSections, type AnalysisView, type ReportSection } from '../lib/generate/report';
  import type { Route } from '../lib/router';
  import { describeInstalled, installProblem, themeGroups, themeOptionLabel, type InstallProblem } from '../lib/themes/install';

  interface Props {
    api: ApiClient;
    onsession: () => void;
    navigate: (route: Route) => void;
  }
  let { api, onsession, navigate }: Props = $props();

  /** Origen de la oferta en pantalla: la pestaña «PDF» desemboca en el modo «texto» al extraerlo. */
  type OfferSource = 'none' | 'text' | 'pdf' | 'file';
  const OFFER_TABS: readonly { readonly id: OfferSource; readonly label: string }[] = [
    { id: 'none', label: 'Ninguna' },
    { id: 'text', label: 'Texto' },
    { id: 'pdf', label: 'PDF' },
    { id: 'file', label: 'Del espacio' },
  ];

  let form = $state<GenerateForm>({ ...EMPTY_FORM });
  let offerSource = $state<OfferSource>('none');
  let specialties = $state<readonly string[]>([]);
  let typstUsable = $state(false);
  let themes = $state<ThemesResponse | undefined>(undefined);
  let profile = $state<ProfileResponse | undefined>(undefined);
  /** Procesamientos previos de la oferta actual (se consulta al cambiarla y llega también con cada análisis o generación). */
  let history = $state<readonly HistoryEntry[]>([]);
  let historyTimer: ReturnType<typeof setTimeout> | undefined;
  const preview = $derived(specialtyPreview(profile, form.specialty));

  $effect(() => {
    const offer = offerOf(form);
    clearTimeout(historyTimer);
    if (!offer.ok || offer.body === undefined) {
      history = [];
      return;
    }
    const body = offer.body;
    historyTimer = setTimeout(() => {
      api
        .offerHistory({ offer: body })
        .then((result) => {
          history = result.entries;
        })
        .catch(() => {
          history = [];
        });
    }, 400);
  });
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

  function chooseOffer(source: OfferSource): void {
    offerSource = source;
    form = { ...form, offerMode: source === 'none' ? 'none' : source === 'file' ? 'file' : 'text' };
  }

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function loadContext(): Promise<void> {
    try {
      const [status, inventory, loadedProfile] = await Promise.all([api.status(), api.themes(), Promise.resolve().then(() => api.profile()).catch(() => undefined)]);
      specialties = status.artifact.specialties;
      profile = loadedProfile;
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
      offerSource = 'text';
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
      const analyzed = await api.analyze(request.body);
      analysis = analysisView(analyzed);
      history = analyzed.history;
      // T-8.9: si no se eligió especialidad, se rellena con la que más cubre la oferta.
      if (form.specialty === '' && analysis.suggested !== undefined && specialties.includes(analysis.suggested.id)) {
        form = { ...form, specialty: analysis.suggested.id };
        notice = `Especialidad sugerida por la oferta: «${analysis.suggested.id}» (${analysis.suggested.title}; cubre ${analysis.suggested.covered} de ${analysis.suggested.total} requisitos). Cámbiala en el paso 1 si no te encaja.`;
      }
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
    busy = form.format === 'pdf' && form.engine === 'typst' ? 'Generando el CV con Typst…' : 'Generando el CV…';
    error = undefined;
    notice = undefined;
    generated = undefined;
    pdf = undefined;
    report = [];
    try {
      const result = await api.generate(request.body);
      generated = result;
      history = result.history;
      report = result.report === undefined ? [] : reportSections(result.report);
      if (result.output.kind === 'pdf') {
        pdf = await api.output(result.output.name);
      }
      const kept = result.report?.kept.length ?? 0;
      notice = `CV escrito en ${result.output.path}${kept === 0 ? '' : ` · ${kept} ${kept === 1 ? 'evidencia de la oferta conservada' : 'evidencias de la oferta conservadas'}`}${result.warnings.length === 0 ? '' : ' (con avisos)'}`;
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

<section class="cv-split-generar" aria-labelledby="cv-generar-title">
  <form class="cv-generar-form" onsubmit={(event) => { event.preventDefault(); void generate(); }}>
    <div class="cv-generar-scroll">
      <h1 id="cv-generar-title" class="cv-generar-title">Generar</h1>
      {#if history.length > 0}<Notice kind="warn" title={`Esta oferta ya se procesó ${history.length === 1 ? 'una vez' : `${history.length} veces`}`} lines={describeHistoryEntries(history)} />{/if}

      <div class="cv-step">
        <div class="cv-step-head"><span class="cv-step-num">1</span><h2>Especialidad</h2></div>
        <label class="cv-field">
          <span>Especialidad</span>
          <select name="specialty" bind:value={form.specialty}>
            <option value="">Todo el perfil (sin selección)</option>
            {#each specialties as specialty (specialty)}<option value={specialty}>{specialty}</option>{/each}
          </select>
        </label>
        {#if preview !== undefined}
          <div class="cv-panel cv-preview"><strong>{preview.headline}</strong><span class="cv-muted">{preview.summary}</span></div>
        {/if}
      </div>

      <div class="cv-step">
        <div class="cv-step-head"><span class="cv-step-num">2</span><h2>Oferta <span class="cv-muted">(opcional)</span></h2></div>
        <div class="cv-tabs" role="tablist" aria-label="Origen de la oferta">
          {#each OFFER_TABS as tab (tab.id)}
            <button type="button" role="tab" aria-selected={offerSource === tab.id} onclick={() => chooseOffer(tab.id)}>{tab.label}</button>
          {/each}
        </div>
        {#if offerSource === 'none'}
          <p class="cv-muted cv-step-note">Sin oferta, el CV se recorta solo por la especialidad y los límites. Con ella, además, se ordena por adecuación y se puede analizar.</p>
        {:else if offerSource === 'text'}
          <label class="cv-field">
            <span>Texto de la oferta</span>
            <textarea name="offerText" class="mono" bind:value={form.offerText}></textarea>
          </label>
          <p class="cv-muted cv-step-note">El texto se queda en tu máquina.</p>
        {:else if offerSource === 'pdf'}
          <label class="cv-field">
            <span>…o sube su PDF (se extrae el texto en local)</span>
            <input name="offerPdf" type="file" accept="application/pdf" onchange={extract} />
          </label>
          <p class="cv-muted cv-step-note">El PDF se lee en un proceso aparte y solo se conserva su texto, que revisarás en la pestaña «Texto».</p>
        {:else}
          <label class="cv-field">
            <span>Fichero (relativo al espacio de trabajo)</span>
            <input name="offerFile" class="mono" bind:value={form.offerFile} placeholder="offers/acme.txt" />
          </label>
        {/if}
      </div>

      <div class="cv-step">
        <div class="cv-step-head"><span class="cv-step-num">3</span><h2>Salida</h2></div>
        <div class="cv-form cv-form-2">
          <label class="cv-field">
            <span>Formato</span>
            <select name="format" bind:value={form.format}>
              <option value="pdf">PDF</option>
              <option value="md">Markdown</option>
            </select>
          </label>
          <label class="cv-field">
            <span>Motor</span>
            <select name="engine" bind:value={form.engine} disabled={form.format !== 'pdf'}>
              <option value="typst" disabled={!typstUsable}>Typst{typstUsable ? '' : ' (no disponible)'}</option>
              <option value="pdfkit">pdfkit (sin dependencias)</option>
            </select>
          </label>
          {#if themes !== undefined}
            <label class="cv-field">
              <span>Tema</span>
              <select name="theme" bind:value={form.theme} disabled={form.format !== 'pdf' || form.engine !== 'typst'}>
                <option value="">Por defecto ({themes.defaultName})</option>
                {#each themeGroups(themes.entries) as group (group.label)}
                  <optgroup label={group.label}>
                    {#each group.entries as entry (entry.name)}<option value={entry.name}>{themeOptionLabel(entry)}</option>{/each}
                  </optgroup>
                {/each}
              </select>
            </label>
          {:else}
            <div class="cv-field"><span>Tema</span><span class="cv-muted">cargando…</span></div>
          {/if}
          <label class="cv-field"><span>Top N logros</span><input name="topN" inputmode="numeric" bind:value={form.topN} placeholder="todos" /></label>
        </div>
        <div class="cv-checks">
          <label class="cv-check"><input name="compact" type="checkbox" bind:checked={form.compact} /> Compacto (una página)</label>
          <label class="cv-check"><input name="build" type="checkbox" bind:checked={form.build} /> Recompilar el artefacto antes</label>
        </div>
        {#if skillGroups(profile).length > 0}
          <div class="cv-field">
            <span>Solo estas skills ({form.skills.length === 0 ? 'todas' : form.skills.length})</span>
            <TagPicker name="Solo estas skills" groups={skillGroups(profile).map((group) => ({ label: group.category, options: group.names.map((skill) => ({ value: skill, label: skill })) }))} bind:selected={form.skills} />
          </div>
        {/if}
        {#if projectOptions(profile).length > 0}
          <div class="cv-field">
            <span>Solo estos proyectos ({form.projects.length === 0 ? 'todos' : form.projects.length})</span>
            <TagPicker name="Solo estos proyectos" groups={[{ label: '', options: projectOptions(profile).map((project) => ({ value: project.id, label: project.name })) }]} bind:selected={form.projects} />
          </div>
        {/if}
        <details class="cv-collapse">
          <summary><strong>Más opciones</strong><span class="cv-muted">límites, idioma y nombre del fichero</span></summary>
          <div class="cv-form cv-form-2">
            <label class="cv-field"><span>Skills como máximo</span><input name="maxSkills" inputmode="numeric" bind:value={form.maxSkills} placeholder="todas" /></label>
            <label class="cv-field"><span>Proyectos como máximo</span><input name="maxProjects" inputmode="numeric" bind:value={form.maxProjects} placeholder="todos" /></label>
            <label class="cv-field"><span>Certificaciones</span><input name="maxCertifications" inputmode="numeric" bind:value={form.maxCertifications} placeholder="todas" /></label>
            <label class="cv-field"><span>Idioma (locale)</span><input name="locale" bind:value={form.locale} placeholder="el del perfil" /></label>
            <label class="cv-field"><span>Nombre del fichero</span><input name="output" bind:value={form.output} placeholder="el de la CLI" /></label>
          </div>
        </details>
      </div>

      {#if themes !== undefined}
        <details class="cv-collapse">
          <summary><strong>Temas de Typst</strong><span class="cv-muted">· {themes.entries.length} instalados · por defecto {themes.defaultName}</span></summary>
          <div class="cv-stack">
            <div class="cv-form cv-form-2">
              <label class="cv-field"><span>Nuevo tema (themes/&lt;nombre&gt;/ en el proyecto)</span><input name="themeName" bind:value={newTheme.name} /></label>
              <label class="cv-field"><span>A partir de</span><select name="themeFrom" bind:value={newTheme.from}>{#each themes.entries as entry (entry.name)}<option value={entry.name}>{entry.name}</option>{/each}</select></label>
              <div class="cv-actions"><button class="cv-button small" type="button" onclick={(event) => void createTheme(event as unknown as SubmitEvent)}>Crear tema</button></div>
            </div>
            <div class="cv-form cv-form-2">
              <label class="cv-field"><span>Instalar tema (URL https a un .zip o .tar.gz, o archivo/directorio del espacio de trabajo)</span><input name="installSource" class="mono" bind:value={install.source} /></label>
              <label class="cv-field"><span>Nombre (opcional)</span><input name="installName" bind:value={install.name} /></label>
              <label class="cv-field"><span>Huella SHA-256 publicada (opcional)</span><input name="installSha256" class="mono" bind:value={install.sha256} /></label>
              <label class="cv-check"><input type="checkbox" name="installReplace" bind:checked={install.replace} /> Reemplazar si ya existe (el anterior se aparta a una copia .bak)</label>
              <div class="cv-actions">
                <button class="cv-button small" type="button" onclick={() => void installTheme(undefined, true)}>Ver el plan</button>
                <button class="cv-button small" type="button" onclick={() => void installTheme()}>Instalar tema…</button>
              </div>
              {#if installIssue?.kind === 'remote-disabled'}<p class="cv-muted cv-step-note">{installIssue.message}</p>{/if}
            </div>
          </div>
        </details>
      {/if}
    </div>
    <div class="cv-generar-actions">
      <button class="cv-button primary cta" type="submit" disabled={busy !== undefined}>Generar CV</button>
      <button class="cv-button" type="button" disabled={busy !== undefined || form.offerMode === 'none'} onclick={analyze}>Analizar oferta</button>
      {#if busy !== undefined}<span class="cv-muted" aria-live="polite">{busy}</span>{/if}
      <span class="cv-header-spacer"></span>
      <span class="cv-muted">→ <code>output/</code></span>
    </div>
  </form>

  <div class="cv-generar-result">
    {#if error !== undefined}
      <Notice kind="error" title={error.title} lines={error.lines}>{error.detail}{#if error.kind !== 'data' && error.kind !== 'session'} No se ha escrito ningún fichero en <code>output/</code>.{/if}</Notice>
    {/if}
    {#if notice !== undefined}<Notice kind="ok">{notice}</Notice>{/if}
    {#if busy !== undefined && generated === undefined && analysis === undefined}
      <div class="cv-card cv-card-tight">
        <p class="cv-loading"><Icon name="play" size={15} />{busy}</p>
        <div class="cv-skeleton tall" aria-hidden="true"></div>
      </div>
    {:else if generated === undefined && analysis === undefined}
      <div class="cv-empty">
        <div class="cv-empty-inner">
          <div class="cv-empty-icon"><Icon name="file" size={26} /></div>
          <h1>Todavía no hay resultado</h1>
          <p>Elige la especialidad, pega una oferta si la tienes y pulsa «Generar CV». Aquí aparecerán el documento, la adecuación a la oferta y el informe de decisiones.</p>
        </div>
      </div>
    {:else}
      <div class="cv-result-grid">
        {#if generated !== undefined}
          <div class="cv-card cv-card-tight cv-result-doc">
            <div class="cv-card-head">
              <span class="cv-mono">{generated.output.path}</span>
              {#if generated.output.kind === 'md' && markdownUrl !== undefined}<a class="cv-button small" href={markdownUrl} download={generated.output.name}>Descargar</a>{/if}
              <button class="cv-button small" type="button" onclick={() => navigate({ page: 'salidas', item: generated?.output.name })}>Ver en Salidas</button>
            </div>
            {#if generated.output.kind === 'md' && generated.output.markdown !== undefined}
              <pre class="cv-text">{generated.output.markdown}</pre>
            {:else if pdf !== undefined}
              <PdfViewer blob={pdf.blob} name={pdf.name} />
            {/if}
          </div>
        {/if}
        <div class="cv-stack">
          {#if analysis !== undefined}
            <div class="cv-card cv-card-tight">
              <h2>Adecuación a la oferta</h2>
              <p class="cv-muted">{analysis.headline}</p>
              {#if analysis.percent !== undefined}
                <div class="cv-adequacy">
                  <span class="cv-adequacy-figure">{analysis.percent} %</span>
                  <div class="cv-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={analysis.percent} aria-label="Adecuación"><div style={`width: ${analysis.percent}%`}></div></div>
                  <span class="cv-muted">{analysis.counts.demonstrated} de {analysis.counts.recognized} términos demostrados · umbral orientativo 70 %</span>
                </div>
              {/if}
              <p>{analysis.adequacy}</p>
              {#if analysis.suggested !== undefined}
                <p class="cv-muted">Especialidad sugerida: <strong>{analysis.suggested.id}</strong> ({analysis.suggested.title}; cubre {analysis.suggested.covered} de {analysis.suggested.total} requisitos con peso).</p>
              {/if}
              <div class="cv-actions">
                <button class="cv-button primary small" type="button" disabled={busy !== undefined} onclick={generate}>Generar con esta adecuación</button>
                <span class="cv-actions-note">Las evidencias demostradas no se recortan por los límites.</span>
              </div>
              <div class="cv-adequacy-columns">
                <div>
                  <h3><span class="cv-dot ok"></span>Demostrados <span class="cv-muted">{analysis.demonstrated.length}</span></h3>
                  {#if analysis.demonstrated.length === 0}<p class="cv-muted">Ninguno</p>{:else}<ul>{#each analysis.demonstrated as term (term.term)}<li><strong>{term.term}</strong> <span class="cv-muted">{term.detail}</span>{#if term.evidence.length > 0}<br /><span class="cv-muted">← {term.evidence.join(', ')}</span>{/if}</li>{/each}</ul>{/if}
                </div>
                <div>
                  <h3><span class="cv-dot warn"></span>No demostrados <span class="cv-muted">{analysis.missing.length}</span></h3>
                  {#if analysis.missing.length === 0}<p class="cv-muted">Ninguno</p>{:else}<ul>{#each analysis.missing as term (term.term)}<li><strong>{term.term}</strong> <span class="cv-muted">{term.detail}</span></li>{/each}</ul>{/if}
                </div>
                <div>
                  <h3><span class="cv-dot error"></span>Carencias <span class="cv-muted">{analysis.gaps.length}</span></h3>
                  <p>{analysis.gaps.length === 0 ? 'Ninguna detectada' : analysis.gaps.join(' · ')}</p>
                  {#if analysis.ranking.length > 0}
                    <h3>Mejores evidencias</h3>
                    <ol>{#each analysis.ranking as evidence (evidence.id)}<li>{evidence.id} · {evidence.label} ({evidence.score})</li>{/each}</ol>
                  {/if}
                </div>
              </div>
            </div>
          {/if}
          {#if generated !== undefined && report.length > 0}
            <details class="cv-collapse cv-report">
              <summary><strong>Informe de decisiones</strong><span class="cv-muted">· {report.length} secciones</span></summary>
              {#each report as section (section.title)}
                <h3>{section.title}</h3>
                <pre>{section.lines.join('\n')}</pre>
              {/each}
            </details>
          {/if}
          {#if generated !== undefined && generated.warnings.length > 0}
            <Notice kind="warn" title="Avisos">{generated.warnings.map((warning) => warning.kind).join(', ')}</Notice>
          {/if}
        </div>
      </div>
    {/if}
  </div>

  <Dialog open={installIssue?.kind === 'consent-required'} title="Descargar un tema: confirma" onclose={() => (installIssue = undefined)}>
    {#if installIssue?.kind === 'consent-required'}
      <p>Esto sale de tu máquina: una descarga HTTPS, nada más; no se envía ningún dato tuyo.</p>
      <dl class="cv-consent">
        <dt>Host</dt><dd>{installIssue.host}</dd>
        <dt>Origen</dt><dd class="cv-mono">{installIssue.source}</dd>
        <dt>Límite</dt><dd>{installIssue.limit}</dd>
        <dt>Coste</dt><dd>0,00 €</dd>
      </dl>
      <p class="cv-muted">La huella SHA-256 se mostrará al instalar.</p>
      <div class="cv-dialog-actions">
        <button class="cv-button" type="button" onclick={() => (installIssue = undefined)}>Cancelar</button>
        <button class="cv-button primary" type="button" onclick={() => void installTheme(installIssue?.kind === 'consent-required' ? installIssue.estimateId : undefined)}>Descargar e instalar</button>
      </div>
    {/if}
  </Dialog>
</section>
