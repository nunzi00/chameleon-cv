<script lang="ts">
  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { ImportCvResponse, ImportMapJobResult, LlmConfigResponse } from '../lib/api/types';
  import { ApiError } from '../lib/api/client';
  import { launchProblem, type LaunchProblem } from '../lib/copilot/consent';
  import { applyJobEvent, isFinished, type JobSnapshot } from '../lib/copilot/jobs';
  import { remoteProviderOptions } from '../lib/copilot/providers';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { plural } from '../lib/format';

  interface Props {
    api: ApiClient;
    onsession: () => void;
  }
  let { api, onsession }: Props = $props();

  let file = $state<File | undefined>(undefined);
  let name = $state('');
  let busy = $state(false);
  let error = $state<ExplainedError | undefined>(undefined);
  let conflict = $state(false);
  let result = $state<ImportCvResponse | undefined>(undefined);

  // Refinado con el co-piloto (T-8.18): trabajo aparte que solo PROPONE; el borrador no se toca.
  let config = $state<LlmConfigResponse | undefined>(undefined);
  let provider = $state('');
  let job = $state<JobSnapshot | undefined>(undefined);
  let refined = $state<ImportMapJobResult | undefined>(undefined);
  let problem = $state<LaunchProblem | undefined>(undefined);
  const remotes = $derived(remoteProviderOptions(config));
  const refining = $derived(job !== undefined && !isFinished(job.status));

  function pick(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    file = input.files?.[0];
    result = undefined;
    error = undefined;
    conflict = false;
  }

  async function importCv(replace: boolean): Promise<void> {
    if (file === undefined || busy) {
      return;
    }
    busy = true;
    error = undefined;
    conflict = false;
    try {
      result = await api.importCv(file, { ...(name.trim() === '' ? {} : { name: name.trim() }), ...(replace ? { replace: true } : {}) });
    } catch (caught) {
      if (caught instanceof ApiError && caught.code === 'conflict') {
        conflict = true;
        error = { kind: 'conflict', title: 'Ya existe un borrador con ese nombre', detail: caught.message, lines: [] };
      } else {
        const explained = explainError(caught);
        error = explained;
        if (explained.kind === 'session') {
          onsession();
        }
      }
    } finally {
      busy = false;
    }
  }

  /** El catálogo de proveedores se pide una sola vez, y solo cuando hay un borrador que refinar. */
  async function loadProviders(): Promise<void> {
    if (config !== undefined) {
      return;
    }
    try {
      config = await api.llmConfig();
    } catch {
      config = undefined; // sin catálogo se refina con el proveedor local configurado
    }
  }

  async function refine(estimateId?: string): Promise<void> {
    if (result === undefined || refining) {
      return;
    }
    problem = undefined;
    error = undefined;
    refined = undefined;
    const body = { name: result.name, ...(provider === '' ? {} : { provider }), ...(estimateId === undefined ? {} : { consent: { estimateId } }) };
    try {
      const created = await api.startJob({ kind: 'import-map', body });
      job = created.job;
      for await (const event of api.jobEvents(created.job.id)) {
        job = applyJobEvent(job, event);
        if (isFinished(job.status)) {
          break;
        }
      }
      if (job.status === 'done') {
        refined = job.result as ImportMapJobResult;
        result = { ...result, readme: refined.report };
      } else if (job.error !== undefined) {
        error = { kind: 'other', title: 'El refinado no terminó', detail: job.error.message, lines: [] };
      }
    } catch (caught) {
      const rejected = launchProblem(caught);
      if (rejected !== undefined) {
        problem = rejected;
        job = undefined;
        return;
      }
      const explained = explainError(caught);
      error = explained;
      job = undefined;
      if (explained.kind === 'session') {
        onsession();
      }
    }
  }

  const counts = $derived(
    result === undefined
      ? []
      : [
          [result.counts.experience, 'experiencia', 'experiencias'],
          [result.counts.projects, 'proyecto', 'proyectos'],
          [result.counts.education, 'formación', 'formaciones'],
          [result.counts.certifications, 'certificación', 'certificaciones'],
          [result.counts.skills, 'habilidad', 'habilidades'],
          [result.counts.achievements, 'logro', 'logros'],
          [result.counts.languages, 'idioma', 'idiomas'],
        ] as const,
  );
</script>

<section class="cv-card" aria-labelledby="importar-titulo">
  <header class="cv-card-head">
    <h1 id="importar-titulo"><Icon name="file-up" size={18} /> Importar un CV</h1>
    <p class="cv-muted">
      Convierte un CV ya maquetado (PDF o DOCX) en un <strong>borrador de fuentes</strong> en <code>import/&lt;nombre&gt;/</code>.
      Nunca escribe en <code>data/sources/</code>: revisa el borrador, valídalo con <code>cv build --data import/&lt;nombre&gt;</code> y muévelo cuando esté a tu gusto.
    </p>
  </header>

  <form class="cv-import-form" onsubmit={(event) => { event.preventDefault(); void importCv(false); }}>
    <label class="cv-field">
      <span>Fichero (.pdf o .docx)</span>
      <input type="file" accept=".pdf,.docx,application/pdf" onchange={pick} />
    </label>
    <label class="cv-field">
      <span>Nombre del borrador (opcional)</span>
      <input type="text" placeholder="por defecto, el nombre del CV" bind:value={name} />
    </label>
    <button class="cv-button" type="submit" disabled={file === undefined || busy}>
      {busy ? 'Importando…' : 'Importar como borrador'}
    </button>
  </form>

  {#if error !== undefined}
    <Notice kind="error" title={error.title}>
      <p>{error.detail}</p>
      {#if conflict}
        <button class="cv-button" type="button" onclick={() => void importCv(true)} disabled={busy}>Sustituir el borrador existente</button>
      {/if}
    </Notice>
  {/if}

  {#if result !== undefined}
    <div class="cv-import-result">
      <Notice kind="ok" title="Borrador escrito en import/{result.name}">
        <p>
          {result.files} ficheros ·
          {counts.filter(([count]) => count > 0).map(([count, one, many]) => plural(count, one, many)).join(' · ') || 'sin elementos reconocidos'}
        </p>
        {#if result.issues.length > 0 || result.unparsed.length > 0}
          <p>{plural(result.issues.length, 'aviso', 'avisos')} y {plural(result.unparsed.length, 'línea sin situar', 'líneas sin situar')} — el detalle, en el informe de abajo.</p>
        {/if}
      </Notice>
      {#if result.unparsed.length > 0}
        <div class="cv-panel cv-refine">
          <h2>¿Te ayuda el co-piloto con lo que quedó sin situar?</h2>
          <p class="cv-muted">
            Se envían <strong>solo las {plural(result.unparsed.length, 'línea sin situar', 'líneas sin situar')}</strong>, seudonimizadas y sin datos de contacto, para que el modelo
            <strong>proponga</strong> a qué sección pertenecen. Las propuestas van al informe del borrador: <strong>no se aplica nada</strong>.
          </p>
          <div class="cv-refine-actions">
            <label class="cv-field">
              <span>Proveedor</span>
              <select bind:value={provider} disabled={refining} onfocus={() => void loadProviders()}>
                <option value="">Local (el configurado)</option>
                {#each remotes as option (option.id)}
                  <option value={option.id} disabled={!option.usable}>{option.label}</option>
                {/each}
              </select>
            </label>
            <button class="cv-button" type="button" disabled={refining} onclick={() => void refine()}>
              {refining ? 'Refinando…' : 'Refinar con el co-piloto'}
            </button>
          </div>
          {#if job !== undefined}
            <ul class="cv-refine-log" aria-label="Progreso del refinado" aria-live="polite">
              {#each job.lines as line, index (index)}<li>{line}</li>{/each}
            </ul>
          {/if}
          {#if refined !== undefined}
            <Notice kind={refined.proposals.length > 0 ? 'ok' : 'info'} title={refined.proposals.length > 0 ? `${plural(refined.proposals.length, 'propuesta', 'propuestas')} en el informe (sin aplicar)` : 'El co-piloto no propuso ninguna sección'}>
              {#if refined.proposals.length > 0}
                <ul class="cv-refine-proposals">
                  {#each refined.proposals as proposal (proposal.n)}
                    <li><strong>{proposal.section}</strong> · línea {proposal.n}: {proposal.text}{proposal.reason === '' ? '' : ` (${proposal.reason})`}</li>
                  {/each}
                </ul>
              {/if}
              {#if refined.rejected > 0}<p class="cv-muted">{plural(refined.rejected, 'propuesta rechazada', 'propuestas rechazadas')} por el código (sección desconocida, línea inexistente o repetida).</p>{/if}
              {#if refined.skipped > 0}<p class="cv-muted">{plural(refined.skipped, 'línea', 'líneas')} sin situar fuera del lote: vuelve a refinar cuando hayas movido las de arriba.</p>{/if}
            </Notice>
          {/if}
        </div>
      {/if}
      <h2>Informe del borrador (README.md)</h2>
      <pre class="cv-text" aria-label="Informe del borrador">{result.readme}</pre>
    </div>
  {/if}

  <Dialog open={problem?.kind === 'remote-disabled'} title="Este servidor no admite proveedores remotos" onclose={() => (problem = undefined)}>
    <p>{problem?.message}</p>
    <div class="cv-dialog-actions"><button class="cv-button" type="button" onclick={() => (problem = undefined)}>Entendido</button></div>
  </Dialog>

  <Dialog open={problem?.kind === 'consent-required'} title="Proveedor remoto: confirma el coste" onclose={() => (problem = undefined)}>
    {#if problem?.kind === 'consent-required'}
      <p>{problem.warning === '' ? problem.message : problem.warning}</p>
      {#if problem.dataNote !== ''}<p class="cv-muted">⚠ {problem.dataNote}</p>{/if}
      <dl class="cv-consent">
        <dt>Se envía</dt><dd>{result === undefined ? '' : plural(result.unparsed.length, 'línea sin situar', 'líneas sin situar')}, seudonimizadas</dd>
        <dt>Se escribe</dt><dd class="cv-mono">import/{result?.name}/README.md</dd>
        {#each problem.estimate as line, index (index)}<dt>{index === 0 ? 'Coste estimado' : ''}</dt><dd>{line}</dd>{/each}
      </dl>
      <div class="cv-dialog-actions">
        <button class="cv-button" type="button" onclick={() => (problem = undefined)}>Cancelar</button>
        <button class="cv-button primary" type="button" onclick={() => { const id = problem?.kind === 'consent-required' ? problem.estimateId : undefined; problem = undefined; if (id !== undefined) { void refine(id); } }}>Confirmar y enviar</button>
      </div>
    {/if}
  </Dialog>
</section>

<style>
  .cv-import-form {
    display: grid;
    gap: var(--cv-space-3);
    max-width: 460px;
    margin: var(--cv-space-4) 0;
  }
  .cv-import-result {
    margin-top: var(--cv-space-4);
    display: grid;
    gap: var(--cv-space-3);
  }
  .cv-import-result h2 {
    font-size: var(--cv-size-lg);
    margin: 0;
  }
  .cv-refine {
    display: grid;
    gap: var(--cv-space-2);
  }
  .cv-refine h2 {
    font-size: var(--cv-size-md);
    margin: 0;
  }
  .cv-refine-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--cv-space-3);
    align-items: end;
  }
  .cv-refine-log,
  .cv-refine-proposals {
    margin: 0;
    padding-left: 1.1em;
    display: grid;
    gap: 2px;
  }
  .cv-refine-log {
    color: var(--cv-muted);
    font-size: var(--cv-size-sm);
  }
</style>
