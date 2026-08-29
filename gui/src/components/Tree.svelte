<script lang="ts">
  import Tree from './Tree.svelte';
  import type { TreeNode } from '../lib/sources/tree';

  interface Props {
    nodes: readonly TreeNode[];
    selected: string | undefined;
    onselect: (path: string) => void;
  }
  let { nodes, selected, onselect }: Props = $props();
</script>

<ul>
  {#each nodes as node (node.path)}
    <li>
      {#if node.kind === 'directory'}
        <span class="dir">{node.name}/</span>
        <Tree nodes={node.children} {selected} {onselect} />
      {:else}
        <button type="button" aria-current={selected === node.path ? 'true' : undefined} onclick={() => onselect(node.path)}>{node.name}</button>
      {/if}
    </li>
  {/each}
</ul>
