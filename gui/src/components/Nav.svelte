<script lang="ts">
  import { NAV_GROUPS, PORTAL_LINKS } from '../lib/nav';
  import { formatRoute, type Route } from '../lib/router';
  import type { NavShape } from '../lib/ui-layout';
  import Icon from './Icon.svelte';

  interface Props {
    route: Route;
    /** Revisiones pendientes: contador junto al ítem. */
    reviews: number;
    collapsed: boolean;
    ontoggle: () => void;
    /**
     * Cómo se pinta el MISMO modelo de navegación (T-9.29): barra lateral, cinta superior o lanzador en
     * mosaico. Una sola fuente de pantallas y una sola marca de «dónde estoy»; lo que cambia es la forma.
     */
    shape?: NavShape;
    /** Solo en el lanzador: abrir un destino cierra el mosaico. */
    onnavigate?: () => void;
  }
  let { route, reviews, collapsed, ontoggle, shape = 'sidebar', onnavigate }: Props = $props();

  const items = $derived(NAV_GROUPS.flatMap((group) => group.items));
</script>

{#if shape === 'sidebar'}
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
{:else if shape === 'ribbon'}
  <!-- Cinta: las mismas pantallas en una fila, sin grupos ni portal, para que quepan y no roben altura. -->
  <nav class="cv-ribbon" aria-label="Pantallas">
    <span class="cv-ribbon-brand" title="Chameleon CV"><Icon name="brand" size={19} /></span>
    {#each items as item (item.page)}
      <a class="cv-ribbon-item" href={formatRoute({ page: item.page })} title={item.label} aria-current={route.page === item.page ? 'page' : undefined}>
        <Icon name={item.icon} size={15} />
        <span>{item.label}</span>
        {#if item.page === 'revisiones' && reviews > 0}
          <span class="cv-nav-count" aria-label="{reviews} pendientes">{reviews}</span>
        {/if}
      </a>
    {/each}
  </nav>
{:else}
  <!-- Lanzador: el mosaico ocupa el sitio del contenido y se cierra al elegir. -->
  <nav class="cv-launcher" aria-label="Pantallas">
    {#each NAV_GROUPS as group (group.label)}
      <section class="cv-launcher-group">
        <h2>{group.label}</h2>
        <div class="cv-launcher-grid">
          {#each group.items as item (item.page)}
            <a class="cv-launcher-item" href={formatRoute({ page: item.page })} aria-current={route.page === item.page ? 'page' : undefined} onclick={() => onnavigate?.()}>
              <Icon name={item.icon} size={20} />
              <span>{item.label}</span>
              {#if item.page === 'revisiones' && reviews > 0}
                <span class="cv-nav-count" aria-label="{reviews} pendientes">{reviews}</span>
              {/if}
            </a>
          {/each}
        </div>
      </section>
    {/each}
    <section class="cv-launcher-group">
      <h2>Portal</h2>
      <div class="cv-launcher-grid">
        {#each PORTAL_LINKS as link (link.href)}
          <a class="cv-launcher-item" href={link.href} target="_blank" rel="noopener">
            <Icon name={link.icon} size={20} />
            <span>{link.label}</span>
          </a>
        {/each}
      </div>
    </section>
  </nav>
{/if}
