<script lang="ts">
  import { onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Editor from '../components/Editor.svelte';
  import { languageFor } from '../components/codemirror-language';
  import Icon from '../components/Icon.svelte';
  import Issues from '../components/Issues.svelte';
  import Notice from '../components/Notice.svelte';
  import Tree from '../components/Tree.svelte';
  import type { ApiClient } from '../lib/api/client';
  import type { SourceDeleteResponse, SourceHistoryEntry } from '../lib/api/types';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { formatBytes, plural } from '../lib/format';
  import { diffSummary, lineDiff } from '../lib/reviews/diff';
  import type { Route } from '../lib/router';
  import { buildTree, countFiles, filterTree, issueCounts, lineEnding, shortSha, type TreeNode } from '../lib/sources/tree';
  import { issuesOf, type Issue } from '../lib/validation';

  interface Props {
    api: ApiClient;
    /** Fichero abierto (de la ruta). */
    item: string | undefined;
    onsession: () => void;
    navigate: (route: Route) => void;
    plainEditor?: boolean;
  }
  let { api, item, onsession, navigate, plainEditor = false }: Props = $props();

  const LANGUAGE_LABELS = { markdown: 'Markdown', yaml: 'YAML', plain: 'Texto' } as const;
  let tree = $state<readonly TreeNode[]>([]);
  let root = $state('');
  let query = $state('');
  let content = $state('');
  let saved = $state('');
  let sha = $state<string | undefined>(undefined);
  let bytes = $state(0);
  let cursor = $state({ line: 1, column: 1 });
  let error = $state<ExplainedError | undefined>(undefined);
  /** Incidencias de la última validación (al cargar y tras guardar): badges del árbol y lista. */
  let issues = $state<readonly Issue[]>([]);
  let message = $state<string | undefined>(undefined);
  let saving = $state(false);
  let conflict = $state<{ readonly diskSha: string | undefined } | undefined>(undefined);
  let creating = $state(false);
  let newPath = $state('');
  let editorKey = $state(0);
  /** Histórico de versiones de la fuente abierta (T-8.10). */
  let history = $state<readonly SourceHistoryEntry[]>([]);
  let comparing = $state<{ readonly entry: SourceHistoryEntry; readonly content: string } | undefined>(undefined);
  let restoring = $state<SourceHistoryEntry | undefined>(undefined);
  /** El plan de borrado (qué entradas del perfil desaparecen); abre el diálogo de confirmación (T-9.25). */
  let deleting = $state<SourceDeleteResponse | undefined>(undefined);
  const dirty = $derived(sha !== undefined && content !== saved);
  const visible = $derived(filterTree(tree, query));
  const counts = $derived(issueCounts(issues));
  const total = $derived(countFiles(tree));
  const withIssues = $derived(counts.size);

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    if (explained.kind === 'session') {
      onsession();
    }
  }

  /** Validación de solo lectura: alimenta los badges; un fallo que no sea de datos se ignora aquí (lo dirá Estado). */
  async function refreshIssues(): Promise<void> {
    try {
      await api.validate();
      issues = [];
    } catch (caught) {
      issues = issuesOf(caught);
    }
  }

  async function loadTree(): Promise<void> {
    try {
      const list = await api.sources();
      root = list.root;
      tree = buildTree(list.entries);
      await refreshIssues();
    } catch (caught) {
      fail(caught);
    }
  }

  async function loadHistory(path: string): Promise<void> {
    try {
      history = (await api.sourceHistory()).entries.filter((entry) => entry.files.some((file) => file.path === path));
    } catch {
      history = [];
    }
    comparing = undefined;
  }

  async function compare(entry: SourceHistoryEntry): Promise<void> {
    if (item === undefined) {
      return;
    }
    error = undefined;
    try {
      const version = await api.sourceVersion({ entry: entry.id, path: item });
      comparing = { entry, content: version.content };
    } catch (caught) {
      fail(caught);
    }
  }

  async function restore(): Promise<void> {
    const entry = restoring;
    restoring = undefined;
    if (item === undefined || entry === undefined) {
      return;
    }
    error = undefined;
    try {
      const restored = await api.restoreSourceVersion({ entry: entry.id, path: item });
      await open(item);
      await loadTree();
      message = `Restaurada la versión de ${entry.at} sobre ${item}; la que había queda en el histórico (${restored.entry.id}).`;
    } catch (caught) {
      fail(caught);
    }
  }

  async function open(path: string): Promise<void> {
    error = undefined;
    message = undefined;
    try {
      const file = await api.source(path);
      content = file.content;
      saved = file.content;
      sha = file.sha256;
      bytes = new TextEncoder().encode(file.content).byteLength;
      cursor = { line: 1, column: 1 };
      editorKey += 1;
      await loadHistory(path);
    } catch (caught) {
      sha = undefined;
      fail(caught);
    }
  }

  async function validateAfterSave(): Promise<void> {
    try {
      const result = await api.validate();
      issues = [];
      message = `Guardado. Fuentes válidas (${plural(result.files.length, 'fichero', 'ficheros')}); recompila el artefacto en Estado.`;
    } catch (caught) {
      const found = issuesOf(caught);
      if (found.length === 0) {
        fail(caught);
        return;
      }
      issues = found;
      message = 'Guardado, pero las fuentes tienen problemas.';
    }
  }

  async function save(): Promise<void> {
    if (item === undefined || sha === undefined) {
      return;
    }
    saving = true;
    error = undefined;
    message = undefined;
    try {
      const written = await api.writeSource(item, content, sha);
      sha = written.sha256;
      saved = content;
      bytes = new TextEncoder().encode(content).byteLength;
      await validateAfterSave();
      await loadTree();
    } catch (caught) {
      const explained = explainError(caught);
      if (explained.kind === 'conflict') {
        const diskSha = await Promise.resolve()
          .then(() => api.source(item))
          .then((current) => current.sha256)
          .catch(() => undefined);
        conflict = { diskSha };
      } else {
        fail(caught);
      }
    } finally {
      saving = false;
    }
  }

  async function reloadDiscarding(): Promise<void> {
    conflict = undefined;
    if (item !== undefined) {
      await open(item);
    }
  }

  async function overwrite(): Promise<void> {
    conflict = undefined;
    if (item === undefined) {
      return;
    }
    try {
      const current = await api.source(item);
      sha = current.sha256;
      await save();
    } catch (caught) {
      fail(caught);
    }
  }

  async function create(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    const path = newPath.trim();
    if (path === '') {
      return;
    }
    creating = false;
    error = undefined;
    try {
      await api.writeSource(path, '', '*');
      newPath = '';
      await loadTree();
      navigate({ page: 'fuentes', item: path });
    } catch (caught) {
      fail(caught);
    }
  }

  function openIssue(file: string, _line: number | undefined): void {
    navigate({ page: 'fuentes', item: file });
  }

  /** Primero qué desaparece, después el botón: borrar una fuente no es obvio hasta que se dice qué se lleva. */
  async function planDelete(): Promise<void> {
    if (item === undefined) {
      return;
    }
    error = undefined;
    message = undefined;
    try {
      deleting = await api.deleteSourcePlan(item);
    } catch (caught) {
      deleting = undefined;
      fail(caught);
    }
  }

  async function confirmDelete(): Promise<void> {
    const path = item;
    const expected = sha;
    deleting = undefined;
    if (path === undefined || expected === undefined) {
      return;
    }
    saving = true;
    error = undefined;
    try {
      const outcome = await api.deleteSource(path, expected);
      await loadTree();
      await refreshIssues();
      message = `Borrada ${path}. La versión anterior queda en el histórico (entrada ${outcome.historyId ?? ''}): en cualquier fuente, «Historial de esta fuente». Recompila el artefacto en Estado.`;
      navigate({ page: 'fuentes' });
    } catch (caught) {
      fail(caught);
    } finally {
      saving = false;
    }
  }

  onMount(() => {
    void loadTree();
  });

  $effect(() => {
    if (item !== undefined) {
      void open(item);
    }
  });
</script>

<section class="cv-split-fuentes" aria-labelledby="cv-fuentes-title">
  <aside class="cv-tree-pane" aria-label="Ficheros de fuentes">
    <div class="cv-tree-head">
      <h1 id="cv-fuentes-title" class="cv-sr-only">Fuentes</h1>
      <input type="search" placeholder="Filtrar ficheros…" aria-label="Filtrar ficheros" bind:value={query} />
      <button class="cv-button cv-icon-button" type="button" aria-label="Nuevo fichero" title="Nuevo fichero" onclick={() => (creating = true)}><Icon name="plus" size={15} weight={1.8} /></button>
    </div>
    <div class="cv-tree cv-tree-scroll">
      {#if visible.length === 0 && tree.length > 0}
        <p class="cv-muted">Ningún fichero coincide con «{query}».</p>
      {:else}
        <Tree nodes={visible} selected={item} issues={counts} onselect={(path) => navigate({ page: 'fuentes', item: path })} />
      {/if}
    </div>
    <div class="cv-tree-foot">
      <span title={root}>{plural(total, 'fichero', 'ficheros')} · {withIssues === 0 ? 'sin incidencias' : `${withIssues} con incidencias`}</span>
    </div>
  </aside>
  <div class="cv-editor-pane">
    {#if error !== undefined}
      <Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>
    {/if}
    {#if message !== undefined}<Notice kind={issues.length > 0 ? 'warn' : 'ok'}>{message}</Notice>{/if}
    {#if message !== undefined && issues.length > 0}
      <Notice kind="error" title={`${plural(issues.length, 'problema', 'problemas')} en las fuentes`}><Issues {issues} onopen={openIssue} /></Notice>
    {/if}
    {#if item === undefined || sha === undefined}
      <div class="cv-empty">
        <div class="cv-empty-inner">
          <div class="cv-empty-icon"><Icon name="folder" size={26} /></div>
          <h1>Elige un fichero</h1>
          <p>Las fuentes son la verdad: el editor no reformatea nada y guardar escribe solo cuando tú lo pides. El servidor comprueba que nadie las cambió entre medias.</p>
        </div>
      </div>
    {:else}
      <div class="cv-editor-bar">
        <span class="cv-editor-path">{item}</span>
        <span class="cv-editor-sha" title={sha}>{shortSha(sha)}</span>
        <span class="cv-header-spacer"></span>
        {#if dirty}<span class="cv-editor-dirty">cambios sin guardar</span>{/if}
        <button class="cv-button primary small" type="button" disabled={!dirty || saving} onclick={save}>{saving ? 'Guardando…' : 'Guardar'}</button>
        <button class="cv-button small" type="button" disabled={!dirty || saving} onclick={() => (content = saved)}>Descartar</button>
        <button class="cv-button danger-quiet small" type="button" disabled={saving} onclick={planDelete}>Eliminar</button>
      </div>
      {#key editorKey}
        <Editor value={content} path={item} onchange={(value) => (content = value)} oncursor={(line, column) => (cursor = { line, column })} plain={plainEditor} />
      {/key}
      <details class="cv-collapse cv-history">
        <summary><strong>Historial de esta fuente</strong><span class="cv-muted">· {history.length === 0 ? 'sin versiones guardadas' : plural(history.length, 'versión guardada', 'versiones guardadas')}</span></summary>
        {#if history.length === 0}
          <p class="cv-muted">Cada vez que apliques una revisión (o restaures una versión) la versión anterior completa queda en <code>output/historial-fuentes/</code>.</p>
        {:else}
          <ul class="cv-history-list">
            {#each history as entry (entry.id)}
              {@const file = entry.files.find((candidate) => candidate.path === item)}
              <li class="cv-history-entry">
                <span class="cv-mono">{entry.at}</span>
                <span>{entry.action === 'apply' ? 'aplicación de' : 'restauración de'} <code>{entry.origin}</code>{file === undefined || file.ids.length === 0 ? '' : ` · ${file.ids.join(', ')}`}</span>
                <span class="cv-header-spacer"></span>
                <button class="cv-button small" type="button" onclick={() => compare(entry)}>Ver diferencias</button>
                <button class="cv-button danger-quiet small" type="button" onclick={() => (restoring = entry)}>Restaurar esta versión</button>
              </li>
            {/each}
          </ul>
          {#if comparing !== undefined}
            {@const rows = lineDiff(comparing.content, content)}
            {@const summary = rows === undefined ? undefined : diffSummary(rows)}
            <p class="cv-muted">Versión guardada de {comparing.entry.at} frente al editor{summary === undefined ? '' : ` · −${summary.removed} +${summary.added} líneas`}</p>
            <div class="cv-diff-grid">
              <div>
                <h4 class="cv-eyebrow">Versión guardada</h4>
                <pre class="cv-diff" aria-label={`Versión guardada: ${comparing.entry.id}`}>{#if rows === undefined}{comparing.content}{:else}{#each rows as row, index (index)}{#if row.kind !== 'added'}<span class={`cv-diff-line ${row.kind}`}><span class="cv-diff-no">{row.line}</span>{row.text}</span>{'\n'}{/if}{/each}{/if}</pre>
              </div>
              <div>
                <h4 class="cv-eyebrow">Editor (actual)</h4>
                <pre class="cv-diff" aria-label="Editor (actual)">{#if rows === undefined}{content}{:else}{#each rows as row, index (index)}{#if row.kind !== 'removed'}<span class={`cv-diff-line ${row.kind}`}><span class="cv-diff-no">{row.line}</span>{row.text}</span>{'\n'}{/if}{/each}{/if}</pre>
              </div>
            </div>
          {/if}
        {/if}
      </details>
      <div class="cv-editor-status">
        <span>{LANGUAGE_LABELS[languageFor(item)]} · UTF-8 · {lineEnding(content)}</span>
        <span>Línea {cursor.line}, columna {cursor.column}</span>
        <span>{formatBytes(bytes)}</span>
        <span class="cv-header-spacer"></span>
        <span>Guardar valida las fuentes; compilar se hace en Estado.</span>
      </div>
    {/if}
  </div>
  <Dialog open={conflict !== undefined} title="Otro proceso ha cambiado este fichero" onclose={() => (conflict = undefined)}>
    <p>No se ha guardado nada. Tus cambios siguen en el editor.</p>
    <dl class="cv-consent">
      <dt>Fichero</dt><dd><code>{item}</code></dd>
      <dt>Huella al abrir</dt><dd class="cv-mono">{sha === undefined ? '—' : shortSha(sha)}</dd>
      <dt>Huella en disco</dt><dd class="cv-mono cv-editor-dirty">{conflict?.diskSha === undefined ? 'desconocida' : shortSha(conflict.diskSha)}</dd>
    </dl>
    <div class="cv-dialog-actions">
      <button class="cv-button" type="button" onclick={reloadDiscarding}>Recargar del disco (descarta mis cambios)</button>
      <button class="cv-button danger" type="button" onclick={overwrite}>Sobrescribir con mi versión</button>
    </div>
  </Dialog>
  <Dialog open={deleting !== undefined} title="¿Eliminar esta fuente?" onclose={() => (deleting = undefined)}>
    <p>Se borra <code>{deleting?.path ?? ''}</code> de tus fuentes. La versión anterior completa queda en el histórico, así que se puede recuperar desde «Historial de esta fuente».</p>
    {#if deleting !== undefined && deleting.removed.length > 0}
      <p>Del perfil desaparecen {plural(deleting.removed.length, 'entrada', 'entradas')}:</p>
      <ul class="cv-delete-list">
        {#each deleting.removed as entry (entry.id)}
          <li><code>{entry.id}</code> · {entry.title} <span class="cv-muted">({entry.section})</span></li>
        {/each}
      </ul>
    {:else}
      <p class="cv-muted">No aporta ninguna entrada al perfil.</p>
    {/if}
    <div class="cv-dialog-actions">
      <button class="cv-button" type="button" onclick={() => (deleting = undefined)}>Cancelar</button>
      <button class="cv-button danger" type="button" onclick={confirmDelete}>Eliminar</button>
    </div>
  </Dialog>
  <Dialog open={restoring !== undefined} title="¿Restaurar esta versión?" onclose={() => (restoring = undefined)}>
    <p>Se escribe la versión de <strong>{restoring?.at}</strong> sobre <code>{item}</code>. La versión actual no se pierde: queda a su vez en el histórico. Después conviene recompilar el artefacto en Estado.</p>
    <div class="cv-dialog-actions">
      <button class="cv-button" type="button" onclick={() => (restoring = undefined)}>Cancelar</button>
      <button class="cv-button danger" type="button" onclick={restore}>Restaurar</button>
    </div>
  </Dialog>
  <Dialog open={creating} title="Nuevo fichero de fuentes" onclose={() => (creating = false)}>
    <form onsubmit={create}>
      <label class="cv-field">
        <span>Ruta relativa (por ejemplo <code>experience/acme.md</code>)</span>
        <input name="path" bind:value={newPath} required />
      </label>
      <div class="cv-dialog-actions">
        <button class="cv-button" type="button" onclick={() => (creating = false)}>Cancelar</button>
        <button class="cv-button primary" type="submit">Crear</button>
      </div>
    </form>
  </Dialog>
</section>
