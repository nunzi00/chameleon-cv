<script lang="ts">
  import { type AppContext, describeChips, workspaceName } from '../lib/context';
  import { THEME_OPTIONS, type ThemeMode } from '../lib/theme';
  import { UI_LAYOUTS, type UiLayout } from '../lib/ui-layout';
  import { PALETTES, type Palette } from '../lib/palette';
  import Dialog from './Dialog.svelte';
  import Icon from './Icon.svelte';

  interface Props {
    /** Sin contexto todavía (primera consulta en curso): la cabecera muestra un esqueleto. */
    context: AppContext | undefined;
    theme: ThemeMode;
    onthemechange: (mode: ThemeMode) => void;
    onshutdown: () => void;
    /** La organización de la interfaz (T-9.29): un click y cambia la carcasa entera. */
    layout: UiLayout;
    onlayoutchange: (layout: UiLayout) => void;
    /** La paleta (T-9.30): el tercer eje, ortogonal a la organización y al claro/oscuro. */
    palette: Palette;
    onpalettechange: (palette: Palette) => void;
    /** En las organizaciones sin navegación permanente, la cabecera lleva el botón que abre el mosaico. */
    launcher?: boolean;
    launcherOpen?: boolean;
    onlaunchertoggle?: () => void;
  }
  let { context, theme, onthemechange, onshutdown, layout, onlayoutchange, palette, onpalettechange, launcher = false, launcherOpen = false, onlaunchertoggle }: Props = $props();

  let confirm = $state(false);
  const chips = $derived(context === undefined ? [] : describeChips(context));

  function shutdown(): void {
    confirm = false;
    onshutdown();
  }
</script>

<header class="cv-header">
  {#if launcher}
    <button class="cv-button small cv-header-launch" type="button" aria-expanded={launcherOpen} onclick={() => onlaunchertoggle?.()}>
      <Icon name={launcherOpen ? 'close' : 'layers'} size={14} weight={1.8} />{launcherOpen ? 'Cerrar' : 'Pantallas'}
    </button>
  {/if}
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
  <div class="cv-segmented cv-header-layout" role="group" aria-label="Organización de la interfaz">
    {#each UI_LAYOUTS as option (option.layout)}
      <button type="button" aria-pressed={layout === option.layout} title={option.description} onclick={() => onlayoutchange(option.layout)}>{option.label}</button>
    {/each}
  </div>
  <label class="cv-header-palette">
    <span class="cv-sr-only">Paleta de colores</span>
    <select name="palette" value={palette} onchange={(event) => onpalettechange((event.currentTarget as HTMLSelectElement).value as Palette)}>
      {#each PALETTES as option (option.palette)}<option value={option.palette} title={option.description}>{option.label}</option>{/each}
    </select>
  </label>
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
