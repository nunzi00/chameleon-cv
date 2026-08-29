<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    kind?: 'info' | 'ok' | 'warn' | 'error';
    title?: string | undefined;
    lines?: readonly string[];
    children?: Snippet;
  }
  let { kind = 'info', title = undefined, lines = [], children }: Props = $props();
</script>

<div class={`cv-notice ${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
  {#if title !== undefined}<strong>{title}</strong>{/if}
  {#if children}<div>{@render children()}</div>{/if}
  {#if lines.length > 0}
    <ul>
      {#each lines as line, index (index)}
        <li>{line}</li>
      {/each}
    </ul>
  {/if}
</div>
