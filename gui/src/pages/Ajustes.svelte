<script lang="ts">
  import { onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { LlmConfigResponse, RuntimeState } from '../lib/api/types';
  import { isFinished } from '../lib/copilot/jobs';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { LOCAL_PROVIDERS, RUNNER_CHOICES, SOURCE_LABELS, buildSettings, describeCheck, describeProvider, describeRuntime, formFromConfig, lockedFields, type LocalForm, describeModelOptions } from '../lib/settings';

  interface Props {
    api: ApiClient;
    onsession: () => void;
  }
  let { api, onsession }: Props = $props();

  let config = $state<LlmConfigResponse | undefined>(undefined);
  let form = $state<LocalForm>({ provider: 'ollama', baseUrl: '', model: '', runtimeRunner: '', runtimeImage: '' });
  let error = $state<ExplainedError | undefined>(undefined);
  let message = $state<string | undefined>(undefined);
  let busy = $state<string | undefined>(undefined);
  let checks = $state<Record<string, string>>({});
  // Runtime de Ollama (T-8.8): estado, líneas del último arranque y diálogos de consentimiento y de parada.
  let runtime = $state<RuntimeState | undefined>(undefined);
  let runtimeMessage = $state<string | undefined>(undefined);
  let runtimeLines = $state<readonly string[]>([]);
  let consentPull = $state(false);
  let confirmStop = $state(false);
  const runtimeView = $derived(runtime === undefined ? undefined : describeRuntime(runtime));
  const RUNTIME_POLL_MS = 1000;
  const locked = $derived(config === undefined ? { provider: false, baseUrl: false, model: false } : lockedFields(config));

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function load(): Promise<void> {
    try {
      config = await api.llmConfig();
      form = formFromConfig(config);
    } catch (caught) {
      fail(caught);
    }
  }

  async function save(): Promise<void> {
    if (config === undefined) {
      return;
    }
    // Lo que no está en el formulario ([llm.models]) se conserva tal como se leyó.
    const built = buildSettings(form, config.llm.settings.values?.models);
    if (!built.ok) {
      error = { kind: 'other', title: 'Ajustes no válidos', detail: built.message, lines: [] };
      return;
    }
    busy = 'Guardando…';
    error = undefined;
    message = undefined;
    try {
      const written = await api.writeLlmConfig(built.value, config.file.sha256 ?? '*');
      message = `Guardado en ${written.path}: la tabla [llm] de cv.toml; el resto del fichero no cambia.`;
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      busy = undefined;
    }
  }

  async function check(provider: string | undefined, model: string | undefined): Promise<void> {
    const key = provider ?? 'local';
    busy = `Comprobando ${key}…`;
    error = undefined;
    try {
      const result = await api.checkLlm({ ...(provider === undefined ? {} : { provider }), ...(model === undefined || model.trim() === '' ? {} : { model: model.trim() }) });
      checks = { ...checks, [key]: describeCheck(result) };
      if (result.quota !== undefined) {
        await load();
      }
    } catch (caught) {
      fail(caught);
    } finally {
      busy = undefined;
    }
  }

  async function loadRuntime(): Promise<void> {
    try {
      runtime = (await api.llmRuntime()).runtime;
      runtimeMessage = undefined;
    } catch (caught) {
      const explained = explainError(caught);
      if (explained.kind === 'session') {
        onsession();
      }
      runtime = undefined;
      runtimeMessage = `Runtime no disponible: ${explained.detail === '' ? explained.title : explained.detail}`;
    }
  }

  function startOllama(): void {
    if (runtimeView?.needsPull === true) {
      consentPull = true;
    } else {
      void runtimeUp();
    }
  }

  async function follow(id: string): Promise<void> {
    for (;;) {
      const { job } = await api.job(id);
      runtimeLines = job.lines;
      if (isFinished(job.status)) {
        if (job.error !== undefined) {
          error = { kind: 'other', title: 'Ollama no quedó listo', detail: job.error.message, lines: job.error.lines ?? [] };
        }
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, RUNTIME_POLL_MS));
    }
  }

  async function runtimeUp(): Promise<void> {
    consentPull = false;
    busy = 'Arrancando Ollama…';
    error = undefined;
    runtimeLines = [];
    try {
      const created = await api.llmRuntimeAction({ action: 'up' });
      if ('job' in created) {
        await follow(created.job.id);
      }
    } catch (caught) {
      fail(caught);
    } finally {
      busy = undefined;
      await loadRuntime();
    }
  }

  async function runtimeDown(): Promise<void> {
    confirmStop = false;
    busy = 'Parando Ollama…';
    error = undefined;
    try {
      const result = await api.llmRuntimeAction({ action: 'down' });
      runtimeLines = 'lines' in result ? result.lines : [];
    } catch (caught) {
      fail(caught);
    } finally {
      busy = undefined;
      await loadRuntime();
    }
  }

  onMount(() => {
    void load();
    void loadRuntime();
  });
</script>

<section aria-labelledby="cv-ajustes-title">
  <h2 id="cv-ajustes-title">Ajustes</h2>
  {#if error !== undefined}
    <Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>
  {/if}
  {#if message !== undefined}<Notice kind="ok">{message}</Notice>{/if}
  {#if config !== undefined}
    <div class="cv-card">
      <h3>Co-piloto local</h3>
      <p class="cv-muted">
        Se guarda en <code>{config.file.path}</code> ({config.llm.settings.error !== undefined ? 'inválido: corrígelo a mano' : config.llm.settings.configured ? 'con tabla [llm]' : config.file.present ? 'sin tabla [llm]' : 'no existe todavía'}). Solo proveedores locales: los remotos se eligen en cada trabajo.
      </p>
      {#if config.llm.configError !== undefined}
        <Notice kind="warn" title="Configuración inválida">{config.llm.configError}</Notice>
      {/if}
      <div class="cv-form">
        <label class="cv-field">
          <span>Proveedor{locked.provider ? ' (fijado por el entorno)' : ''}</span>
          <select name="provider" bind:value={form.provider} disabled={locked.provider}>
            {#each LOCAL_PROVIDERS as option (option.id)}
              <option value={option.id}>{option.label}</option>
            {/each}
          </select>
        </label>
        <label class="cv-field">
          <span>URL base{locked.baseUrl ? ' (fijada por el entorno)' : ''}</span>
          <input name="baseUrl" bind:value={form.baseUrl} placeholder="la del proveedor (loopback)" disabled={locked.baseUrl} />
        </label>
        <label class="cv-field">
          <span>Modelo{locked.model ? ' (fijado por el entorno)' : ''}</span>
          <input name="model" bind:value={form.model} placeholder="el del proveedor" disabled={locked.model} />
        </label>
        <label class="cv-field">
          <span>Runner de Ollama ([llm.runtime])</span>
          <select name="runtimeRunner" bind:value={form.runtimeRunner}>
            {#each RUNNER_CHOICES as choice (choice.id)}<option value={choice.id}>{choice.label}</option>{/each}
          </select>
        </label>
        <label class="cv-field">
          <span>Imagen Docker de Ollama</span>
          <input name="runtimeImage" class="mono" bind:value={form.runtimeImage} placeholder="la fijada por digest en el producto" />
        </label>
      </div>
      {#if config.llm.config !== undefined}
        <p class="cv-muted">
          Efectivo: {config.llm.config.provider} ({SOURCE_LABELS[config.llm.config.sources.provider]}) · {config.llm.config.baseUrl} ({SOURCE_LABELS[config.llm.config.sources.baseUrl]}) · modelo {config.llm.config.model} ({SOURCE_LABELS[config.llm.config.sources.model]})
        </p>
      {/if}
      <div class="cv-actions">
        <button class="cv-button primary" type="button" disabled={busy !== undefined} onclick={save}>Guardar en cv.toml</button>
        <button class="cv-button" type="button" disabled={busy !== undefined} onclick={() => check(form.provider, form.model)}>Comprobar</button>
        {#if busy !== undefined}<span class="cv-muted" aria-live="polite">{busy}</span>{/if}
      </div>
      {#if checks['local'] !== undefined || checks[form.provider] !== undefined}<p>{checks[form.provider] ?? checks['local']}</p>{/if}
      <div class="cv-panel" aria-labelledby="cv-runtime-title">
        <div class="cv-card-head">
          <span class="cv-eyebrow" id="cv-runtime-title">Ollama local</span>
          {#if runtimeView !== undefined}<span class="cv-badge {runtimeView.tone}">{runtimeView.badge}</span>{/if}
        </div>
        {#if runtimeMessage !== undefined}
          <p class="cv-muted">{runtimeMessage}</p>
        {:else if runtime !== undefined && runtimeView !== undefined}
          <p>{runtimeView.detail}</p>
          <div class="cv-actions">
            <button class="cv-button primary" type="button" disabled={busy !== undefined || !runtimeView.canStart} title={runtimeView.startHint} onclick={startOllama}>{runtimeView.startLabel}</button>
            <button class="cv-button danger-quiet" type="button" disabled={busy !== undefined || !runtimeView.canStop} onclick={() => (confirmStop = true)}>Parar Ollama</button>
          </div>
          {#if runtimeLines.length > 0}<pre class="cv-text cv-progress">{runtimeLines.join('\n')}</pre>{/if}
          <p class="cv-muted">Solo se para lo que arrancó cv; un Ollama arrancado por ti no se toca. Registro: <code>{runtime.log}</code></p>
        {:else}
          <p class="cv-muted">Consultando el runtime…</p>
        {/if}
      </div>
    </div>
    <Dialog open={consentPull} title="Descargar el modelo" onclose={() => (consentPull = false)}>
      <p>
        Ollama descargará <strong>«{runtime?.model.name}»</strong> del registro público de Ollama: varios GB y varios minutos. No sale ningún dato tuyo; solo entra el modelo.
      </p>
      <div class="cv-dialog-actions">
        <button class="cv-button" type="button" onclick={() => (consentPull = false)}>Cancelar</button>
        <button class="cv-button primary" type="button" onclick={runtimeUp}>Descargar y arrancar</button>
      </div>
    </Dialog>
    <Dialog open={confirmStop} title="¿Parar Ollama?" onclose={() => (confirmStop = false)}>
      <p>Se para el Ollama que arrancó cv. En Docker el contenedor y sus modelos se conservan; el co-piloto dejará de responder hasta que lo arranques de nuevo.</p>
      <div class="cv-dialog-actions">
        <button class="cv-button" type="button" onclick={() => (confirmStop = false)}>Cancelar</button>
        <button class="cv-button danger" type="button" onclick={runtimeDown}>Parar</button>
      </div>
    </Dialog>
    <div class="cv-card">
      <h3>Proveedores externos</h3>
      <p class="cv-muted">
        Solo con clave y eligiéndolos en cada trabajo. Las claves se guardan desde la terminal (<code>cv llm key set &lt;proveedor&gt;</code>) en <code>{config.llm.keysFile}</code>; nunca pasan por esta página.
        {config.remote.allowed ? 'Este servidor admite remotos (--allow-remote).' : 'Este servidor no envía nada a remotos: arráncalo con «cv serve --allow-remote» para permitirlo.'}
      </p>
      <ul class="cv-providers">
        {#each config.llm.providers as provider (provider.id)}
          {@const view = describeProvider(provider)}
          <li class="cv-provider">
            <strong>{provider.id}</strong> <span class="cv-muted">· {view.plan} · {provider.host} · modelo por defecto <code>{provider.defaultModel}</code></span>
            {#if provider.availability !== 'available'}<div class="cv-warning">Pendiente de verificación humana: {provider.availabilityNote}</div>{/if}
            {#if describeModelOptions(provider.models) !== undefined}<div class="cv-muted">Modelos (<code>--model</code> o <code>[llm.models]</code>): {describeModelOptions(provider.models)}</div>{/if}
            <div>{view.key}</div>
            {#if view.quota !== undefined}<div class="cv-muted">Cuota publicada: {view.quota}</div>{/if}
            {#if view.live !== undefined}<div>Cuota viva: {view.live}</div>{/if}
            <div class="cv-muted">Sin entrenamiento con tus datos según <a href={provider.c7.sourceUrl} target="_blank" rel="noreferrer">{provider.c7.sourceUrl}</a> ({provider.c7.verifiedAt}); límites en <a href={provider.rateLimitsUrl} target="_blank" rel="noreferrer">{provider.rateLimitsUrl}</a>.</div>
            <div class="cv-actions">
              <button class="cv-button" type="button" disabled={busy !== undefined || !view.hasKey || !config.remote.allowed || provider.availability !== 'available'} title={!view.hasKey ? 'Sin clave' : !config.remote.allowed ? 'El servidor no admite remotos' : 'Una llamada de salud, sin datos tuyos'} onclick={() => check(provider.id, undefined)}>Comprobar {provider.id}</button>
              {#if checks[provider.id] !== undefined}<span>{checks[provider.id]}</span>{/if}
            </div>
          </li>
        {/each}
      </ul>
    </div>
  {/if}
</section>
