<script lang="ts">
  import type { Issue } from '../lib/validation';

  interface Props {
    issues: readonly Issue[];
    onopen?: ((file: string, line: number | undefined) => void) | undefined;
  }
  let { issues, onopen = undefined }: Props = $props();
</script>

<ul class="cv-issues">
  {#each issues as issue, index (index)}
    <li>
      {#if onopen !== undefined}
        <button type="button" onclick={() => onopen(issue.file, issue.line)}>{issue.file}{issue.line === undefined ? '' : `:${issue.line}`}</button>
      {:else}
        <code>{issue.file}{issue.line === undefined ? '' : `:${issue.line}`}</code>
      {/if}
      — {issue.message}
    </li>
  {/each}
</ul>
