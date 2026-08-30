<script lang="ts">
  import { onMount } from 'svelte';

  import type { EditorHandle } from './codemirror';

  interface Props {
    value: string;
    path: string;
    onchange: (value: string) => void;
    /** Un <textarea> en lugar de CodeMirror (pruebas y entornos sin DOM completo). */
    plain?: boolean;
    oncursor?: ((line: number, column: number) => void) | undefined;
  }
  let { value, path, onchange, plain = false, oncursor = undefined }: Props = $props();
  let host = $state<HTMLDivElement | undefined>(undefined);
  let handle: EditorHandle | undefined;
  let loading = $state(true);

  onMount(() => {
    if (plain) {
      loading = false;
      return undefined;
    }
    let cancelled = false;
    void import('./codemirror').then(({ createEditor, languageFor }) => {
      if (cancelled || host === undefined) {
        return;
      }
      handle = createEditor(host, { doc: value, language: languageFor(path), onChange: onchange, onCursor: oncursor });
      loading = false;
    });
    return () => {
      cancelled = true;
      handle?.destroy();
      handle = undefined;
    };
  });

  // Un cambio de fichero (o una recarga) reemplaza el documento; los cambios del propio editor no vuelven a entrar.
  $effect(() => {
    handle?.setValue(value);
  });
</script>

<div class="cv-editor">
  {#if plain}
    <textarea class="cv-plain" aria-label={`Contenido de ${path}`} value={value} oninput={(event) => onchange((event.currentTarget as HTMLTextAreaElement).value)}></textarea>
  {:else}
    {#if loading}<p class="cv-muted">Cargando el editor…</p>{/if}
    <div bind:this={host}></div>
  {/if}
</div>
