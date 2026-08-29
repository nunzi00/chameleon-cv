<script lang="ts">
  import { onMount } from 'svelte';

  import Dialog from '../components/Dialog.svelte';
  import Editor from '../components/Editor.svelte';
  import Issues from '../components/Issues.svelte';
  import Notice from '../components/Notice.svelte';
  import Tree from '../components/Tree.svelte';
  import type { ApiClient } from '../lib/api/client';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { formatBytes, plural } from '../lib/format';
  import type { Route } from '../lib/router';
  import { buildTree, type TreeNode } from '../lib/sources/tree';
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

  let tree = $state<readonly TreeNode[]>([]);
  let count = $state(0);
  let root = $state('');
  let content = $state('');
  let saved = $state('');
  let sha = $state<string | undefined>(undefined);
  let bytes = $state(0);
  let error = $state<ExplainedError | undefined>(undefined);
  let issues = $state<readonly Issue[]>([]);
  let message = $state<string | undefined>(undefined);
  let saving = $state(false);
  let conflict = $state(false);
  let creating = $state(false);
  let newPath = $state('');
  let editorKey = $state(0);
  const dirty = $derived(sha !== undefined && content !== saved);

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    issues = issuesOf(caught);
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function loadTree(): Promise<void> {
    try {
      const list = await api.sources();
      root = list.root;
      count = list.entries.length;
      tree = buildTree(list.entries);
    } catch (caught) {
      fail(caught);
    }
  }

  async function open(path: string): Promise<void> {
    error = undefined;
    issues = [];
    message = undefined;
    try {
      const file = await api.source(path);
      content = file.content;
      saved = file.content;
      sha = file.sha256;
      bytes = new TextEncoder().encode(file.content).byteLength;
      editorKey += 1;
    } catch (caught) {
      sha = undefined;
      fail(caught);
    }
  }

  async function validateAfterSave(): Promise<void> {
    try {
      const result = await api.validate();
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
    issues = [];
    message = undefined;
    try {
      const written = await api.writeSource(item, content, sha);
      sha = written.sha256;
      saved = content;
      await validateAfterSave();
      await loadTree();
    } catch (caught) {
      const explained = explainError(caught);
      if (explained.kind === 'conflict') {
        conflict = true;
      } else {
        fail(caught);
      }
    } finally {
      saving = false;
    }
  }

  async function reloadDiscarding(): Promise<void> {
    conflict = false;
    if (item !== undefined) {
      await open(item);
    }
  }

  async function overwrite(): Promise<void> {
    conflict = false;
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

  onMount(() => {
    void loadTree();
  });

  $effect(() => {
    if (item !== undefined) {
      void open(item);
    }
  });
</script>

<section aria-labelledby="cv-fuentes-title">
  <h2 id="cv-fuentes-title">Fuentes</h2>
  {#if error !== undefined}
    <Notice kind="error" title={error.title} lines={issues.length > 0 ? [] : error.lines}>{error.detail}</Notice>
  {/if}
  {#if issues.length > 0}
    <Notice kind="error" title={`${plural(issues.length, 'problema', 'problemas')} en las fuentes`}><Issues {issues} onopen={openIssue} /></Notice>
  {/if}
  {#if message !== undefined}<Notice kind="ok">{message}</Notice>{/if}
  <div class="cv-split">
    <aside class="cv-card cv-tree" aria-label="Ficheros de fuentes">
      <p class="cv-muted">{root === '' ? '' : `${root} · ${plural(count, 'fichero', 'ficheros')}`}</p>
      <Tree nodes={tree} selected={item} onselect={(path) => navigate({ page: 'fuentes', item: path })} />
      <div class="cv-actions">
        <button class="cv-button" type="button" onclick={() => (creating = true)}>Nuevo fichero</button>
      </div>
    </aside>
    <div class="cv-card">
      {#if item === undefined || sha === undefined}
        <p class="cv-muted">Elige un fichero del árbol para editarlo. Guardar escribe en tus fuentes solo cuando tú lo pides; el servidor comprueba que nadie las cambió entre medias.</p>
      {:else}
        <div class="cv-actions">
          <strong><code>{item}</code></strong>
          <span class="cv-muted">{formatBytes(bytes)}{dirty ? ' · cambios sin guardar' : ''}</span>
          <button class="cv-button primary" type="button" disabled={!dirty || saving} onclick={save}>{saving ? 'Guardando…' : 'Guardar'}</button>
          <button class="cv-button" type="button" disabled={!dirty || saving} onclick={() => (content = saved)}>Descartar</button>
        </div>
        {#key editorKey}
          <Editor value={content} path={item} onchange={(value) => (content = value)} plain={plainEditor} />
        {/key}
      {/if}
    </div>
  </div>
  <Dialog open={conflict} title="El fichero cambió desde que lo abriste">
    <p>Alguien (o tú, en otra pestaña) guardó <code>{item}</code> mientras lo editabas. Puedes recargar la versión actual y perder tus cambios, o sobrescribirla con lo que ves.</p>
    <div class="cv-actions">
      <button class="cv-button" type="button" onclick={reloadDiscarding}>Recargar (descarta mis cambios)</button>
      <button class="cv-button danger" type="button" onclick={overwrite}>Sobrescribir con mi versión</button>
    </div>
  </Dialog>
  <Dialog open={creating} title="Nuevo fichero de fuentes">
    <form onsubmit={create}>
      <label class="cv-field">
        <span>Ruta relativa (por ejemplo <code>experience/acme.md</code>)</span>
        <input name="path" bind:value={newPath} required />
      </label>
      <div class="cv-actions">
        <button class="cv-button primary" type="submit">Crear</button>
        <button class="cv-button" type="button" onclick={() => (creating = false)}>Cancelar</button>
      </div>
    </form>
  </Dialog>
</section>
