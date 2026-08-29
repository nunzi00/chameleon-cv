<script lang="ts">
  import { PAGES, formatRoute, type Route } from '../lib/router';

  interface Props {
    route: Route;
  }
  let { route }: Props = $props();
</script>

<nav class="cv-nav" aria-label="Pantallas">
  <h1>Chameleon CV</h1>
  {#each PAGES as entry (entry.page)}
    <a href={formatRoute({ page: entry.page })} aria-current={route.page === entry.page ? 'page' : undefined}>{entry.label}</a>
  {/each}
</nav>
