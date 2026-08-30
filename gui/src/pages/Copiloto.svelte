<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { remoteProviderOptions, type RemoteOption } from '../lib/copilot/providers';

  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import { EMPTY_COPILOT_FORM, buildJobRequest, type CopilotForm } from '../lib/copilot/form';
  import { KIND_LABELS, STATUS_LABELS, applyJobEvent, describeResult, describeSending, isFinished, upsertJob, type JobSnapshot } from '../lib/copilot/jobs';
  import { launchProblem, type LaunchProblem } from '../lib/copilot/consent';
  import { TASK_OPTIONS, describePlan, jobCounts, jobProgress } from '../lib/copilot/plan';
  import { achievementOptions, type AchievementOption } from '../lib/copilot/profile';
  import { explainError, type ExplainedError } from '../lib/errors';
  import type { Route } from '../lib/router';
  import { describeStatus, type StatusView } from '../lib/status';

  interface Props {
    api: ApiClient;
    onsession: () => void;
    navigate: (route: Route) => void;
  }
  let { api, onsession, navigate }: Props = $props();

  let form = $state<CopilotForm>({ ...EMPTY_COPILOT_FORM });
  let remoteOptions = $state<readonly RemoteOption[]>([]);
  const modelPlaceholder = $derived(remoteOptions.find((option) => option.id === form.provider)?.defaultModel ?? 'el configurado');
  let status = $state<StatusView | undefined>(undefined);
  let specialties = $state<readonly string[]>([]);
  let achievements = $state<readonly AchievementOption[]>([]);
  let jobs = $state<readonly JobSnapshot[]>([]);
  let sending = $state<string | undefined>(undefined);
  let error = $state<ExplainedError | undefined>(undefined);
  let problem = $state<LaunchProblem | undefined>(undefined);
  let busy = $state(false);
  const subscriptions = new Map<string, AbortController>();
  const plan = $derived(describePlan(form, { local: status?.llm.provider === undefined ? undefined : `${status.llm.provider} · ${status.llm.model ?? 'modelo configurado'}`, remote: remoteOptions.find((option) => option.id === form.provider) }));
  const counts = $derived(jobCounts(jobs, new Date()));

  /** Lo que sigue al «id · plan gratuito · …» de la etiqueta del remoto. */
  function remoteDetail(option: RemoteOption): string {
    return option.label.startsWith(`${option.id} · `) ? option.label.slice(option.id.length + 3) : option.label;
  }

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    if (explained.kind === 'session') {
      onsession();
    }
  }

  function current(id: string): JobSnapshot | undefined {
    return jobs.find((job) => job.id === id);
  }

  /** Sigue los eventos del trabajo hasta que termina; dejar de escuchar no lo cancela. */
  async function follow(id: string): Promise<void> {
    if (subscriptions.has(id)) {
      return;
    }
    const controller = new AbortController();
    subscriptions.set(id, controller);
    try {
      for await (const event of api.jobEvents(id, controller.signal)) {
        const job = current(id);
        if (job !== undefined) {
          jobs = upsertJob(jobs, applyJobEvent(job, event));
        }
      }
    } catch (caught) {
      if (!controller.signal.aborted) {
        fail(caught);
      }
    } finally {
      subscriptions.delete(id);
    }
  }

  async function load(): Promise<void> {
    try {
      remoteOptions = remoteProviderOptions(await api.llmConfig());
    } catch {
      remoteOptions = [];
    }
    try {
      const [state, profile, list] = await Promise.all([api.status(), api.profile().catch(() => undefined), api.jobs()]);
      status = describeStatus(state);
      specialties = state.artifact.specialties;
      achievements = profile === undefined ? [] : achievementOptions(profile);
      jobs = list.jobs;
      for (const job of list.jobs) {
        if (!isFinished(job.status)) {
          void follow(job.id);
        }
      }
    } catch (caught) {
      fail(caught);
    }
  }

  async function launch(estimateId?: string): Promise<void> {
    const request = buildJobRequest(form);
    if (!request.ok) {
      error = { kind: 'data', title: 'Falta algo', detail: request.message, lines: [] };
      return;
    }
    busy = true;
    error = undefined;
    problem = undefined;
    try {
      const body = estimateId === undefined ? request.body.body : { ...request.body.body, consent: { estimateId } };
      const created = await api.startJob({ kind: request.body.kind, body } as typeof request.body);
      sending = describeSending(created.sending);
      jobs = upsertJob(jobs, created.job);
      void follow(created.job.id);
    } catch (caught) {
      const known = launchProblem(caught);
      if (known === undefined) {
        fail(caught);
      } else {
        problem = known;
      }
    } finally {
      busy = false;
    }
  }

  async function cancel(id: string): Promise<void> {
    try {
      const response = await api.cancelJob(id);
      jobs = upsertJob(jobs, response.job);
    } catch (caught) {
      fail(caught);
    }
  }

  onMount(() => {
    void load();
  });
  onDestroy(() => {
    for (const controller of subscriptions.values()) {
      controller.abort();
    }
  });
</script>

<section class="cv-split-copiloto" aria-labelledby="cv-copiloto-title">
  <form class="cv-generar-form" onsubmit={(event) => { event.preventDefault(); void launch(); }}>
    <div class="cv-generar-scroll">
      <h1 id="cv-copiloto-title" class="cv-generar-title">Co-piloto</h1>
      {#if status !== undefined}
        <p class="cv-copiloto-status"><span class={`cv-badge ${status.llm.tone}`}>{status.llm.label}</span>{#if status.llm.detail !== undefined} <span class="cv-muted">{status.llm.detail}</span>{/if}</p>
      {/if}
      {#if error !== undefined}<Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>{/if}
      {#if problem?.kind === 'remote-disabled'}
        <Notice kind="warn" title="Los proveedores remotos están desactivados">{problem.message}</Notice>
      {/if}

      <fieldset class="cv-fieldset">
        <legend class="cv-eyebrow">Tarea</legend>
        <div class="cv-options">
          {#each TASK_OPTIONS as task (task.kind)}
            <label class="cv-option" data-selected={form.kind === task.kind ? '' : undefined}>
              <input type="radio" name="kind" value={task.kind} checked={form.kind === task.kind} onchange={() => (form = { ...form, kind: task.kind })} />
              <span class="cv-option-body"><strong>{task.label}</strong><span class="cv-muted">{task.description}</span><code>{task.command}</code></span>
            </label>
          {/each}
        </div>
      </fieldset>

      <div class="cv-step">
        <div class="cv-step-head"><h2>Límites de la ejecución</h2></div>
        <div class="cv-form cv-form-2">
          <label class="cv-field">
            <span>Especialidad</span>
            <select name="specialty" bind:value={form.specialty}>
              <option value="">{form.kind === 'suggest-tags' ? 'Todas las etiquetas' : 'Todo el perfil'}</option>
              {#each specialties as specialty (specialty)}<option value={specialty}>{specialty}</option>{/each}
            </select>
          </label>
          {#if form.kind !== 'suggest-tags'}
            <label class="cv-field">
              <span>Oferta</span>
              <select name="offerMode" bind:value={form.offerMode}>
                <option value="none">Sin oferta</option>
                <option value="text">Texto pegado</option>
                <option value="file">Fichero del espacio de trabajo</option>
              </select>
            </label>
            <label class="cv-field"><span>Top N logros</span><input name="topN" inputmode="numeric" bind:value={form.topN} placeholder="todos" /></label>
          {/if}
          {#if form.kind === 'improve'}
            <label class="cv-field"><span>Propuestas por logro (1–3)</span><input name="proposals" inputmode="numeric" bind:value={form.proposals} placeholder="2" /></label>
            <label class="cv-field"><span>Longitud máxima (40–1000)</span><input name="maxLength" inputmode="numeric" bind:value={form.maxLength} placeholder="220" /></label>
            <label class="cv-field"><span>Logros por ejecución (1–500)</span><input name="maxItems" inputmode="numeric" bind:value={form.maxItems} placeholder="20" /></label>
          {:else if form.kind === 'summarize'}
            <label class="cv-field"><span>Párrafos (1–3)</span><input name="paragraphs" inputmode="numeric" bind:value={form.paragraphs} placeholder="2" /></label>
            <label class="cv-field"><span>Propuestas (1–3)</span><input name="proposals" inputmode="numeric" bind:value={form.proposals} placeholder="2" /></label>
            <label class="cv-field"><span>Longitud máxima (100–5000)</span><input name="maxLength" inputmode="numeric" bind:value={form.maxLength} placeholder="900" /></label>
          {:else}
            <label class="cv-field"><span>Etiquetas por logro (1–20)</span><input name="maxTags" inputmode="numeric" bind:value={form.maxTags} placeholder="5" /></label>
            <label class="cv-field"><span>Logros por ejecución (1–500)</span><input name="maxItems" inputmode="numeric" bind:value={form.maxItems} placeholder="20" /></label>
          {/if}
        </div>
        {#if form.kind !== 'suggest-tags' && form.offerMode === 'text'}
          <label class="cv-field"><span>Texto de la oferta</span><textarea name="offerText" class="mono" bind:value={form.offerText}></textarea></label>
        {:else if form.kind !== 'suggest-tags' && form.offerMode === 'file'}
          <label class="cv-field"><span>Fichero (relativo al espacio de trabajo)</span><input name="offerFile" class="mono" bind:value={form.offerFile} placeholder="offers/acme.txt" /></label>
        {/if}
        {#if form.kind === 'improve'}
          <label class="cv-field">
            <span>Solo estos logros (ids; vacío = los de la selección){achievements.length === 0 ? '' : ` · ${achievements.length} en el perfil`}</span>
            <input name="only" class="mono" bind:value={form.only} list="cv-achievement-ids" placeholder="exp-acme-1, ach-2" />
            <datalist id="cv-achievement-ids">{#each achievements as option (option.id)}<option value={option.id}>{option.where}: {option.text}</option>{/each}</datalist>
          </label>
        {:else if form.kind === 'suggest-tags'}
          <label class="cv-field"><span>Texto suelto a etiquetar (vacío = logros del perfil)</span><textarea name="text" class="mono" bind:value={form.text}></textarea></label>
          <label class="cv-field"><span>Solo estos logros (ids)</span><input name="only" class="mono" bind:value={form.only} list="cv-achievement-ids" /></label>
          <datalist id="cv-achievement-ids">{#each achievements as option (option.id)}<option value={option.id}>{option.where}: {option.text}</option>{/each}</datalist>
          <label class="cv-check"><input name="untagged" type="checkbox" bind:checked={form.untagged} /> Solo los logros sin etiquetas</label>
        {/if}
        <details class="cv-collapse">
          <summary><strong>Más opciones</strong><span class="cv-muted">nombre de la revisión, idioma, modelo</span></summary>
          <div class="cv-form cv-form-2">
            {#if form.kind !== 'suggest-tags'}
              <label class="cv-field"><span>Nombre de la revisión</span><input name="output" bind:value={form.output} placeholder="revision-<tarea>-<fecha>.md" /></label>
            {/if}
            <label class="cv-field"><span>Idioma (locale)</span><input name="locale" bind:value={form.locale} placeholder="el del perfil" /></label>
            <label class="cv-field"><span>Modelo</span><input name="model" bind:value={form.model} placeholder={modelPlaceholder} /></label>
          </div>
        </details>
      </div>

      <fieldset class="cv-fieldset">
        <legend class="cv-eyebrow">Proveedor</legend>
        <div class="cv-options">
          <label class="cv-option" data-selected={form.provider === '' ? '' : undefined}>
            <input type="radio" name="provider" value="" checked={form.provider === ''} onchange={() => (form = { ...form, provider: '' })} />
            <span class="cv-option-body">
              <strong>Local <span class="cv-badge ok">recomendado</span></strong>
              <span class="cv-muted">{status?.llm.provider === undefined ? 'el configurado en cv.toml o el entorno' : `${status.llm.provider} · ${status.llm.model ?? ''} · tu máquina`}</span>
            </span>
          </label>
          {#each remoteOptions as option (option.id)}
            <label class="cv-option" data-selected={form.provider === option.id ? '' : undefined} aria-disabled={!option.usable}>
              <input type="radio" name="provider" value={option.id} disabled={!option.usable} checked={form.provider === option.id} onchange={() => (form = { ...form, provider: option.id })} />
              <span class="cv-option-body">
                <strong>{option.id} {#if option.usable}<span class="cv-badge warn">exige consentimiento</span>{/if}</strong>
                <span class="cv-muted">{remoteDetail(option)}</span>
              </span>
            </label>
          {/each}
        </div>
        <div class="cv-checks">
          <label class="cv-check"><input name="redactCompanies" type="checkbox" bind:checked={form.redactCompanies} /> Sin nombres de empresas</label>
          <label class="cv-check"><input name="cache" type="checkbox" bind:checked={form.cache} /> Usar la caché de respuestas</label>
        </div>
      </fieldset>

      <div class="cv-panel cv-sending-panel">
        <span class="cv-eyebrow">Qué sale y a dónde</span>
        <dl class="cv-kv cv-kv-rows">
          <dt>Destino</dt><dd>{plan.destination}</dd>
          <dt>Se envía</dt><dd>{plan.sends}</dd>
          <dt>Se escribe</dt><dd class="cv-mono">{plan.writes}</dd>
        </dl>
      </div>
    </div>
    <div class="cv-generar-actions">
      <button class="cv-button primary cta" type="submit" disabled={busy}>Lanzar trabajo</button>
      {#if busy}<span class="cv-muted" aria-live="polite">Comprobando el proveedor…</span>{/if}
      <span class="cv-header-spacer"></span>
      <span class="cv-muted">un remoto exige confirmar el coste</span>
    </div>
  </form>

  <div class="cv-generar-result">
    {#if sending !== undefined}<Notice kind="info" title="Qué sale y a dónde">{sending}</Notice>{/if}
    <div class="cv-page-title">
      <h2 class="cv-generar-title">Trabajos</h2>
      <span class="cv-muted">{counts.running} en curso · {counts.today} hoy</span>
    </div>
    {#if jobs.length === 0}
      <div class="cv-empty">
        <div class="cv-empty-inner">
          <div class="cv-empty-icon"><Icon name="robot" size={26} /></div>
          <h1>Todavía no hay trabajos</h1>
          <p>Elige una tarea, comprueba en «Qué sale y a dónde» qué se enviará y pulsa «Lanzar trabajo». El progreso se sigue aquí y la revisión queda en <code>output/</code>.</p>
        </div>
      </div>
    {:else}
      <ul class="cv-jobs">
        {#each jobs as job (job.id)}
          {@const result = describeResult(job.kind, job.result)}
          {@const progress = isFinished(job.status) ? undefined : jobProgress(job.lines)}
          <li class="cv-job" data-running={isFinished(job.status) ? undefined : ''}>
            <div class="cv-job-head">
              {#if !isFinished(job.status)}
                <svg class="cv-spinner" viewBox="0 0 24 24" fill="none" stroke="var(--cv-accent)" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 4a8 8 0 018 8" /><circle cx="12" cy="12" r="8" opacity=".18" /></svg>
              {:else if job.status === 'done'}
                <span class="cv-job-icon ok"><Icon name="check" size={15} weight={2.2} /></span>
              {:else if job.status === 'failed'}
                <span class="cv-job-icon error"><Icon name="alert" size={15} weight={2} /></span>
              {:else}
                <span class="cv-job-icon warn"><Icon name="close" size={15} weight={2} /></span>
              {/if}
              <strong>{KIND_LABELS[job.kind]}</strong>
              <span class={`cv-badge ${job.status === 'done' ? 'ok' : job.status === 'failed' ? 'error' : job.status === 'cancelled' ? 'warn' : ''}`} aria-live="polite">{STATUS_LABELS[job.status]}</span>
              <span class="cv-muted cv-mono">{job.id.slice(0, 8)}</span>
              <span class="cv-header-spacer"></span>
              {#if !isFinished(job.status)}<button class="cv-button small" type="button" onclick={() => cancel(job.id)}>Cancelar</button>{/if}
            </div>
            {#if progress !== undefined}
              <div class="cv-job-progress">
                <div class="cv-meter" role="meter" aria-valuemin="0" aria-valuemax="100" aria-valuenow={progress.percent} aria-label="Progreso"><div style={`width: ${progress.percent}%`}></div></div>
                <span class="cv-muted">Ítem {progress.current} de {progress.total}{progress.label === '' ? '' : ` · ${progress.label}`}</span>
              </div>
            {/if}
            {#if job.lines.length > 0}<pre class="cv-text cv-progress">{job.lines.join('\n')}</pre>{/if}
            {#if job.error !== undefined}
              <Notice kind="error" title={`Fallo (${job.error.code})`} lines={job.error.lines ?? []}>{job.error.message}</Notice>
              <p class="cv-muted">No se ha escrito nada. Si el proveedor es local, comprueba que sigue en marcha (Ajustes → Ollama local).</p>
            {/if}
            {#if result !== undefined}
              <p>{result.summary}</p>
              {#if result.review !== undefined}
                <div class="cv-actions"><button class="cv-button small" type="button" onclick={() => navigate({ page: 'revisiones', item: result.review?.name })}>Abrir la revisión</button><span class="cv-mono cv-muted">{result.review.path}</span></div>
              {/if}
              {#if result.lines.length > 0}<pre class="cv-text">{result.lines.join('\n')}</pre>{/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <Dialog open={problem?.kind === 'consent-required'} title="Proveedor remoto: confirma el coste" onclose={() => (problem = undefined)}>
    {#if problem?.kind === 'consent-required'}
      <p>{problem.warning === '' ? problem.message : problem.warning}</p>
      <dl class="cv-consent">
        <dt>Destino</dt><dd>{plan.destination}</dd>
        <dt>Se envía</dt><dd>{plan.sends}</dd>
        <dt>Se escribe</dt><dd class="cv-mono">{plan.writes}</dd>
        {#each problem.estimate as line, index (index)}<dt>{index === 0 ? 'Coste estimado' : ''}</dt><dd>{line}</dd>{/each}
      </dl>
      <div class="cv-dialog-actions">
        <button class="cv-button" type="button" onclick={() => (problem = undefined)}>Cancelar</button>
        <button class="cv-button primary" type="button" onclick={() => launch(problem?.kind === 'consent-required' ? problem.estimateId : undefined)}>Enviar y lanzar</button>
      </div>
    {/if}
  </Dialog>
</section>
