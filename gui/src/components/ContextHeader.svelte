<script lang="ts">
  import { type AppContext, describeChips, workspaceName } from '../lib/context';
  import { THEME_OPTIONS, type ThemeMode } from '../lib/theme';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    /** Sin contexto todavía (primera consulta en curso): la cabecera muestra un esqueleto. */
    context: AppContext | undefined;
    theme: ThemeMode;
    onthemechange: (mode: ThemeMode) => void;
    onshutdown: () => void;
  }
  let { context, theme, onthemechange, onshutdown }: Props = $props();

  let confirm = $state(false);
  const chips = $derived(context === undefined ? [] : describeChips(context));

  function shutdown(): void {
    confirm = false;
    onshutdown();
  }
</script>

<header class="cv-header">
  <div class="cv-header-ws">
    {#if context === undefined}
      <b>Cargando el espacio de trabajo…</b>
      <span class="cv-skeleton-line" aria-hidden="true"></span>
    {:else}
      <b>{workspaceName(context.status.workspace)}</b>
      <span title={context.status.workspace}>{context.status.workspace}</span>
    {/if}
  </div>
  <div class="cv-header-sep" aria-hidden="true"></div>
  <div class="cv-header-chips" role="status" aria-label="Estado del espacio de trabajo">
    {#each chips as chip (chip.id)}
      <span class="cv-chip {chip.tone}" title={chip.title}><Icon name={chip.icon} size={13} weight={1.8} />{chip.label}</span>
    {/each}
  </div>
  <div class="cv-header-spacer"></div>
  <div class="cv-segmented" role="group" aria-label="Tema de la interfaz">
    {#each THEME_OPTIONS as option (option.mode)}
      <button type="button" aria-pressed={theme === option.mode} onclick={() => onthemechange(option.mode)}>{option.label}</button>
    {/each}
  </div>
  <button class="cv-button small danger-quiet" type="button" aria-label="Apagar cv serve" onclick={() => (confirm = true)}>
    <Icon name="power" size={14} weight={1.8} />Apagar
  </button>
</header>

<Dialog open={confirm} title="¿Apagar cv serve?" onclose={() => (confirm = false)}>
  <p>La interfaz dejará de funcionar hasta que vuelvas a arrancar <code>cv serve</code>; el token de esta sesión deja de valer.</p>
  <div class="cv-dialog-actions">
    <button class="cv-button" type="button" onclick={() => (confirm = false)}>Cancelar</button>
    <button class="cv-button danger" type="button" onclick={shutdown}>Apagar</button>
  </div>
</Dialog>
