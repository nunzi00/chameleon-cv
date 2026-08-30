<script lang="ts">
  import { onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { LlmConfigResponse, LocalModelsState, RuntimeState } from '../lib/api/types';
  import { isFinished } from '../lib/copilot/jobs';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { LOCAL_PROVIDERS, OTHER_MODEL, RUNNER_CHOICES, SOURCE_LABELS, buildSettings, describeCheck, describeDownload, describeLocalModel, describeProvider, describeRuntime, formFromConfig, lockedFields, modelChoice, quotaMeter, type LocalForm, describeModelOptions } from '../lib/settings';

  interface Props {
    api: ApiClient;
    onsession: () => void;
  }
  let { api, onsession }: Props = $props();

  let config = $state<LlmConfigResponse | undefined>(undefined);
  let form = $state<LocalForm>({ provider: 'ollama', baseUrl: '', model: '', runtimeRunner: '', runtimeImage: '', think: false });
  // Catálogo de modelos locales (T-8.13): selector con lo descargado; sin catálogo, campo libre.
  let models = $state<LocalModelsState | undefined>(undefined);
  let modelSelect = $state('');
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
      modelSelect = modelChoice(form.model, models?.catalogue ?? []);
    } catch (caught) {
      fail(caught);
    }
  }

  /** El catálogo es opcional: si el servidor no lo sirve (runtime ausente), el campo de modelo sigue siendo libre. */
  async function loadModels(): Promise<void> {
    try {
      models = await api.llmModels();
      modelSelect = modelChoice(form.model, models.catalogue);
    } catch {
      models = undefined;
    }
  }

  function chooseModel(event: Event): void {
    const value = (event.currentTarget as HTMLSelectElement).value;
    modelSelect = value;
    if (value !== OTHER_MODEL) {
      form.model = value;
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
    void loadModels();
  });
</script>

<section class="cv-ajustes" aria-labelledby="cv-ajustes-title">
  <div class="cv-page-title"><h1 id="cv-ajustes-title">Ajustes</h1></div>
  {#if error !== undefined}
    <Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>
  {/if}
  {#if message !== undefined}<Notice kind="ok">{message}</Notice>{/if}
  {#if config !== undefined}
    <div class="cv-card cv-card-tight">
      <div class="cv-card-head"><h2>Co-piloto local</h2></div>
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
        {#if models !== undefined && models.catalogue.length > 0 && form.provider === 'ollama'}
          <label class="cv-field">
            <span>Modelo{locked.model ? ' (fijado por el entorno)' : ''}</span>
            <select name="modelChoice" value={modelSelect} onchange={chooseModel} disabled={locked.model}>
              <option value="">El del proveedor (por defecto)</option>
              {#each models.catalogue as entry (entry.id)}<option value={entry.id}>{describeLocalModel(entry, models.running)}</option>{/each}
              <option value={OTHER_MODEL}>Otro (escribir el nombre)…</option>
            </select>
          </label>
          {#if modelSelect === OTHER_MODEL}
            <label class="cv-field">
              <span>Nombre del modelo en Ollama</span>
              <input name="model" bind:value={form.model} placeholder="familia:etiqueta o hf.co/repositorio:cuantización" disabled={locked.model} />
            </label>
          {/if}
        {:else}
          <label class="cv-field">
            <span>Modelo{locked.model ? ' (fijado por el entorno)' : ''}</span>
            <input name="model" bind:value={form.model} placeholder="el del proveedor" disabled={locked.model} />
          </label>
        {/if}
        <label class="cv-field">
          <span>Razonamiento ([llm] think)</span>
          <span class="cv-check"><input type="checkbox" name="think" bind:checked={form.think} /> Pedir razonamiento a los modelos que lo conmutan (Qwen3, gpt-oss): más lento; apagado por defecto. Las tareas con esquema JSON estricto (todas las del co-piloto) lo ignoran: razonando, la respuesta llega vacía</span>
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
          {#if runtimeView.plan !== ''}<p class="cv-muted" data-testid="runtime-plan">{runtimeView.plan}</p>{/if}
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
      <p>{describeDownload(runtime?.model.name ?? '', models?.catalogue)}</p>
      {#if runtimeView !== undefined && runtimeView.plan !== ''}<p class="cv-muted">{runtimeView.plan}</p>{/if}
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
    <div class="cv-card cv-card-tight">
      <div class="cv-card-head">
        <h2>Proveedores externos</h2>
        <span class={`cv-chip ${config.remote.allowed ? 'warn' : 'quiet'}`}><Icon name="shield" size={13} weight={1.8} />{config.remote.allowed ? 'remotos permitidos (--allow-remote)' : 'sin remotos: nada sale de esta máquina'}</span>
      </div>
      <p class="cv-muted">
        Solo con clave y eligiéndolos <strong>en cada trabajo</strong> (Co-piloto → Trabajos → selector «Proveedor»); en esta página únicamente se comprueban. Las claves se guardan desde la terminal (<code>cv llm key set &lt;proveedor&gt;</code>) en <code>{config.llm.keysFile}</code>; nunca pasan por esta página.
        {config.remote.allowed ? 'Este servidor admite remotos (--allow-remote).' : 'Este servidor no envía nada a remotos: arráncalo con «cv serve --allow-remote» para permitirlo.'}
      </p>
      <div class="cv-providers">
        {#each config.llm.providers as provider (provider.id)}
          {@const view = describeProvider(provider)}
          {@const meter = quotaMeter(provider.live)}
          <article class="cv-panel cv-provider" data-pending={provider.availability !== 'available' ? '' : undefined}>
            <div class="cv-card-head">
              <strong>{provider.id}</strong>
              <span class={`cv-badge ${view.hasKey ? 'ok' : ''}`}>{view.key}</span>
              <span class="cv-muted">· {view.plan} · {provider.host}</span>
            </div>
            {#if provider.availability !== 'available'}<div class="cv-warning">Pendiente de verificación humana: {provider.availabilityNote}</div>{/if}
            <dl class="cv-kv cv-kv-rows">
              <dt>Modelo por defecto</dt><dd><code>{provider.defaultModel}</code></dd>
              {#if describeModelOptions(provider.models) !== undefined}<dt>Modelos</dt><dd class="cv-muted">Modelos (<code>--model</code> o <code>[llm.models]</code>): {describeModelOptions(provider.models)}</dd>{/if}
              {#if view.quota !== undefined}<dt>Cuota</dt><dd class="cv-muted">Cuota publicada: {view.quota}</dd>{/if}
              {#if view.live !== undefined}
                <dt>Cuota viva</dt>
                <dd>
                  {#if meter !== undefined}<div class="cv-meter thin" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={meter.percent} aria-label={`Cuota usada de ${provider.id}`}><div style={`width: ${meter.percent}%`}></div></div>{/if}
                  Cuota viva: {view.live}
                </dd>
              {/if}
            </dl>
            <p class="cv-muted cv-provider-foot">Sin entrenamiento con tus datos según <a href={provider.c7.sourceUrl} target="_blank" rel="noreferrer">{provider.c7.sourceUrl}</a> ({provider.c7.verifiedAt}); límites en <a href={provider.rateLimitsUrl} target="_blank" rel="noreferrer">{provider.rateLimitsUrl}</a>.</p>
            <div class="cv-actions">
              <button class="cv-button small" type="button" disabled={busy !== undefined || !view.hasKey || !config.remote.allowed || provider.availability !== 'available'} title={!view.hasKey ? 'Sin clave' : !config.remote.allowed ? 'El servidor no admite remotos' : provider.availability !== 'available' ? 'Pendiente de verificación humana' : undefined} onclick={() => check(provider.id, undefined)}>Comprobar {provider.id}</button>
              {#if checks[provider.id] !== undefined}<span>{checks[provider.id]}</span>{/if}
            </div>
          </article>
        {/each}
      </div>
    </div>
    <div class="cv-card cv-card-tight">
      <div class="cv-card-head"><h2>Lista blanca de hosts</h2></div>
      <p class="cv-muted">Los únicos hosts a los que el co-piloto puede enviar algo con un proveedor remoto; se amplía con <code>CHAMELEON_LLM_ALLOWED_HOSTS</code>.</p>
      <div class="cv-chips">
        {#each config.llm.allowedHosts as host (host)}<span class="cv-chip plain cv-mono">{host}</span>{/each}
        {#if config.llm.allowedHosts.length === 0}<span class="cv-muted">ninguno</span>{/if}
      </div>
    </div>
  {/if}
</section>
