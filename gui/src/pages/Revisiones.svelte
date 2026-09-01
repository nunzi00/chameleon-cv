<script lang="ts">
  import { onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { ApplyResponse, ReviewResponse, ReviewsResponse } from '../lib/api/types';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { plural } from '../lib/format';
  import { diffSummary, lineDiff } from '../lib/reviews/diff';
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
  let loaded = $state(false);
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
  const markedCount = $derived(countMarks(text));
  const TASKS: Readonly<Record<string, string>> = { improve: 'mejorar logros', summarize: 'resumen profesional' };
  /** El estado de cada ítem frente a las fuentes de AHORA (encargo del PO del 1-sep: saber qué ya se aplicó). */
  const STATES: Readonly<Record<string, { readonly label: string; readonly badge: string }>> = {
    applied: { label: 'ya aplicada', badge: 'ok' },
    pending: { label: 'sin aplicar', badge: '' },
    changed: { label: 'la fuente cambió', badge: 'warn' },
    unknown: { label: 'sin fuente registrada', badge: 'warn' },
  };
  const stateOf = $derived((itemId: string): string | undefined => file?.statuses.find((status) => status.id === itemId)?.state);

  /** Lo que se dice al lado del nombre en la lista: «3 de 5 ya aplicadas» solo cuando hay algo aplicado. */
  function progressOf(entry: { readonly progress?: { readonly applied: number } | undefined; readonly items: number }): string {
    return entry.progress === undefined || entry.progress.applied === 0 ? '' : ` · ${entry.progress.applied} de ${entry.items} ya aplicadas`;
  }

  function key(itemId: string, number: number): string {
    return `${itemId}#${number}`;
  }

  function markedIn(itemId: string, proposals: readonly { readonly number: number }[]): number {
    return proposals.filter((proposal) => marks[key(itemId, proposal.number)] === true).length;
  }

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    written = Array.isArray((caught as { details?: { written?: unknown } }).details?.written)
      ? (caught as { details: { written: { path: string; backup: string }[] } }).details.written.map((entry) => `${entry.path} (copia en ${entry.backup})`)
      : [];
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function loadList(): Promise<void> {
    try {
      list = (await api.reviews()).reviews;
      loaded = true;
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
      const loadedFile = (await api.review(name)).review;
      file = loadedFile;
      text = loadedFile.text;
      sha = loadedFile.sha256;
      const initial: Record<string, boolean> = {};
      for (const entry of loadedFile.review?.items ?? []) {
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

<section class="cv-split-revisiones" aria-labelledby="cv-revisiones-title">
  <aside class="cv-tree-pane" aria-label="Revisiones del co-piloto">
    <div class="cv-tree-head cv-tree-head-title">
      <h1 id="cv-revisiones-title" class="cv-generar-title">Revisiones</h1>
      <span class="cv-muted">En <code>output/</code></span>
    </div>
    <div class="cv-tree cv-tree-scroll">
      {#if loaded && list.length === 0}
        <p class="cv-muted">Ninguna revisión en <code>output/</code>.</p>
      {:else}
        <div class="cv-tree-children">
          {#each list as entry (entry.name)}
            <button class="cv-tree-file cv-review-entry" type="button" aria-current={item === entry.name ? 'true' : undefined} onclick={() => navigate({ page: 'revisiones', item: entry.name })}>
              <span>{entry.name}</span>
              <small class="cv-muted">{entry.error !== undefined ? 'no interpretable' : `${TASKS[entry.task ?? ''] ?? entry.task} · ${plural(entry.items, 'ítem', 'ítems')} · ${entry.marked} marcadas${progressOf(entry)}`}</small>
            </button>
          {/each}
        </div>
      {/if}
    </div>
    <div class="cv-tree-foot"><button class="cv-button small" type="button" onclick={loadList}>Actualizar</button></div>
  </aside>
  <div class="cv-editor-pane cv-review-pane">
    {#if file === undefined}
      {#if loaded && list.length === 0}
        <div class="cv-empty">
          <div class="cv-empty-inner">
            <div class="cv-empty-icon"><Icon name="checklist" size={26} /></div>
            <h1>Ninguna revisión pendiente</h1>
            <p>Las revisiones son ficheros Markdown en <code>output/</code> que escribe el co-piloto: cada logro con su original y sus propuestas. Marca las que quieras y aplícalas a las fuentes con copia de seguridad.</p>
            <div class="cv-actions"><button class="cv-button primary" type="button" onclick={() => navigate({ page: 'copiloto' })}>Lanzar un trabajo del co-piloto</button></div>
          </div>
        </div>
      {:else}
        {#if error !== undefined}<Notice kind="error" title={error.title} lines={[...error.lines, ...written]}>{error.detail}</Notice>{/if}
        <div class="cv-empty">
          <div class="cv-empty-inner">
            <div class="cv-empty-icon"><Icon name="checklist" size={26} /></div>
            <h1>Elige una revisión</h1>
            <p>Marca la propuesta que quieras de cada ítem, guarda las marcas y aplícalas: primero verás el plan con el antes y el después completo de cada fuente; escribir exige confirmación y deja copias <code>.bak</code>.</p>
          </div>
        </div>
      {/if}
    {:else}
      <div class="cv-editor-bar cv-review-bar">
        <span class="cv-editor-path">{file.name}</span>
        {#if file.review !== undefined}
          <span class="cv-muted cv-review-meta">{TASKS[file.review.task] ?? file.review.task}{file.review.specialty === undefined ? '' : ` · especialidad ${file.review.specialty}`}{file.review.offer === undefined ? '' : ` · oferta ${file.review.offer}`}</span>
        {/if}
        <span class="cv-header-spacer"></span>
        <span class={dirty ? 'cv-editor-dirty' : 'cv-muted'}>{dirty ? 'marcas sin guardar' : plural(markedCount, 'propuesta marcada', 'propuestas marcadas')}</span>
        <button class="cv-button small" type="button" disabled={!dirty || busy} onclick={save}>Guardar marcas</button>
        <button class="cv-button primary small" type="button" disabled={dirty || busy} title={dirty ? 'Guarda las marcas antes de aplicar' : undefined} onclick={preview}>Plan de aplicación</button>
        <button class="cv-button danger-quiet small" type="button" disabled={busy} onclick={() => (confirmDelete = true)}>Eliminar</button>
      </div>
      <div class="cv-review-scroll">
        {#if error !== undefined}<Notice kind="error" title={error.title} lines={[...error.lines, ...written]}>{error.detail}</Notice>{/if}
        {#if message !== undefined}<Notice kind="ok">{message}</Notice>{/if}
        {#if dirty}<p class="cv-muted">Guarda las marcas antes de aplicar.</p>{/if}
        {#if file.review === undefined}
          <Notice kind="warn" title="Revisión no interpretable">{file.error ?? ''}</Notice>
          <pre class="cv-text">{file.text}</pre>
        {:else}
          {#each file.review.items as entry (entry.id)}
            <article class="cv-review-item">
              <div class="cv-review-head">
                <code class="cv-review-id">{entry.id}</code>
                <span class="cv-muted">{entry.location}</span>
                <span class="cv-header-spacer"></span>
                {#if stateOf(entry.id) !== undefined}
                  <span class={`cv-badge ${STATES[stateOf(entry.id) ?? '']?.badge ?? ''}`}>{STATES[stateOf(entry.id) ?? '']?.label ?? ''}</span>
                {/if}
                <span class="cv-muted">{markedIn(entry.id, entry.proposals)} de {entry.proposals.length} marcada{entry.proposals.length === 1 ? '' : 's'}</span>
              </div>
              {#if entry.error !== undefined}<Notice kind="error" title="Sin propuestas">{entry.error}</Notice>{/if}
              <div class="cv-compare">
                <div class="cv-before">
                  <h4 class="cv-eyebrow">Antes</h4>
                  <p>{entry.original}</p>
                  {#if entry.impact !== undefined}<p class="cv-muted">Impacto: {entry.impact}</p>{/if}
                  <p class="cv-muted cv-mono">{entry.source === undefined ? 'Sin fuente registrada: no se puede aplicar, cópialo a mano.' : `Fuente: ${entry.source.file}:${entry.source.line}`}</p>
                </div>
                <div class="cv-after">
                  <h4 class="cv-eyebrow">Después</h4>
                  {#each entry.proposals as proposal (proposal.number)}
                    {#if proposal.accepted}
                      <label class="cv-proposal" data-checked={marks[key(entry.id, proposal.number)] === true ? '' : undefined}>
                        <input type="checkbox" checked={marks[key(entry.id, proposal.number)] === true} onchange={(event) => toggle(entry.id, proposal.number, (event.currentTarget as HTMLInputElement).checked)} />
                        <span>Propuesta {proposal.number}: {proposal.text}</span>
                      </label>
                    {:else}
                      <div class="cv-proposal rejected">
                        <Icon name="close" size={15} weight={2} />
                        <span>
                          <del>Propuesta {proposal.number}: {proposal.text}</del> <span class="cv-badge error">rechazada (C2)</span>
                          <span class="cv-muted">no se puede marcar: no supera la verificación contra la fuente</span>
                          <!-- Sin el detalle, «no supera la verificación» no es accionable: quien revisa no puede
                               distinguir una invención del modelo de un dato que le falta a su propia fuente. -->
                          {#if proposal.verification !== undefined}<span class="cv-verification">{proposal.verification}</span>{/if}
                        </span>
                      </div>
                    {/if}
                  {/each}
                </div>
              </div>
            </article>
          {/each}
        {/if}
        {#if plan !== undefined}
          <div class="cv-card cv-card-tight cv-plan-card">
            <div class="cv-card-head">
              <h2>Plan de aplicación</h2>
              {#if plan.plan.length > 0}
                <span class="cv-muted">{plural(plan.plan.reduce((total, target) => total + target.edits.length, 0), 'cambio', 'cambios')} · {plural(plan.plan.length, 'fichero', 'ficheros')} · copia .bak de cada uno</span>
              {/if}
            </div>
            {#if plan.plan.length === 0}
              <p class="cv-muted">Nada que aplicar.</p>
            {:else}
              {#each plan.plan as target (target.path)}
                {@const rows = lineDiff(target.before, target.after)}
                {@const summary = rows === undefined ? undefined : diffSummary(rows)}
                <details class="cv-collapse cv-plan-file" open>
                  <summary>
                    <strong class="cv-mono">{target.path}</strong>
                    <span class="cv-muted">· {plural(target.edits.length, 'edición', 'ediciones')}{summary === undefined ? '' : ` · −${summary.removed} +${summary.added} líneas`}</span>
                  </summary>
                  <ul class="cv-plan-edits">
                    {#each target.edits as edit (edit.id)}
                      <li class="cv-mono">{edit.id} → {edit.text.replace(/\n+/g, ' ')}</li>
                    {/each}
                  </ul>
                  <div class="cv-diff-grid">
                    <div>
                      <h4 class="cv-eyebrow">Antes (fichero completo)</h4>
                      <pre class="cv-diff" aria-label={`Antes: ${target.path}`}>{#if rows === undefined}{target.before}{:else}{#each rows as row, index (index)}{#if row.kind !== 'added'}<span class={`cv-diff-line ${row.kind}`}><span class="cv-diff-no">{row.line}</span>{row.text}</span>{'\n'}{/if}{/each}{/if}</pre>
                    </div>
                    <div>
                      <h4 class="cv-eyebrow">Después (fichero completo)</h4>
                      <pre class="cv-diff" aria-label={`Después: ${target.path}`}>{#if rows === undefined}{target.after}{:else}{#each rows as row, index (index)}{#if row.kind !== 'removed'}<span class={`cv-diff-line ${row.kind}`}><span class="cv-diff-no">{row.line}</span>{row.text}</span>{'\n'}{/if}{/each}{/if}</pre>
                    </div>
                  </div>
                </details>
              {/each}
              <p class="cv-muted">Si un original ya no está tal cual en la fuente, no se escribe nada.</p>
              <div class="cv-actions"><button class="cv-button danger" type="button" disabled={busy} onclick={() => (confirmWrite = true)}>Aplicar y escribir en las fuentes</button></div>
            {/if}
          </div>
        {/if}
        {#if applied !== undefined}
          <div class="cv-card cv-card-tight">
            <h2>Aplicado</h2>
            {#if applied.history !== undefined}<p class="cv-muted">Las versiones anteriores completas quedan en el histórico de fuentes (entrada <code>{applied.history.id}</code>): en Fuentes, «Historial de esta fuente».</p>{/if}
            <ul>
              {#each applied.written as entry (entry.path)}
                <li><code>{entry.path}</code> (copia de seguridad: <code>{entry.backup}</code>): {entry.ids.join(', ')}</li>
              {/each}
            </ul>
          </div>
        {/if}
      </div>
    {/if}
  </div>
  <Dialog open={confirmWrite} title="¿Escribir en las fuentes?" onclose={() => (confirmWrite = false)}>
    <p>Se aplicarán solo las propuestas marcadas, con una copia <code>.bak</code> de cada fichero. Si un original ya no está tal cual en la fuente, no se escribe nada.</p>
    <div class="cv-dialog-actions">
      <button class="cv-button" type="button" onclick={() => (confirmWrite = false)}>Cancelar</button>
      <button class="cv-button danger" type="button" onclick={write}>Escribir</button>
    </div>
  </Dialog>
  <Dialog open={confirmDelete} title="¿Eliminar la revisión?" onclose={() => (confirmDelete = false)}>
    <p>Se borra el fichero de <code>output/</code>; las fuentes no cambian.</p>
    <div class="cv-dialog-actions">
      <button class="cv-button" type="button" onclick={() => (confirmDelete = false)}>Cancelar</button>
      <button class="cv-button danger" type="button" onclick={remove}>Eliminar</button>
    </div>
  </Dialog>
</section>
