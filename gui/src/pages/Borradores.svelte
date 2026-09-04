<script lang="ts">
  /**
   * «Borradores» (T-9.19): lo que `cv import-cv` dejó en `import/` deja de ser un callejón sin salida. Aquí se
   * ven todos, se corrigen sus ficheros con las mismas garantías que una fuente y se adoptan en `data/sources/`
   * las entradas que se elijan, UNA A UNA.
   *
   * Dos decisiones que se ven en la pantalla:
   * - Los duplicados se **enseñan**, no se resuelven: un grupo es una pregunta, y quien elige eres tú. Ninguna
   *   casilla viene marcada, ni siquiera la del miembro «mejor», porque no hay forma honesta de saber cuál lo es
   *   cuando seis CV se contradicen en las fechas del mismo empleo.
   * - Adoptar **añade**: escribe ficheros nuevos y no toca ni una fuente tuya. Si te equivocas, se borra el
   *   fichero y ya está.
   *
   * Y desde T-9.33, el otro camino: **quedarse con el borrador entero**. Adoptar entrada a entrada no puede
   * traer el nombre, el titular, el contacto ni las habilidades —no son entradas sueltas, viven en `profile.md`
   * y en `skills.csv`—, así que quien estrena su espacio importando su CV se quedaba con el perfil de ejemplo
   * y su propio nombre fuera. Sustituir sí es destructivo, así que se enseña el plan antes y las fuentes
   * anteriores se apartan enteras como copia.
   */
  import { onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Editor from '../components/Editor.svelte';
  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { DraftFilesResponse, DraftsResponse } from '../lib/api/types';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { formatBytes, plural } from '../lib/format';
  import type { Route } from '../lib/router';

  interface Props {
    api: ApiClient;
    /** Borrador abierto (de la ruta). */
    item: string | undefined;
    onsession: () => void;
    navigate: (route: Route) => void;
    plainEditor?: boolean;
  }
  let { api, item, onsession, navigate, plainEditor = false }: Props = $props();

  type Draft = DraftsResponse['drafts'][number];
  type Entry = Draft['entries'][number];
  type DraftFile = DraftFilesResponse['entries'][number];

  const SECTION_LABEL: Readonly<Record<string, string>> = { experience: 'Experiencia', education: 'Formación', projects: 'Proyectos' };

  let drafts = $state<readonly Draft[]>([]);
  let duplicates = $state<DraftsResponse['duplicates']>({ groups: [], compared: 0 });
  let tab = $state<'borradores' | 'duplicados'>('borradores');
  let loading = $state(true);
  let error = $state<ExplainedError | undefined>(undefined);
  let message = $state<string | undefined>(undefined);
  let adopting = $state(false);

  /* ── quedarse con el borrador entero (T-9.33) ── */
  let replacing = $state(false);
  /** El plan de la sustitución, ya calculado: enseñarlo ANTES es lo que convierte el aviso en una decisión. */
  let replacePlan = $state<{ readonly draft: string; readonly files: number; readonly summary: string; readonly root: string } | undefined>(undefined);

  /** Lo señalado para adoptar, compartido por las dos pestañas: `borrador|sección|id`. */
  let picked = $state<ReadonlySet<string>>(new Set());

  /* ── edición de un fichero del borrador ── */
  let files = $state<readonly DraftFile[]>([]);
  let openFile = $state<string | undefined>(undefined);
  let content = $state('');
  let saved = $state('');
  let sha = $state<string | undefined>(undefined);
  let saving = $state(false);
  let editorKey = $state(0);

  const current = $derived(drafts.find((draft) => draft.name === item));
  const dirty = $derived(sha !== undefined && content !== saved);
  const pickedCount = $derived(picked.size);

  function keyOf(draft: string, section: string, id: string): string {
    return `${draft}|${section}|${id}`;
  }

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function load(): Promise<void> {
    loading = true;
    try {
      const response = await api.drafts();
      drafts = response.drafts;
      duplicates = response.duplicates;
      error = undefined;
    } catch (caught) {
      fail(caught);
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    void load();
  });

  // Al cambiar de borrador se cierra el fichero abierto y se pide su árbol.
  $effect(() => {
    const name = item;
    openFile = undefined;
    sha = undefined;
    content = '';
    if (name === undefined) {
      files = [];
      return;
    }
    void (async () => {
      try {
        files = (await api.draftFiles(name)).entries;
      } catch {
        // Un borrador que no carga ya lo dice su ficha; aquí basta con no ofrecer ficheros.
        files = [];
      }
    })();
  });

  function toggle(draft: string, section: string, id: string): void {
    const next = new Set(picked);
    const key = keyOf(draft, section, id);
    if (next.has(key)) {
      next.delete(key);
    } else {
      next.add(key);
    }
    picked = next;
  }

  /** Marca (o desmarca) todas las entradas de una sección del borrador abierto. */
  function toggleSection(draft: string, entries: readonly Entry[], on: boolean): void {
    const next = new Set(picked);
    for (const entry of entries) {
      const key = keyOf(draft, entry.section, entry.id);
      if (on) {
        next.add(key);
      } else {
        next.delete(key);
      }
    }
    picked = next;
  }

  function sectionsOf(draft: Draft): ReadonlyArray<readonly [string, readonly Entry[]]> {
    return (['experience', 'education', 'projects'] as const).map((section) => [section, draft.entries.filter((entry) => entry.section === section)] as const).filter(([, entries]) => entries.length > 0);
  }

  /** Qué escribiría, sin escribir: el diálogo enseña el recuento y la ruta antes de preguntar. */
  async function planReplace(draft: string): Promise<void> {
    replacing = true;
    message = undefined;
    error = undefined;
    try {
      const plan = await api.replaceSourcesWithDraft({ draft, dryRun: true });
      const counts = plan.plan.counts;
      const parts = [
        [counts.experience, 'experiencias'],
        [counts.projects, 'proyectos'],
        [counts.education, 'formaciones'],
        [counts.skills, 'habilidades'],
        [counts.certifications, 'certificaciones'],
      ] as const;
      replacePlan = { draft, files: plan.plan.files.length, summary: parts.filter(([value]) => value > 0).map(([value, label]) => `${String(value)} ${label}`).join(', '), root: plan.root };
    } catch (caught) {
      fail(caught);
    } finally {
      replacing = false;
    }
  }

  async function confirmReplace(): Promise<void> {
    const plan = replacePlan;
    if (plan === undefined) {
      return;
    }
    replacing = true;
    try {
      const result = await api.replaceSourcesWithDraft({ draft: plan.draft });
      replacePlan = undefined;
      message = `Tus fuentes son ahora import/${plan.draft}: ${plural(result.written.length, 'fichero escrito', 'ficheros escritos')} en ${result.root}.${result.backup === undefined ? '' : ` Las anteriores están enteras en ${result.backup}.`} Compila el artefacto en «Estado».`;
      await load();
    } catch (caught) {
      replacePlan = undefined;
      fail(caught);
    } finally {
      replacing = false;
    }
  }

  async function adopt(): Promise<void> {
    if (pickedCount === 0) {
      return;
    }
    adopting = true;
    error = undefined;
    message = undefined;
    try {
      const entries = [...picked].map((key) => {
        const [draft, section, ...rest] = key.split('|');
        return { draft: draft ?? '', section: (section ?? 'experience') as 'experience' | 'education' | 'projects', id: rest.join('|') };
      });
      const outcome = await api.adoptDraftEntries({ entries });
      picked = new Set();
      const skipped = outcome.skipped.length === 0 ? '' : ` ${plural(outcome.skipped.length, 'entrada quedó fuera', 'entradas quedaron fuera')}: ${outcome.skipped.map((entry) => `${entry.id} (${entry.reason})`).join('; ')}.`;
      message = `${plural(outcome.adopted.length, 'entrada adoptada', 'entradas adoptadas')} en tus fuentes: ${outcome.adopted.map((entry) => entry.path).join(', ')}. Revísalas en «Fuentes» y recompila el artefacto.${skipped}`;
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      adopting = false;
    }
  }

  async function open(path: string): Promise<void> {
    if (item === undefined) {
      return;
    }
    error = undefined;
    try {
      const file = await api.draftFile(item, path);
      openFile = path;
      content = file.content;
      saved = file.content;
      sha = file.sha256;
      editorKey += 1;
    } catch (caught) {
      fail(caught);
    }
  }

  async function save(): Promise<void> {
    if (item === undefined || openFile === undefined || sha === undefined) {
      return;
    }
    saving = true;
    error = undefined;
    message = undefined;
    try {
      const written = await api.writeDraftFile(item, openFile, content, sha);
      sha = written.sha256;
      saved = content;
      message = `Guardado ${openFile} en import/${item}. Corregir el borrador no toca tus fuentes.`;
      // Las cuentas y los duplicados dependen de lo que acaba de cambiar.
      await load();
    } catch (caught) {
      fail(caught);
    } finally {
      saving = false;
    }
  }

  function period(entry: Entry): string {
    return entry.start === undefined ? 'sin fechas' : `${entry.start} → ${entry.end ?? 'en curso'}`;
  }
</script>

<section class="cv-stack">
  <div class="cv-card-head">
    <h1>Borradores</h1>
    <div class="cv-tabs" role="tablist">
      <button type="button" role="tab" aria-selected={tab === 'borradores'} onclick={() => (tab = 'borradores')}>Borradores</button>
      <button type="button" role="tab" aria-selected={tab === 'duplicados'} onclick={() => (tab = 'duplicados')}>
        Duplicados{duplicates.groups.length === 0 ? '' : ` (${duplicates.groups.length})`}
      </button>
    </div>
  </div>

  {#if error !== undefined}
    <Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>
  {/if}
  {#if message !== undefined}<Notice kind="ok">{message}</Notice>{/if}

  {#if loading}
    <p class="cv-loading" aria-live="polite">Cargando…</p>
  {:else if drafts.length === 0}
    <div class="cv-empty">
      <div class="cv-empty-inner">
        <div class="cv-empty-icon"><Icon name="layers" size={26} /></div>
        <h1>Todavía no hay borradores</h1>
        <p>
          Un borrador es lo que sale de importar un CV maquetado: las mismas fuentes que <code>data/sources/</code>, pero en <code>import/&lt;nombre&gt;/</code> y sin tocar tu perfil. Impórtalo en «Importar CV» y
          vuelve aquí a revisarlo.
        </p>
        <div class="cv-actions"><button class="cv-button primary" type="button" onclick={() => navigate({ page: 'importar' })}>Ir a «Importar CV»</button></div>
      </div>
    </div>
  {:else if tab === 'borradores'}
    <div class="cv-table cv-table-drafts">
      <div class="cv-table-head"><span>Borrador</span><span>Origen</span><span>Exp.</span><span>Form.</span><span>Proy.</span><span>Avisos</span><span>Sin situar</span></div>
      {#each drafts as draft (draft.name)}
        <button class="cv-table-row" type="button" aria-current={item === draft.name ? 'true' : undefined} onclick={() => navigate({ page: 'borradores', item: draft.name })}>
          <span class="cv-mono">{draft.name}</span>
          <span class="cv-muted">{draft.report.origin ?? '—'}</span>
          {#if draft.problem === undefined}
            <span>{draft.counts.experience}</span>
            <span>{draft.counts.education}</span>
            <span>{draft.counts.projects}</span>
            <span class={draft.report.issues > 0 ? 'cv-warned' : 'cv-muted'}>{draft.report.issues}</span>
            <span class={draft.report.unparsed > 0 ? 'cv-warned' : 'cv-muted'}>{draft.report.unparsed}</span>
          {:else}
            <span class="cv-warned" style="grid-column: span 5">no carga</span>
          {/if}
        </button>
      {/each}
    </div>

    {#if current !== undefined}
      {#if current.problem !== undefined}
        <Notice kind="error" title={`import/${current.name} no carga`}>
          {current.problem} Corrige sus ficheros aquí abajo y vuelve a mirarlo; mientras no cargue no se puede adoptar nada de él.
        </Notice>
      {/if}
      <div class="cv-card">
        <div class="cv-card-head">
          <h2>{current.name}</h2>
          <span class="cv-path">import/{current.name}</span>
        </div>
        <p class="cv-muted">
          {current.report.issues} avisos y {current.report.unparsed} líneas sin situar; están en su <code>README.md</code>, que puedes abrir abajo. Marca lo que quieras llevarte a tus fuentes: se escribirá
          como ficheros nuevos, sin tocar nada de lo que ya tienes.
        </p>

        {#if current.problem === undefined}
          <!-- El otro camino (T-9.33): este borrador ES mi perfil. Adoptar entrada a entrada no puede traer el
               nombre, el titular, el contacto ni las habilidades, que no son entradas sueltas. -->
          <div class="cv-draft-whole">
            <div>
              <strong>¿Este CV es el tuyo?</strong>
              <p class="cv-muted">
                Quédate con el borrador <strong>entero</strong>: también tu nombre, tu titular, tu contacto y tus habilidades, que marcando entradas no se pueden traer. Tus fuentes de ahora se apartan
                enteras como copia y no se borra nada.
              </p>
            </div>
            <button class="cv-button" type="button" onclick={() => void planReplace(current.name)} disabled={replacing}>Usar este borrador como mis fuentes</button>
          </div>
        {/if}

        {#each sectionsOf(current) as [section, entries] (section)}
          {@const allPicked = entries.every((entry) => picked.has(keyOf(current.name, entry.section, entry.id)))}
          <div class="cv-draft-section">
            <div class="cv-card-head">
              <h3>{SECTION_LABEL[section]} <span class="cv-muted">· {entries.length}</span></h3>
              <button class="cv-link-button" type="button" onclick={() => toggleSection(current.name, entries, !allPicked)}>{allPicked ? 'Ninguna' : 'Todas'}</button>
            </div>
            <ul class="cv-pick-list">
              {#each entries as entry (entry.id)}
                <li>
                  <label>
                    <input type="checkbox" checked={picked.has(keyOf(current.name, entry.section, entry.id))} onchange={() => toggle(current.name, entry.section, entry.id)} />
                    <span class="cv-pick-title">{entry.title}</span>
                    <span class="cv-muted">{period(entry)}</span>
                  </label>
                </li>
              {/each}
            </ul>
          </div>
        {/each}

        <details class="cv-collapse">
          <summary><strong>Ficheros del borrador</strong><span class="cv-muted">· {plural(files.length, 'fichero', 'ficheros')}, editables como una fuente</span></summary>
          {#if files.length === 0}
            <p class="cv-muted">Sin ficheros que el cargador reconozca.</p>
          {:else}
            <ul class="cv-draft-files">
              {#each files as file (file.path)}
                <li>
                  <button class="cv-link-button" type="button" onclick={() => open(file.path)}>{file.path}</button>
                  <span class="cv-muted">{formatBytes(file.bytes)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </details>

        {#if openFile !== undefined && sha !== undefined}
          <div class="cv-editor-bar">
            <span class="cv-editor-path">import/{current.name}/{openFile}</span>
            <div class="cv-actions">
              <button class="cv-button" type="button" onclick={() => (openFile = undefined)}>Cerrar</button>
              <button class="cv-button primary" type="button" disabled={!dirty || saving} onclick={() => void save()}>{saving ? 'Guardando…' : 'Guardar'}</button>
            </div>
          </div>
          {#key editorKey}
            <Editor value={content} path={openFile} onchange={(value) => (content = value)} plain={plainEditor} />
          {/key}
        {/if}
      </div>
    {/if}
  {:else if duplicates.groups.length === 0}
    <div class="cv-card">
      <h2>Ninguna entrada se parece a otra</h2>
      <p class="cv-muted">Se han comparado {duplicates.compared} entradas de tus borradores y de tus fuentes de hoy.</p>
    </div>
  {:else}
    <p class="cv-muted">
      {plural(duplicates.groups.length, 'grupo', 'grupos')} sobre {duplicates.compared} entradas comparadas. Un grupo es una <strong>pregunta</strong>, no una fusión: los CV se contradicen en fechas y en
      cómo escriben la empresa, así que eliges tú cuál entra. Lo que ya está en tus fuentes se enseña para que no lo dupliques.
    </p>
    {#each duplicates.groups as group, index (index)}
      <div class="cv-card">
        <div class="cv-card-head">
          <h2>{SECTION_LABEL[group.section]} <span class="cv-muted">· {group.members.length} entradas</span></h2>
          {#if group.inSources}<span class="cv-chip warn">Ya tienes una en tus fuentes</span>{/if}
        </div>
        <ul class="cv-pick-list">
          {#each group.members as member, position (position)}
            <li>
              {#if member.draft === undefined}
                <label class="cv-in-sources">
                  <input type="checkbox" disabled checked={false} />
                  <span class="cv-pick-title">{member.entry.title}</span>
                  <span class="cv-muted">{period(member.entry)}</span>
                  <span class="cv-chip quiet">en tus fuentes</span>
                </label>
              {:else}
                {@const draft = member.draft}
                <label>
                  <input type="checkbox" checked={picked.has(keyOf(draft, member.entry.section, member.entry.id))} onchange={() => toggle(draft, member.entry.section, member.entry.id)} />
                  <span class="cv-pick-title">{member.entry.title}</span>
                  <span class="cv-muted">{period(member.entry)}</span>
                  <span class="cv-chip quiet">{draft}</span>
                </label>
              {/if}
            </li>
          {/each}
        </ul>
      </div>
    {/each}
  {/if}

  {#if pickedCount > 0}
    <div class="cv-adopt-bar">
      <span>{plural(pickedCount, 'entrada señalada', 'entradas señaladas')}</span>
      <div class="cv-actions">
        <button class="cv-button" type="button" onclick={() => (picked = new Set())}>Quitar la selección</button>
        <button class="cv-button primary" type="button" disabled={adopting} onclick={() => void adopt()}>{adopting ? 'Adoptando…' : `Adoptar ${pickedCount} en mis fuentes`}</button>
      </div>
    </div>
  {/if}
</section>

<Dialog open={replacePlan !== undefined} title="¿Este borrador pasa a ser tu perfil?" onclose={() => (replacePlan = undefined)}>
  {#if replacePlan !== undefined}
    <p>
      <strong>import/{replacePlan.draft}</strong> sustituirá tus fuentes: {plural(replacePlan.files, 'fichero', 'ficheros')} en <code>{replacePlan.root}</code>{replacePlan.summary === '' ? '' : ` (${replacePlan.summary})`}.
    </p>
    <p class="cv-muted">Tus fuentes de ahora <strong>no se borran</strong>: se apartan enteras como <code>data/sources.&lt;marca&gt;.bak</code>, y volver es renombrarlas.</p>
  {/if}
  <div class="cv-dialog-actions">
    <button class="cv-button" type="button" onclick={() => (replacePlan = undefined)}>Cancelar</button>
    <button class="cv-button primary" type="button" disabled={replacing} onclick={() => void confirmReplace()}>{replacing ? 'Sustituyendo…' : 'Sustituir mis fuentes'}</button>
  </div>
</Dialog>

<style>
  /* «Este CV es el mío»: el otro camino, al lado del de marcar entradas y sin competir con él. */
  .cv-draft-whole {
    display: flex;
    gap: 16px;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    margin-top: 12px;
    padding: 12px 14px;
    border: 1px solid var(--cv-border);
    border-radius: var(--cv-radius-md);
    background: var(--cv-surface-2);
  }
  .cv-draft-whole p {
    margin: 4px 0 0;
    max-width: 62ch;
  }
  .cv-table-drafts .cv-table-head,
  .cv-table-drafts :global(.cv-table-row) {
    grid-template-columns: minmax(10rem, 1.4fr) minmax(8rem, 1.6fr) 4rem 4rem 4rem 5rem 6rem;
  }
  .cv-draft-section {
    margin-top: 14px;
  }
  .cv-draft-section h3 {
    margin: 0;
    font-size: 13.5px;
    font-weight: 600;
  }
  .cv-pick-list {
    margin: 6px 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 2px;
  }
  .cv-pick-list label {
    display: flex;
    align-items: baseline;
    gap: 10px;
    padding: 5px 8px;
    border-radius: var(--cv-radius-sm);
    cursor: pointer;
  }
  .cv-pick-list label:hover {
    background: var(--cv-surface-2);
  }
  .cv-pick-list label.cv-in-sources {
    cursor: default;
    opacity: 0.75;
  }
  .cv-pick-title {
    flex: 1;
    min-width: 0;
  }
  .cv-draft-files {
    margin: 8px 0 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 4px;
    font: var(--cv-size-sm) var(--cv-mono);
  }
  .cv-draft-files li {
    display: flex;
    gap: 10px;
    justify-content: space-between;
  }
  .cv-warned {
    color: var(--cv-warn);
    font-weight: 500;
  }
  .cv-adopt-bar {
    position: sticky;
    bottom: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 10px 14px;
    border: 1px solid var(--cv-accent);
    border-radius: var(--cv-radius-md);
    background: var(--cv-surface);
    box-shadow: var(--cv-shadow);
  }
</style>
