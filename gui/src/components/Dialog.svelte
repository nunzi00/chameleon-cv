<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    children: Snippet;
  }
  let { open, title, children }: Props = $props();
</script>

{#if open}
  <dialog open aria-labelledby="cv-dialog-title" aria-modal="true">
    <h2 id="cv-dialog-title">{title}</h2>
    {@render children()}
  </dialog>
{/if}
