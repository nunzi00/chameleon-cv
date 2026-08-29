<script lang="ts">
  import { onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { ApplyResponse, ReviewResponse, ReviewsResponse } from '../lib/api/types';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { plural } from '../lib/format';
  import { countMarks, toggleMark } from '../lib/reviews/marks';
  import type { Route } from '../lib/router';

  type ReviewFile = ReviewResponse['review'];
  type ReviewSummary = ReviewsResponse['reviews'][number];

  interface Props {
    api: ApiClient;
    /** Revisión abierta (de la ruta). */
    item: string | undefined;
    onsession: () => void;
    navigate: (route: Route) => void;
  }
  let { api, item, onsession, navigate }: Props = $props();

  let list = $state<readonly ReviewSummary[]>([]);
  let file = $state<ReviewFile | undefined>(undefined);
  let text = $state('');
  let sha = $state('');
  let marks = $state<Record<string, boolean>>({});
  let error = $state<ExplainedError | undefined>(undefined);
  let written = $state<readonly string[]>([]);
  let message = $state<string | undefined>(undefined);
  let plan = $state<ApplyResponse | undefined>(undefined);
  let applied = $state<ApplyResponse | undefined>(undefined);
  let busy = $state(false);
  let confirmWrite = $state(false);
  let confirmDelete = $state(false);
  const dirty = $derived(file !== undefined && text !== file.text);
  const TASKS: Readonly<Record<string, string>> = { improve: 'mejorar logros', summarize: 'resumen profesional' };

  function key(itemId: string, number: number): string {
    return `${itemId}#${number}`;
  }

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    written = Array.isArray((caught as { details?: { written?: unknown } }).details?.written) ? ((caught as { details: { written: { path: string; backup: string }[] } }).details.written).map((entry) => `${entry.path} (copia: ${entry.backup})`) : [];
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function loadList(): Promise<void> {
    try {
      list = (await api.reviews()).reviews;
    } catch (caught) {
      fail(caught);
    }
  }

  async function open(name: string): Promise<void> {
    error = undefined;
    message = undefined;
    plan = undefined;
    applied = undefined;
    try {
      const loaded = (await api.review(name)).review;
      file = loaded;
      text = loaded.text;
      sha = loaded.sha256;
      const initial: Record<string, boolean> = {};
      for (const entry of loaded.review?.items ?? []) {
        for (const proposal of entry.proposals) {
          initial[key(entry.id, proposal.number)] = proposal.checked;
        }
      }
      marks = initial;
    } catch (caught) {
      file = undefined;
      fail(caught);
    }
  }

  function toggle(itemId: string, number: number, checked: boolean): void {
    const change = toggleMark(text, itemId, number, checked);
    text = change.text;
    marks = { ...marks, [key(itemId, number)]: checked };
    plan = undefined;
  }

  async function save(): Promise<void> {
    if (file === undefined) {
      return;
    }
    busy = true;
    error = undefined;
    try {
      const result = await api.writeReview(file.name, text, sha);
      sha = result.sha256;
      file = { ...file, text, sha256: result.sha256 };
      message = `Marcas guardadas (${plural(countMarks(text), 'propuesta marcada', 'propuestas marcadas')}).`;
      await loadList();
    } catch (caught) {
      fail(caught);
    } finally {
      busy = false;
    }
  }

  async function preview(): Promise<void> {
    if (file === undefined) {
      return;
    }
    busy = true;
    error = undefined;
    applied = undefined;
    try {
      plan = await api.applyReview(file.name, {});
    } catch (caught) {
      plan = undefined;
      fail(caught);
    } finally {
      busy = false;
    }
  }

  async function write(): Promise<void> {
    confirmWrite = false;
    if (file === undefined) {
      return;
    }
    busy = true;
    error = undefined;
    try {
      applied = await api.applyReview(file.name, { dryRun: false });
      plan = undefined;
      message = `${plural(applied.changes, 'cambio aplicado', 'cambios aplicados')} en ${plural(applied.written.length, 'fichero', 'ficheros')}: recompila el artefacto en Estado.`;
    } catch (caught) {
      fail(caught);
    } finally {
      busy = false;
    }
  }

  async function remove(): Promise<void> {
    confirmDelete = false;
    if (file === undefined) {
      return;
    }
    try {
      await api.deleteReview(file.name);
      file = undefined;
      await loadList();
      navigate({ page: 'revisiones' });
    } catch (caught) {
      fail(caught);
    }
  }

  onMount(() => {
    void loadList();
  });

  $effect(() => {
    if (item !== undefined) {
      void open(item);
    } else {
      file = undefined;
    }
  });
</script>

<section aria-labelledby="cv-revisiones-title">
  <h2 id="cv-revisiones-title">Revisiones</h2>
  {#if error !== undefined}
    <Notice kind="error" title={error.title} lines={[...error.lines, ...written]}>{error.detail}</Notice>
  {/if}
  {#if message !== undefined}<Notice kind="ok">{message}</Notice>{/if}
  <div class="cv-split">
    <aside class="cv-card cv-tree" aria-label="Revisiones del co-piloto">
      {#if list.length === 0}
        <p class="cv-muted">No hay revisiones en <code>output/</code>: lánzalas desde Co-piloto.</p>
      {:else}
        <ul>
          {#each list as entry (entry.name)}
            <li>
              <button type="button" aria-current={item === entry.name ? 'true' : undefined} onclick={() => navigate({ page: 'revisiones', item: entry.name })}>
                {entry.name}
                <span class="cv-muted">{entry.error !== undefined ? '(no interpretable)' : `· ${TASKS[entry.task ?? ''] ?? entry.task} · ${plural(entry.items, 'ítem', 'ítems')} · ${entry.marked} marcadas`}</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="cv-actions"><button class="cv-button" type="button" onclick={loadList}>Actualizar</button></div>
    </aside>
    <div class="cv-card">
      {#if file === undefined}
        <p class="cv-muted">Elige una revisión. Marca la propuesta que quieras de cada ítem, guarda las marcas y aplícalas: primero verás el plan; escribir en las fuentes exige confirmación y deja copias <code>.bak</code>.</p>
      {:else}
        <div class="cv-actions">
          <strong><code>{file.name}</code></strong>
          <span class="cv-muted">{dirty ? 'marcas sin guardar' : `${plural(countMarks(text), 'propuesta marcada', 'propuestas marcadas')}`}</span>
          <button class="cv-button primary" type="button" disabled={!dirty || busy} onclick={save}>Guardar marcas</button>
          <button class="cv-button" type="button" disabled={dirty || busy} onclick={preview}>Plan de aplicación</button>
          <button class="cv-button danger" type="button" disabled={busy} onclick={() => (confirmDelete = true)}>Eliminar</button>
        </div>
        {#if dirty}<p class="cv-muted">Guarda las marcas antes de aplicar.</p>{/if}
        {#if file.review === undefined}
          <Notice kind="warn" title="Revisión no interpretable">{file.error ?? ''}</Notice>
          <pre class="cv-text">{file.text}</pre>
        {:else}
          <p class="cv-muted">
            {TASKS[file.review.task] ?? file.review.task}{file.review.specialty === undefined ? '' : ` · especialidad ${file.review.specialty}`}{file.review.offer === undefined ? '' : ` · oferta ${file.review.offer}`}{file.review.dataDir === undefined ? '' : ` · fuentes en ${file.review.dataDir}`}
          </p>
          {#each file.review.items as entry (entry.id)}
            <article class="cv-review-item">
              <h3><code>{entry.id}</code> <span class="cv-muted">· {entry.location}</span></h3>
              {#if entry.error !== undefined}<Notice kind="error" title="Sin propuestas">{entry.error}</Notice>{/if}
              <div class="cv-compare">
                <div class="cv-before">
                  <h4>Antes</h4>
                  <p>{entry.original}</p>
                  {#if entry.impact !== undefined}<p class="cv-muted">Impacto: {entry.impact}</p>{/if}
                  <p class="cv-muted">{entry.source === undefined ? 'Sin fuente registrada: no se puede aplicar, cópialo a mano.' : `Fuente: ${entry.source.file}:${entry.source.line}`}</p>
                </div>
                <div class="cv-after">
                  <h4>Después</h4>
                  {#each entry.proposals as proposal (proposal.number)}
                    <div class="cv-proposal">
                      {#if proposal.accepted}
                        <label class="cv-check">
                          <input type="checkbox" checked={marks[key(entry.id, proposal.number)] === true} onchange={(event) => toggle(entry.id, proposal.number, (event.currentTarget as HTMLInputElement).checked)} />
                          <span>Propuesta {proposal.number}: {proposal.text}</span>
                        </label>
                      {:else}
                        <p><del>Propuesta {proposal.number}: {proposal.text}</del> <span class="cv-badge error">rechazada (C2)</span></p>
                      {/if}
                    </div>
                  {/each}
                </div>
              </div>
            </article>
          {/each}
        {/if}
        {#if plan !== undefined}
          <div class="cv-card">
            <h3>Plan de aplicación</h3>
            {#if plan.plan.length === 0}
              <p class="cv-muted">Nada que aplicar.</p>
            {:else}
              <ul>
                {#each plan.plan as target (target.path)}
                  <li><code>{target.path}</code>: {target.edits.map((edit) => `${edit.id} → ${edit.text.replace(/\n+/g, ' ')}`).join(' · ')}</li>
                {/each}
              </ul>
              <div class="cv-actions"><button class="cv-button danger" type="button" disabled={busy} onclick={() => (confirmWrite = true)}>Escribir en las fuentes</button></div>
            {/if}
          </div>
        {/if}
        {#if applied !== undefined}
          <div class="cv-card">
            <h3>Aplicado</h3>
            <ul>
              {#each applied.written as entry (entry.path)}
                <li><code>{entry.path}</code> (copia de seguridad: <code>{entry.backup}</code>): {entry.ids.join(', ')}</li>
              {/each}
            </ul>
          </div>
        {/if}
      {/if}
    </div>
  </div>
  <Dialog open={confirmWrite} title="¿Escribir en las fuentes?">
    <p>Se aplicarán solo las propuestas marcadas, con una copia <code>.bak</code> de cada fichero. Si un original ya no está tal cual en la fuente, no se escribe nada.</p>
    <div class="cv-actions">
      <button class="cv-button danger" type="button" onclick={write}>Escribir</button>
      <button class="cv-button" type="button" onclick={() => (confirmWrite = false)}>Cancelar</button>
    </div>
  </Dialog>
  <Dialog open={confirmDelete} title="¿Eliminar la revisión?">
    <p>Se borra el fichero de <code>output/</code>; las fuentes no cambian.</p>
    <div class="cv-actions">
      <button class="cv-button danger" type="button" onclick={remove}>Eliminar</button>
      <button class="cv-button" type="button" onclick={() => (confirmDelete = false)}>Cancelar</button>
    </div>
  </Dialog>
</section>
