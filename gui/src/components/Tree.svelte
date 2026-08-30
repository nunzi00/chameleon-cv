<script lang="ts">
  import Tree from './Tree.svelte';
  import type { TreeNode } from '../lib/sources/tree';

  interface Props {
    nodes: readonly TreeNode[];
    selected: string | undefined;
    /** Incidencias de validación por ruta (badge rojo con el número). */
    issues?: ReadonlyMap<string, number> | undefined;
    onselect: (path: string) => void;
  }
  let { nodes, selected, issues = undefined, onselect }: Props = $props();
</script>

<div class="cv-tree-children">
  {#each nodes as node (node.path)}
    {#if node.kind === 'directory'}
      <div class="cv-tree-dir">{node.name}/</div>
      <Tree nodes={node.children} {selected} {issues} {onselect} />
    {:else}
      <button class="cv-tree-file" type="button" aria-current={selected === node.path ? 'true' : undefined} onclick={() => onselect(node.path)}>
        <span>{node.name}</span>
        {#if (issues?.get(node.path) ?? 0) > 0}
          <span class="cv-tree-issues" aria-label={`${issues?.get(node.path)} incidencias`}>{issues?.get(node.path)}</span>
        {/if}
      </button>
    {/if}
  {/each}
</div>
