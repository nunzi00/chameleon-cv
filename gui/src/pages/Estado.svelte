<script lang="ts">
  import { onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import Issues from '../components/Issues.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { ImportResponse } from '../lib/api/types';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { plural } from '../lib/format';
  import { describeImport, parseProfileText, planLines, profileFileName, serializeForDownload } from '../lib/portability';
  import { describeCheck } from '../lib/settings';
  import { describeStatus, type StatusView } from '../lib/status';
  import { issuesOf, type Issue } from '../lib/validation';

  interface Props {
    api: ApiClient;
    /** La sesión dejó de valer (401). */
    onsession: () => void;
    /** Abrir un fichero de fuentes (desde un problema de validación). */
    onopen: (file: string, line: number | undefined) => void;
  }
  let { api, onsession, onopen }: Props = $props();

  let view = $state<StatusView | undefined>(undefined);
  /** Ficheros de fuentes (segunda consulta, tolerante: si falla, no se muestra el recuento). */
  let sourcesCount = $state<number | undefined>(undefined);
  let error = $state<ExplainedError | undefined>(undefined);
  let issues = $state<readonly Issue[]>([]);
  let message = $state<string | undefined>(undefined);
  let busy = $state<string | undefined>(undefined);
  let check = $state<string | undefined>(undefined);
  let importing = $state<{ readonly name: string; readonly profile: Record<string, unknown> } | undefined>(undefined);
  let replace = $state(false);
  let plan = $state<ImportResponse | undefined>(undefined);
  let importError = $state<ExplainedError | undefined>(undefined);
  let fileInput = $state<HTMLInputElement | undefined>(undefined);
  const empty = $derived(view !== undefined && view.artifact.tone !== 'ok' && sourcesCount === 0);

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    issues = issuesOf(caught);
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function load(): Promise<void> {
    try {
      const [status, sources] = await Promise.all([api.status(), Promise.resolve().then(() => api.sources()).catch(() => undefined)]);
      view = describeStatus(status);
      sourcesCount = sources?.entries.length;
    } catch (caught) {
      fail(caught);
    }
  }

  async function run(label: string, action: () => Promise<string>): Promise<void> {
    busy = label;
    error = undefined;
    issues = [];
    message = undefined;
    try {
      message = await action();
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      busy = undefined;
    }
  }

  const validate = (): Promise<void> =>
    run('Validando…', async () => {
      const result = await api.validate();
      return `Fuentes válidas: ${plural(result.files.length, 'fichero', 'ficheros')} · ${result.summary}`;
    });
  const build = (): Promise<void> =>
    run('Compilando…', async () => {
      const result = await api.build();
      return `Artefacto compilado en ${result.artifactPath} · ${result.summary}`;
    });
  const exportProfile = (): Promise<void> =>
    run('Exportando…', async () => {
      const profile = await api.exportProfile();
      const name = profileFileName(new Date());
      const url = URL.createObjectURL(new Blob([serializeForDownload(profile)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = name;
      anchor.click();
      URL.revokeObjectURL(url);
      return `Perfil exportado como ${name}`;
    });

  async function checkCopilot(): Promise<void> {
    busy = 'Comprobando el co-piloto…';
    check = undefined;
    try {
      check = describeCheck(await api.checkLlm({}));
    } catch (caught) {
      fail(caught);
    } finally {
      busy = undefined;
    }
  }

  async function copyInit(): Promise<void> {
    try {
      await navigator.clipboard.writeText('cv init');
      message = 'Copiado: cv init';
    } catch {
      message = 'No se pudo copiar; escribe «cv init» en la terminal.';
    }
  }

  async function fileChosen(event: Event): Promise<void> {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file === undefined) {
      return;
    }
    const parsed = parseProfileText(await file.text());
    if (!parsed.ok) {
      error = { kind: 'other', title: 'El fichero no es un perfil', detail: parsed.message, lines: [] };
      return;
    }
    error = undefined;
    importError = undefined;
    plan = undefined;
    replace = false;
    importing = { name: file.name, profile: parsed.value };
  }

  async function preview(): Promise<void> {
    if (importing === undefined) {
      return;
    }
    busy = 'Comprobando…';
    importError = undefined;
    try {
      plan = await api.importProfile({ profile: importing.profile, replace, dryRun: true });
    } catch (caught) {
      plan = undefined;
      const explained = explainError(caught);
      importError = explained;
      if (explained.kind === 'session') {
        onsession();
      }
    } finally {
      busy = undefined;
    }
  }

  async function write(): Promise<void> {
    if (importing === undefined) {
      return;
    }
    const body = { profile: importing.profile, replace, dryRun: false };
    importing = undefined;
    plan = undefined;
    await run('Importando…', async () => describeImport(await api.importProfile(body)));
  }

  onMount(() => {
    void load();
  });
</script>

<section aria-labelledby="cv-estado-title">
  <div class="cv-page-title">
    <h1 id="cv-estado-title">Estado del artefacto</h1>
    {#if view !== undefined}<span class="cv-muted">v{view.version} · <code>{view.workspace}</code></span>{/if}
  </div>
  {#if error !== undefined}
    <Notice kind="error" title={error.title} lines={issues.length > 0 ? [] : error.lines}>{error.detail}</Notice>
  {/if}
  {#if issues.length > 0}
    <Notice kind="error" title={`${plural(issues.length, 'problema', 'problemas')} en las fuentes: el artefacto no se ha compilado`}>
      <p class="cv-muted">Ninguna fuente se ha modificado.</p>
      <Issues {issues} {onopen} />
      <div class="cv-actions">
        {#if issues[0] !== undefined}
          <button class="cv-button primary small" type="button" onclick={() => onopen(issues[0]?.file ?? '', issues[0]?.line)}>Abrir la primera en Fuentes</button>
        {/if}
        <button class="cv-button small" type="button" disabled={busy !== undefined} onclick={validate}>Volver a validar</button>
      </div>
    </Notice>
  {/if}
  {#if message !== undefined}<Notice kind="ok">{message}</Notice>{/if}
  {#if busy !== undefined}<p class="cv-loading" aria-live="polite"><Icon name="check-circle" size={15} />{busy}</p>{/if}

  {#if view === undefined && error === undefined}
    <p class="cv-loading" aria-live="polite">Consultando el estado del espacio de trabajo…</p>
    <div class="cv-estado-grid" aria-hidden="true">
      <div class="cv-skeleton tall"></div>
      <div class="cv-stack"><div class="cv-skeleton short delay-1"></div><div class="cv-skeleton short delay-2"></div></div>
    </div>
  {:else if view !== undefined && empty}
    <div class="cv-empty">
      <div class="cv-empty-inner">
        <div class="cv-empty-icon"><Icon name="folder" size={26} /></div>
        <h1>Sin fuentes todavía</h1>
        <p>Las fuentes viven en <code>data/sources/</code>: perfil, experiencias, proyectos, logros y skills en Markdown y CSV. Créalas con el dataset de ejemplo o importa un perfil JSON.</p>
        <div class="cv-command"><code>$ cv init</code><button class="cv-button small" type="button" onclick={copyInit}>Copiar</button></div>
        <div class="cv-actions">
          <button class="cv-button primary" type="button" disabled={busy !== undefined} onclick={load}>Volver a comprobar</button>
          <button class="cv-button" type="button" disabled={busy !== undefined} onclick={() => fileInput?.click()}>Importar un perfil JSON…</button>
        </div>
      </div>
    </div>
  {:else if view !== undefined}
    <div class="cv-estado-grid">
      <div class="cv-card cv-card-tight">
        <div class="cv-card-head">
          <h2>Artefacto</h2>
          <span class={`cv-badge ${view.artifact.tone}`}>{view.artifact.label}</span>
          <span class="cv-path">data/dist/profile.json</span>
        </div>
        {#if view.artifact.detail !== undefined}<p class="cv-muted">{view.artifact.detail}</p>{/if}
        <dl class="cv-kv cv-kv-rows">
          <dt>Fuentes</dt>
          <dd>{sourcesCount === undefined ? 'data/sources/' : `${plural(sourcesCount, 'fichero', 'ficheros')} en data/sources/`}</dd>
          <dt>Especialidades</dt>
          <dd>
            {#if view.specialties.length === 0}<span class="cv-muted">ninguna</span>{:else}
              <span class="cv-chips">{#each view.specialties as specialty (specialty)}<span class="cv-chip plain">{specialty}</span>{/each}</span>
            {/if}
          </dd>
          <dt>Temas</dt>
          <dd>{plural(view.themes.count, 'tema', 'temas')} · por defecto <code>{view.themes.defaultName}</code></dd>
        </dl>
        <div class="cv-actions">
          <button class="cv-button primary" type="button" disabled={busy !== undefined} onclick={build}>Compilar</button>
          <button class="cv-button" type="button" disabled={busy !== undefined} onclick={validate}>Validar</button>
          <span class="cv-actions-note">Compilar escribe en <code>data/dist/</code>; validar no escribe nada.</span>
        </div>
      </div>
      <div class="cv-stack">
        <div class="cv-card cv-card-tight">
          <div class="cv-card-head"><h2>Typst</h2><span class={`cv-badge ${view.typst.tone}`}>{view.typst.label}</span></div>
          {#if view.typst.path !== undefined}
            <p class="cv-muted cv-mono">{view.typst.path}{view.typst.version === undefined ? '' : ` · ${view.typst.version}`}</p>
          {:else}
            <p class="cv-muted">Sin binario seleccionado: <code>cv typst install</code> lo descarga verificado en tu caché de usuario.</p>
          {/if}
        </div>
        <div class="cv-card cv-card-tight">
          <div class="cv-card-head"><h2>Co-piloto</h2><span class={`cv-badge ${view.llm.tone}`}>{view.llm.label}</span></div>
          {#if view.llm.detail !== undefined}<p class="cv-muted">{view.llm.detail}</p>{/if}
          {#if view.llm.provider !== undefined}
            <dl class="cv-kv cv-kv-rows">
              <dt>Proveedor</dt><dd>{view.llm.provider}</dd>
              <dt>URL</dt><dd class="cv-mono">{view.llm.baseUrl}</dd>
              <dt>Modelo</dt><dd class="cv-mono">{view.llm.model}</dd>
            </dl>
          {/if}
          <div class="cv-actions">
            <button class="cv-button small" type="button" disabled={busy !== undefined} onclick={checkCopilot}>Comprobar</button>
            {#if check !== undefined}<span class="cv-actions-note">{check}</span>{/if}
          </div>
        </div>
      </div>
      <div class="cv-card cv-card-tight">
        <div class="cv-card-head"><h2>Temas instalados</h2></div>
        {#if view.themes.warning !== undefined}<p class="cv-muted">{view.themes.warning}</p>{/if}
        {#if view.themes.rows.length === 0}
          <p class="cv-muted">Ningún tema en el inventario.</p>
        {:else}
          <div class="cv-table cv-table-themes" role="table" aria-label="Temas instalados">
            <div class="cv-table-head" role="row"><span role="columnheader">Tema</span><span role="columnheader">Origen</span><span role="columnheader">Estado</span></div>
            {#each view.themes.rows as row (row.name)}
              <div class="cv-table-row static" role="row">
                <span role="cell"><code>{row.name}</code></span>
                <span role="cell" class="cv-muted">{row.origin}</span>
                <span role="cell"><span class={`cv-badge ${row.state.tone}`} title={row.state.detail}>{row.state.label}</span></span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
      <div class="cv-card cv-card-tight">
        <div class="cv-card-head"><h2>Portabilidad</h2></div>
        <p class="cv-muted">El perfil canónico en JSON: exportarlo para guardarlo o llevarlo; importarlo regenera las fuentes, solo sobre un directorio vacío o sustituyendo el actual con copia.</p>
        <div class="cv-actions">
          <button class="cv-button" type="button" disabled={busy !== undefined} onclick={exportProfile}>Exportar perfil (JSON)</button>
          <button class="cv-button" type="button" disabled={busy !== undefined} onclick={() => fileInput?.click()}>Importar perfil…</button>
        </div>
      </div>
    </div>
  {/if}
  <input bind:this={fileInput} type="file" accept=".json,application/json" class="cv-sr-only" aria-label="Fichero del perfil (JSON)" onchange={fileChosen} />
  <Dialog open={importing !== undefined} title="Importar perfil" onclose={() => (importing = undefined)}>
    {#if importing !== undefined}
      <p><code>{importing.name}</code>: se regenerarán las fuentes a partir de este perfil. Primero el plan; escribir exige confirmar.</p>
      <label class="cv-check">
        <input type="checkbox" bind:checked={replace} onchange={() => (plan = undefined)} />
        <span>Sustituir las fuentes actuales (se apartan enteras como copia <code>.bak</code>)</span>
      </label>
      {#if importError !== undefined}
        <Notice kind="error" title={importError.title} lines={importError.lines}>{importError.detail}</Notice>
      {/if}
      {#if plan !== undefined}
        <ul class="cv-plan">
          {#each planLines(plan) as line, index (index)}
            <li>{line}</li>
          {/each}
        </ul>
      {/if}
      <div class="cv-dialog-actions">
        <button class="cv-button" type="button" onclick={() => (importing = undefined)}>Cancelar</button>
        {#if plan === undefined}
          <button class="cv-button primary" type="button" disabled={busy !== undefined} onclick={preview}>Ver plan</button>
        {:else}
          <button class="cv-button danger" type="button" disabled={busy !== undefined} onclick={write}>Escribir en las fuentes</button>
        {/if}
      </div>
    {/if}
  </Dialog>
</section>
