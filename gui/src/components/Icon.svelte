<script lang="ts">
  import { ICONS, type IconName } from '../lib/icons';

  interface Props {
    name: IconName;
    /** Lado en píxeles (17 en la barra lateral, 13 en los chips). */
    size?: number;
    weight?: number;
  }
  let { name, size = 17, weight = 1.6 }: Props = $props();
</script>

<svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={weight} stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  {#each ICONS[name] as d (d)}
    <path {d} />
  {/each}
</svg>
