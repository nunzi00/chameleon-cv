<script lang="ts">
  import { onMount } from 'svelte';

  import Icon from '../components/Icon.svelte';
  import Notice from '../components/Notice.svelte';
  import PdfViewer from '../components/PdfViewer.svelte';
  import type { ApiClient, OutputFile } from '../lib/api/client';
  import { explainError, type ExplainedError } from '../lib/errors';
  import { formatBytes, plural } from '../lib/format';
  import { classifyOutputs, isTextual, type OutputItem } from '../lib/outputs';
  import type { Route } from '../lib/router';

  interface Props {
    api: ApiClient;
    /** Fichero a mostrar (de la ruta). */
    item: string | undefined;
    onsession: () => void;
    navigate: (route: Route) => void;
  }
  let { api, item, onsession, navigate }: Props = $props();

  /** Etiqueta larga (nombre accesible) y corta (etiqueta visible) por tipo. */
  const KIND_LABELS = { pdf: 'PDF', markdown: 'Markdown', review: 'Revisión', other: 'Otro' } as const;
  const KIND_TAGS = { pdf: 'PDF', markdown: 'MD', review: 'REV', other: '—' } as const;
  let items = $state<readonly OutputItem[]>([]);
  let loaded = $state(false);
  let error = $state<ExplainedError | undefined>(undefined);
  let file = $state<OutputFile | undefined>(undefined);
  let text = $state<string | undefined>(undefined);
  let textUrl = $state<string | undefined>(undefined);
  const totalBytes = $derived(items.reduce((sum, entry) => sum + entry.bytes, 0));

  function fail(caught: unknown): void {
    const explained = explainError(caught);
    error = explained;
    if (explained.kind === 'session') {
      onsession();
    }
  }

  async function load(): Promise<void> {
    try {
      items = classifyOutputs((await api.outputs()).files);
      loaded = true;
    } catch (caught) {
      fail(caught);
    }
  }

  async function show(name: string): Promise<void> {
    error = undefined;
    file = undefined;
    text = undefined;
    try {
      const loadedFile = await api.output(name);
      file = loadedFile;
      if (isTextual(loadedFile.contentType)) {
        text = await loadedFile.blob.text();
      }
    } catch (caught) {
      fail(caught);
    }
  }

  onMount(() => {
    void load();
  });

  $effect(() => {
    if (item !== undefined) {
      void show(item);
    }
  });

  $effect(() => {
    if (file === undefined || text === undefined) {
      textUrl = undefined;
      return undefined;
    }
    const created = URL.createObjectURL(file.blob);
    textUrl = created;
    return () => URL.revokeObjectURL(created);
  });
</script>

<section aria-labelledby="cv-salidas-title">
  {#if error !== undefined}<Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>{/if}
  {#if loaded && items.length === 0}
    <div class="cv-page-title"><h1 id="cv-salidas-title">Salidas</h1></div>
    <div class="cv-empty">
      <div class="cv-empty-inner">
        <div class="cv-empty-icon"><Icon name="file-down" size={26} /></div>
        <h1><code>output/</code> está vacío</h1>
        <p>Aquí aparecerán los CV generados (PDF y Markdown) y las revisiones del co-piloto. Todavía no hay nada.</p>
        <div class="cv-actions">
          <button class="cv-button primary" type="button" onclick={() => navigate({ page: 'generar' })}>Generar mi primer CV</button>
          <button class="cv-button" type="button" onclick={load}>Actualizar</button>
        </div>
      </div>
    </div>
  {:else}
    <div class="cv-split-salidas">
      <aside aria-label="Ficheros generados">
        <div class="cv-page-title">
          <h1 id="cv-salidas-title">Salidas</h1>
          {#if loaded}<span class="cv-muted">{plural(items.length, 'fichero', 'ficheros')} en <code>output/</code> · {formatBytes(totalBytes)}</span>{/if}
        </div>
        <div class="cv-table cv-table-outputs">
          <div class="cv-table-head"><span>Fichero</span><span>Tamaño</span></div>
          {#each items as entry (entry.name)}
            <button
              class="cv-table-row"
              type="button"
              aria-label={`${KIND_LABELS[entry.kind]} ${entry.name} (${formatBytes(entry.bytes)})`}
              aria-current={item === entry.name ? 'true' : undefined}
              onclick={() => navigate({ page: 'salidas', item: entry.name })}
            >
              <span class="cv-output-name"><span class={`cv-filetype ${entry.kind}`}>{KIND_TAGS[entry.kind]}</span><span class="cv-mono">{entry.name}</span></span>
              <span class="cv-muted">{formatBytes(entry.bytes)}</span>
            </button>
          {/each}
        </div>
        <div class="cv-actions"><button class="cv-button small" type="button" onclick={load}>Actualizar</button></div>
      </aside>
      <div class="cv-card cv-card-tight">
        {#if file === undefined}
          <p class="cv-muted">Elige un fichero para verlo o descargarlo.</p>
        {:else}
          <div class="cv-card-head">
            <span class="cv-mono">output/{file.name}</span>
            {#if text !== undefined && textUrl !== undefined}
              <a class="cv-button small" href={textUrl} download={file.name}>Descargar</a>
            {/if}
          </div>
          {#if text !== undefined}
            <pre class="cv-text">{text}</pre>
          {:else}
            <PdfViewer blob={file.blob} name={file.name} />
          {/if}
        {/if}
      </div>
    </div>
  {/if}
</section>
