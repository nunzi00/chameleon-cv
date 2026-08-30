<script lang="ts">
  import { onMount } from 'svelte';

  import Nav from './components/Nav.svelte';
  import SessionGate from './components/SessionGate.svelte';
  import { createApiClient } from './lib/api/client';
  import { formatRoute, parseRoute, type Route } from './lib/router';
  import { forgetToken, rememberToken, startSession } from './lib/session';
  import Estado from './pages/Estado.svelte';
  import Fuentes from './pages/Fuentes.svelte';

  interface Props {
    /** Solo para las pruebas: un `fetch` distinto del global. */
    fetchImpl?: typeof fetch;
  }
  let { fetchImpl = (input, init) => fetch(input, init) }: Props = $props();

  let token = $state<string | undefined>(undefined);
  let route = $state<Route>({ page: 'estado' });
  const api = createApiClient({ fetch: (input, init) => fetchImpl(input, init), token: () => token });

  function navigate(target: Route): void {
    location.hash = formatRoute(target);
  }

  function sessionLost(): void {
    forgetToken(sessionStorage);
    token = undefined;
  }

  onMount(() => {
    const session = startSession(location.hash, sessionStorage);
    token = session.token;
    if (session.fromUrl) {
      history.replaceState(null, '', `${location.pathname}${formatRoute({ page: 'estado' })}`);
    }
    route = parseRoute(location.hash);
    const onHashChange = (): void => {
      route = parseRoute(location.hash);
    };
    addEventListener('hashchange', onHashChange);
    return () => removeEventListener('hashchange', onHashChange);
  });
</script>

{#if token === undefined}
  <SessionGate onsubmit={(value) => (token = rememberToken(sessionStorage, value))} />
{:else}
  <div class="cv-app">
    <Nav {route} />
    <main class="cv-main">
      {#if route.page === 'estado'}
        <Estado {api} onsession={sessionLost} onopen={(file) => navigate({ page: 'fuentes', item: file })} />
      {:else if route.page === 'fuentes'}
        <Fuentes {api} item={route.item} onsession={sessionLost} {navigate} />
      {:else if route.page === 'generar'}
        {#await import('./pages/Generar.svelte')}
          <p class="cv-muted">Cargando…</p>
        {:then generar}
          <generar.default {api} onsession={sessionLost} {navigate} />
        {/await}
      {:else if route.page === 'ajustes'}
        {#await import('./pages/Ajustes.svelte')}
          <p class="cv-muted">Cargando…</p>
        {:then ajustes}
          <ajustes.default {api} onsession={sessionLost} />
        {/await}
      {:else if route.page === 'salidas'}
        {#await import('./pages/Salidas.svelte')}
          <p class="cv-muted">Cargando…</p>
        {:then salidas}
          <salidas.default {api} item={route.item} onsession={sessionLost} {navigate} />
        {/await}
      {:else if route.page === 'copiloto'}
        {#await import('./pages/Copiloto.svelte')}
          <p class="cv-muted">Cargando…</p>
        {:then copiloto}
          <copiloto.default {api} onsession={sessionLost} {navigate} />
        {/await}
      {:else}
        {#await import('./pages/Revisiones.svelte')}
          <p class="cv-muted">Cargando…</p>
        {:then revisiones}
          <revisiones.default {api} item={route.item} onsession={sessionLost} {navigate} />
        {/await}
      {/if}
    </main>
  </div>
{/if}
