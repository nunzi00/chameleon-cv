<script lang="ts">
  import { onDestroy, onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient, JobKind } from '../lib/api/client';
  import { EMPTY_COPILOT_FORM, buildJobRequest, type CopilotForm } from '../lib/copilot/form';
  import { KIND_LABELS, STATUS_LABELS, applyJobEvent, describeResult, describeSending, isFinished, upsertJob, type JobSnapshot } from '../lib/copilot/jobs';
  import { launchProblem, type LaunchProblem } from '../lib/copilot/consent';
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
  let status = $state<StatusView | undefined>(undefined);
  let specialties = $state<readonly string[]>([]);
  let achievements = $state<readonly AchievementOption[]>([]);
  let jobs = $state<readonly JobSnapshot[]>([]);
  let sending = $state<string | undefined>(undefined);
  let error = $state<ExplainedError | undefined>(undefined);
  let problem = $state<LaunchProblem | undefined>(undefined);
  let busy = $state(false);
  const subscriptions = new Map<string, AbortController>();
  const KINDS: readonly JobKind[] = ['improve', 'summarize', 'suggest-tags'];

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

<section aria-labelledby="cv-copiloto-title">
  <h2 id="cv-copiloto-title">Co-piloto</h2>
  {#if status !== undefined}
    <p><span class={`cv-badge ${status.llm.tone}`}>{status.llm.label}</span>{#if status.llm.detail !== undefined} <span class="cv-muted">{status.llm.detail}</span>{/if}</p>
  {/if}
  {#if error !== undefined}<Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>{/if}
  {#if problem?.kind === 'remote-disabled'}
    <Notice kind="warn" title="Los proveedores remotos están desactivados">{problem.message}</Notice>
  {/if}
  <form class="cv-card cv-form" onsubmit={(event) => { event.preventDefault(); void launch(); }}>
    <label class="cv-field">
      <span>Tarea</span>
      <select name="kind" bind:value={form.kind}>
        {#each KINDS as kind (kind)}<option value={kind}>{KIND_LABELS[kind]}</option>{/each}
      </select>
    </label>
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
      {#if form.offerMode === 'text'}
        <label class="cv-field wide"><span>Texto de la oferta</span><textarea name="offerText" bind:value={form.offerText}></textarea></label>
      {:else if form.offerMode === 'file'}
        <label class="cv-field"><span>Fichero (relativo al espacio de trabajo)</span><input name="offerFile" bind:value={form.offerFile} placeholder="ofertas/acme.txt" /></label>
      {/if}
      <label class="cv-field"><span>Top N logros</span><input name="topN" inputmode="numeric" bind:value={form.topN} placeholder="todos" /></label>
    {/if}
    {#if form.kind === 'improve'}
      <label class="cv-field wide">
        <span>Solo estos logros (ids; vacío = los de la selección){achievements.length === 0 ? '' : ` · ${achievements.length} en el perfil`}</span>
        <input name="only" bind:value={form.only} list="cv-achievement-ids" placeholder="exp-acme-1, ach-2" />
        <datalist id="cv-achievement-ids">{#each achievements as option (option.id)}<option value={option.id}>{option.where}: {option.text}</option>{/each}</datalist>
      </label>
      <label class="cv-field"><span>Propuestas por logro (1–3)</span><input name="proposals" inputmode="numeric" bind:value={form.proposals} placeholder="2" /></label>
      <label class="cv-field"><span>Longitud máxima (40–1000)</span><input name="maxLength" inputmode="numeric" bind:value={form.maxLength} placeholder="220" /></label>
      <label class="cv-field"><span>Logros por ejecución (1–500)</span><input name="maxItems" inputmode="numeric" bind:value={form.maxItems} placeholder="20" /></label>
    {:else if form.kind === 'summarize'}
      <label class="cv-field"><span>Párrafos (1–3)</span><input name="paragraphs" inputmode="numeric" bind:value={form.paragraphs} placeholder="2" /></label>
      <label class="cv-field"><span>Propuestas (1–3)</span><input name="proposals" inputmode="numeric" bind:value={form.proposals} placeholder="2" /></label>
      <label class="cv-field"><span>Longitud máxima (100–5000)</span><input name="maxLength" inputmode="numeric" bind:value={form.maxLength} placeholder="900" /></label>
    {:else}
      <label class="cv-field wide"><span>Texto suelto a etiquetar (vacío = logros del perfil)</span><textarea name="text" bind:value={form.text}></textarea></label>
      <label class="cv-field"><span>Solo estos logros (ids)</span><input name="only" bind:value={form.only} list="cv-achievement-ids" /></label>
      <datalist id="cv-achievement-ids">{#each achievements as option (option.id)}<option value={option.id}>{option.where}: {option.text}</option>{/each}</datalist>
      <label class="cv-check"><input name="untagged" type="checkbox" bind:checked={form.untagged} /> Solo los logros sin etiquetas</label>
      <label class="cv-field"><span>Etiquetas por logro (1–20)</span><input name="maxTags" inputmode="numeric" bind:value={form.maxTags} placeholder="5" /></label>
      <label class="cv-field"><span>Logros por ejecución (1–500)</span><input name="maxItems" inputmode="numeric" bind:value={form.maxItems} placeholder="20" /></label>
    {/if}
    {#if form.kind !== 'suggest-tags'}
      <label class="cv-field"><span>Nombre de la revisión</span><input name="output" bind:value={form.output} placeholder="revision-<tarea>-<fecha>.md" /></label>
    {/if}
    <label class="cv-field"><span>Idioma (locale)</span><input name="locale" bind:value={form.locale} placeholder="el del perfil" /></label>
    <label class="cv-field"><span>Proveedor</span><input name="provider" bind:value={form.provider} placeholder="el configurado (local)" /></label>
    <label class="cv-field"><span>Modelo</span><input name="model" bind:value={form.model} placeholder="el configurado" /></label>
    <label class="cv-check"><input name="redactCompanies" type="checkbox" bind:checked={form.redactCompanies} /> Sin nombres de empresas</label>
    <label class="cv-check"><input name="cache" type="checkbox" bind:checked={form.cache} /> Usar la caché de respuestas</label>
    <div class="cv-actions wide">
      <button class="cv-button primary" type="submit" disabled={busy}>Lanzar</button>
      <span class="cv-muted">Antes de enviar nada, el servidor comprueba el proveedor; un remoto exige confirmar el coste.</span>
    </div>
  </form>

  {#if sending !== undefined}<Notice kind="info" title="Qué sale y a dónde">{sending}</Notice>{/if}

  <div class="cv-card">
    <h3>Trabajos</h3>
    {#if jobs.length === 0}
      <p class="cv-muted">Todavía no hay trabajos en esta sesión.</p>
    {:else}
      <ul class="cv-jobs">
        {#each jobs as job (job.id)}
          {@const result = describeResult(job.kind, job.result)}
          <li class="cv-job">
            <div class="cv-actions">
              <strong>{KIND_LABELS[job.kind]}</strong>
              <span class={`cv-badge ${job.status === 'done' ? 'ok' : job.status === 'failed' ? 'error' : job.status === 'cancelled' ? 'warn' : ''}`} aria-live="polite">{STATUS_LABELS[job.status]}</span>
              <span class="cv-muted">{job.id.slice(0, 8)}</span>
              {#if !isFinished(job.status)}<button class="cv-button" type="button" onclick={() => cancel(job.id)}>Cancelar</button>{/if}
            </div>
            {#if job.lines.length > 0}<pre class="cv-text cv-progress">{job.lines.join('\n')}</pre>{/if}
            {#if job.error !== undefined}
              <Notice kind="error" title={`Fallo (${job.error.code})`} lines={job.error.lines ?? []}>{job.error.message}</Notice>
            {/if}
            {#if result !== undefined}
              <p>{result.summary}</p>
              {#if result.review !== undefined}
                <button class="cv-button" type="button" onclick={() => navigate({ page: 'revisiones', item: result.review?.name })}>Abrir la revisión</button>
              {/if}
              {#if result.lines.length > 0}<pre class="cv-text">{result.lines.join('\n')}</pre>{/if}
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </div>

  <Dialog open={problem?.kind === 'consent-required'} title="Proveedor remoto: confirma el coste">
    {#if problem?.kind === 'consent-required'}
      <p>{problem.warning === '' ? problem.message : problem.warning}</p>
      {#if problem.estimate.length > 0}<ul>{#each problem.estimate as line, index (index)}<li>{line}</li>{/each}</ul>{/if}
      <div class="cv-actions">
        <button class="cv-button primary" type="button" onclick={() => launch(problem?.kind === 'consent-required' ? problem.estimateId : undefined)}>Confirmar coste y enviar</button>
        <button class="cv-button" type="button" onclick={() => (problem = undefined)}>Cancelar</button>
      </div>
    {/if}
  </Dialog>
</section>
