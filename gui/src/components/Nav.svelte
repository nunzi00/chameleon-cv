<script lang="ts">
  import { NAV_GROUPS, PORTAL_LINKS } from '../lib/nav';
  import { formatRoute, type Route } from '../lib/router';
  import Icon from './Icon.svelte';

  interface Props {
    route: Route;
    /** Revisiones pendientes: contador junto al ítem. */
    reviews: number;
    collapsed: boolean;
    ontoggle: () => void;
  }
  let { route, reviews, collapsed, ontoggle }: Props = $props();
</script>

<nav class="cv-nav" aria-label="Pantallas">
  <div class="cv-nav-brand"><Icon name="brand" size={22} /><span>Chameleon CV</span></div>
  {#each NAV_GROUPS as group (group.label)}
    <span class="cv-nav-group" aria-hidden="true">{group.label}</span>
    {#each group.items as item (item.page)}
      <a class="cv-nav-item" href={formatRoute({ page: item.page })} title={item.label} aria-current={route.page === item.page ? 'page' : undefined}>
        <Icon name={item.icon} />
        <span>{item.label}</span>
        {#if item.page === 'revisiones' && reviews > 0}
          <span class="cv-nav-count" aria-label="{reviews} pendientes">{reviews}</span>
        {/if}
      </a>
    {/each}
  {/each}
  <span class="cv-nav-group" aria-hidden="true">Portal</span>
  {#each PORTAL_LINKS as link (link.href)}
    <a class="cv-nav-item" href={link.href} target="_blank" rel="noopener" title="{link.label} (portal, nueva pestaña)">
      <Icon name={link.icon} />
      <span>{link.label}</span>
    </a>
  {/each}
  <div class="cv-nav-spacer"></div>
  <button class="cv-nav-item" type="button" aria-pressed={collapsed} title={collapsed ? 'Desplegar la barra' : 'Plegar a iconos'} onclick={ontoggle}>
    <Icon name="sidebar" />
    <span>Plegar a iconos</span>
  </button>
</nav>
