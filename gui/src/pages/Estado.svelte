<script lang="ts">
  import { onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Issues from '../components/Issues.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { plural } from '../lib/format';
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
  let error = $state<ExplainedError | undefined>(undefined);
  let issues = $state<readonly Issue[]>([]);
  let message = $state<string | undefined>(undefined);
  let busy = $state<string | undefined>(undefined);
  let confirmShutdown = $state(false);
  let stopped = $state(false);

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
      view = describeStatus(await api.status());
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
  async function shutdown(): Promise<void> {
    confirmShutdown = false;
    try {
      await api.shutdown();
      stopped = true;
    } catch (caught) {
      fail(caught);
    }
  }

  onMount(() => {
    void load();
  });
</script>

<section aria-labelledby="cv-estado-title">
  <h2 id="cv-estado-title">Estado</h2>
  {#if stopped}
    <Notice kind="warn" title="Servidor detenido">Vuelve a arrancarlo con <code>cv serve</code> y abre la nueva URL con su token.</Notice>
  {:else}
    {#if error !== undefined}
      <Notice kind="error" title={error.title} lines={issues.length > 0 ? [] : error.lines}>{error.detail}</Notice>
    {/if}
    {#if issues.length > 0}
      <Notice kind="error" title={`${plural(issues.length, 'problema', 'problemas')} en las fuentes`}><Issues {issues} {onopen} /></Notice>
    {/if}
    {#if message !== undefined}<Notice kind="ok">{message}</Notice>{/if}
    {#if view !== undefined}
      <div class="cv-card">
        <dl class="cv-kv">
          <dt>Versión</dt>
          <dd>{view.version}</dd>
          <dt>Espacio de trabajo</dt>
          <dd><code>{view.workspace}</code></dd>
        </dl>
      </div>
      <div class="cv-grid">
        <div class="cv-card">
          <h3>Artefacto</h3>
          <p><span class={`cv-badge ${view.artifact.tone}`}>{view.artifact.label}</span></p>
          {#if view.artifact.detail !== undefined}<p class="cv-muted">{view.artifact.detail}</p>{/if}
          <p>{view.specialties.length === 0 ? 'Sin especialidades' : `Especialidades: ${view.specialties.join(', ')}`}</p>
          <div class="cv-actions">
            <button class="cv-button" type="button" disabled={busy !== undefined} onclick={validate}>Validar</button>
            <button class="cv-button primary" type="button" disabled={busy !== undefined} onclick={build}>Compilar</button>
            {#if busy !== undefined}<span class="cv-muted" aria-live="polite">{busy}</span>{/if}
          </div>
        </div>
        <div class="cv-card">
          <h3>Typst</h3>
          <p><span class={`cv-badge ${view.typst.tone}`}>{view.typst.label}</span></p>
        </div>
        <div class="cv-card">
          <h3>Co-piloto de IA</h3>
          <p><span class={`cv-badge ${view.llm.tone}`}>{view.llm.label}</span></p>
          {#if view.llm.detail !== undefined}<p class="cv-muted">{view.llm.detail}</p>{/if}
        </div>
        <div class="cv-card">
          <h3>Temas</h3>
          <p>{plural(view.themes.count, 'tema', 'temas')} · por defecto <code>{view.themes.defaultName}</code></p>
          {#if view.themes.warning !== undefined}<p class="cv-muted">{view.themes.warning}</p>{/if}
        </div>
      </div>
      <div class="cv-card cv-actions">
        <button class="cv-button danger" type="button" onclick={() => (confirmShutdown = true)}>Apagar el servidor</button>
      </div>
    {/if}
    <Dialog open={confirmShutdown} title="¿Apagar cv serve?">
      <p>La interfaz dejará de funcionar hasta que vuelvas a arrancar <code>cv serve</code>.</p>
      <div class="cv-actions">
        <button class="cv-button danger" type="button" onclick={shutdown}>Apagar</button>
        <button class="cv-button" type="button" onclick={() => (confirmShutdown = false)}>Cancelar</button>
      </div>
    </Dialog>
  {/if}
</section>
