<script lang="ts">
  import { onMount } from 'svelte';

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

  const KIND_LABELS = { pdf: 'PDF', markdown: 'Markdown', review: 'Revisión', other: 'Otro' } as const;
  let items = $state<readonly OutputItem[]>([]);
  let error = $state<ExplainedError | undefined>(undefined);
  let file = $state<OutputFile | undefined>(undefined);
  let text = $state<string | undefined>(undefined);
  let textUrl = $state<string | undefined>(undefined);

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
    } catch (caught) {
      fail(caught);
    }
  }

  async function show(name: string): Promise<void> {
    error = undefined;
    file = undefined;
    text = undefined;
    try {
      const loaded = await api.output(name);
      file = loaded;
      if (isTextual(loaded.contentType)) {
        text = await loaded.blob.text();
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
  <h2 id="cv-salidas-title">Salidas</h2>
  {#if error !== undefined}<Notice kind="error" title={error.title} lines={error.lines}>{error.detail}</Notice>{/if}
  <div class="cv-split">
    <aside class="cv-card" aria-label="Ficheros generados">
      {#if items.length === 0}
        <p class="cv-muted">Todavía no hay nada en <code>output/</code>: genera un CV desde la pantalla Generar.</p>
      {:else}
        <p class="cv-muted">{plural(items.length, 'fichero', 'ficheros')} en <code>output/</code></p>
        <ul class="cv-tree">
          {#each items as entry (entry.name)}
            <li>
              <button type="button" aria-current={item === entry.name ? 'true' : undefined} onclick={() => navigate({ page: 'salidas', item: entry.name })}>
                <span class="cv-badge">{KIND_LABELS[entry.kind]}</span> {entry.name} <span class="cv-muted">({formatBytes(entry.bytes)})</span>
              </button>
            </li>
          {/each}
        </ul>
      {/if}
      <div class="cv-actions"><button class="cv-button" type="button" onclick={load}>Actualizar</button></div>
    </aside>
    <div class="cv-card">
      {#if file === undefined}
        <p class="cv-muted">Elige un fichero para verlo o descargarlo.</p>
      {:else if text !== undefined}
        <p class="cv-actions"><strong><code>{file.name}</code></strong>{#if textUrl !== undefined}<a class="cv-button" href={textUrl} download={file.name}>Descargar</a>{/if}</p>
        <pre class="cv-text">{text}</pre>
      {:else}
        <PdfViewer blob={file.blob} name={file.name} />
      {/if}
    </div>
  </div>
</section>
