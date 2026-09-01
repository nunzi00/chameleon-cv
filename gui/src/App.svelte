<script lang="ts">
  import { onMount } from 'svelte';

  import ContextHeader from './components/ContextHeader.svelte';
  import Icon from './components/Icon.svelte';
  import Nav from './components/Nav.svelte';
  import SessionGate from './components/SessionGate.svelte';
  import { createApiClient } from './lib/api/client';
  import type { AppContext } from './lib/context';
  import { explainError } from './lib/errors';
  import { readCollapsed, storeCollapsed } from './lib/nav';
  import { formatRoute, parseRoute, type Route } from './lib/router';
  import { forgetToken, rememberToken, startSession } from './lib/session';
  import { browserStorage } from './lib/storage';
  import { applyTheme, readTheme, storeTheme, type ThemeMode } from './lib/theme';

  interface Props {
    /** Solo para las pruebas: un `fetch` distinto del global. */
    fetchImpl?: typeof fetch;
  }
  let { fetchImpl = (input, init) => fetch(input, init) }: Props = $props();

  const preferences = browserStorage();
  let token = $state<string | undefined>(undefined);
  let route = $state<Route>({ page: 'estado' });
  let context = $state<AppContext | undefined>(undefined);
  let theme = $state<ThemeMode>(readTheme(preferences));
  let collapsed = $state(readCollapsed(preferences));
  let stopped = $state(false);
  let gateReason = $state<'expired' | undefined>(undefined);
  const api = createApiClient({ fetch: (input, init) => fetchImpl(input, init), token: () => token });

  function navigate(target: Route): void {
    location.hash = formatRoute(target);
  }

  function sessionLost(): void {
    forgetToken(sessionStorage);
    token = undefined;
    context = undefined;
    gateReason = 'expired';
  }

  /** Una sola consulta alimenta los chips de la cabecera y el contador de revisiones en todas las pantallas. */
  async function refreshContext(): Promise<void> {
    try {
      const [status, config, reviews] = await Promise.all([api.status(), api.llmConfig(), api.reviews()]);
      context = { status, remoteAllowed: config.remote.allowed, reviews: reviews.reviews.length };
    } catch (caught) {
      // Cada pantalla explica sus propios errores; aquí solo importa perder la sesión.
      if (explainError(caught).kind === 'session') {
        sessionLost();
      }
    }
  }

  function changeTheme(mode: ThemeMode): void {
    theme = mode;
    applyTheme(document.documentElement, mode);
    storeTheme(preferences, mode);
  }

  function toggleNav(): void {
    collapsed = !collapsed;
    storeCollapsed(preferences, collapsed);
  }

  async function shutdown(): Promise<void> {
    try {
      await api.shutdown();
      stopped = true;
    } catch (caught) {
      if (explainError(caught).kind === 'session') {
        sessionLost();
      }
    }
  }

  function enter(value: string): void {
    token = rememberToken(sessionStorage, value);
    gateReason = undefined;
    void refreshContext();
  }

  onMount(() => {
    const session = startSession(location.hash, sessionStorage);
    token = session.token;
    if (session.fromUrl) {
      history.replaceState(null, '', `${location.pathname}${formatRoute({ page: 'estado' })}`);
    }
    route = parseRoute(location.hash);
    if (token !== undefined) {
      void refreshContext();
    }
    const onHashChange = (): void => {
      const next = parseRoute(location.hash);
      // Los chips y el contador dependen de la PANTALLA, no del fichero elegido dentro de ella: elegir uno a uno
      // en Fuentes o en Revisiones no tiene por qué volver a pedir estado, configuración y revisiones.
      const changedPage = next.page !== route.page;
      route = next;
      if (changedPage) {
        void refreshContext();
      }
    };
    addEventListener('hashchange', onHashChange);
    return () => removeEventListener('hashchange', onHashChange);
  });
</script>

{#if token === undefined}
  <SessionGate onsubmit={enter} reason={gateReason} />
{:else}
  <div class="cv-app" data-rail={collapsed ? '' : undefined}>
    <Nav {route} reviews={context?.reviews ?? 0} {collapsed} ontoggle={toggleNav} />
    <div class="cv-content">
      <ContextHeader {context} {theme} onthemechange={changeTheme} onshutdown={shutdown} />
      <main class="cv-main">
        {#if stopped}
          <div class="cv-empty">
            <div class="cv-empty-inner">
              <div class="cv-empty-icon"><Icon name="power" size={24} /></div>
              <h1>Servidor detenido</h1>
              <p>Vuelve a arrancarlo con <code>cv serve</code> y abre la nueva URL con su token.</p>
            </div>
          </div>
        {:else}
          <div class={route.page === 'fuentes' || route.page === 'generar' ? 'cv-page-wide' : 'cv-page'}>
            {#if route.page === 'estado'}
              {#await import('./pages/Estado.svelte')}
                <p class="cv-loading" aria-live="polite">Cargando…</p>
              {:then estado}
                <estado.default {api} onsession={sessionLost} onopen={(file) => navigate({ page: 'fuentes', item: file })} />
              {/await}
            {:else if route.page === 'fuentes'}
              {#await import('./pages/Fuentes.svelte')}
                <p class="cv-loading" aria-live="polite">Cargando…</p>
              {:then fuentes}
                <fuentes.default {api} item={route.item} onsession={sessionLost} {navigate} />
              {/await}
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
            {:else if route.page === 'importar'}
              {#await import('./pages/Importar.svelte')}
                <p class="cv-muted">Cargando…</p>
              {:then importar}
                <importar.default {api} onsession={sessionLost} />
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
          </div>
        {/if}
      </main>
    </div>
  </div>
{/if}
