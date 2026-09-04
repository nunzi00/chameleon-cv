<script lang="ts">
  import { type AppContext, describeChips, workspaceName } from '../lib/context';
  import type { UserSummaryPayload } from '../lib/api/types';
  import { THEME_OPTIONS, type ThemeMode } from '../lib/theme';
  import { UI_LAYOUTS, type UiLayout } from '../lib/ui-layout';
  import { PALETTES, type Palette } from '../lib/palette';
  import { isUserId } from '../lib/user-id';
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
    /** Los usuarios del espacio de trabajo (T-9.32); vacío = espacio de una sola persona, sin selector. */
    users?: readonly UserSummaryPayload[];
    /** El usuario con el que se trabaja; `undefined` = la raíz del espacio de trabajo. */
    user?: string | undefined;
    /** `cv serve --user`: el servidor está fijado y no hay nada que elegir. */
    pinnedUser?: string | undefined;
    /** La raíz tiene fuentes propias: sigue siendo un destino válido del selector. */
    rootUsable?: boolean;
    onuserchange?: (id: string | undefined) => void;
    onusercreate?: (id: string) => Promise<void>;
  }
  let {
    context,
    theme,
    onthemechange,
    onshutdown,
    layout,
    onlayoutchange,
    palette,
    onpalettechange,
    launcher = false,
    launcherOpen = false,
    onlaunchertoggle,
    users = [],
    user = undefined,
    pinnedUser = undefined,
    rootUsable = true,
    onuserchange,
    onusercreate,
  }: Props = $props();

  let confirm = $state(false);
  const chips = $derived(context === undefined ? [] : describeChips(context));

  /**
   * El SELECTOR solo aparece cuando hay a quién elegir; el botón de CREAR está siempre, porque si no
   * un espacio sin usuarios no tendría desde dónde crear el primero. Con el servidor fijado no hay ni uno
   * ni otro: no habría nada que hacer con ellos.
   */
  const canChoose = $derived(pinnedUser === undefined);
  const showUsers = $derived(canChoose && users.length > 0);
  let creating = $state(false);
  let newUser = $state('');
  let createError = $state<string | undefined>(undefined);
  let busy = $state(false);

  const ROOT_VALUE = '';

  function pick(value: string): void {
    onuserchange?.(value === ROOT_VALUE ? undefined : value);
  }

  async function create(): Promise<void> {
    const id = newUser.trim();
    if (!isUserId(id)) {
      createError = 'Minúsculas, dígitos y guiones, sin empezar ni terminar en guión.';
      return;
    }
    busy = true;
    createError = undefined;
    try {
      await onusercreate?.(id);
      creating = false;
      newUser = '';
    } catch (caught) {
      createError = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }

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
  {#if showUsers}
    <label class="cv-header-user">
      <span class="cv-sr-only">Usuario</span>
      <select name="user" value={user ?? ROOT_VALUE} onchange={(event) => pick((event.currentTarget as HTMLSelectElement).value)}>
        {#if rootUsable}<option value={ROOT_VALUE}>Espacio de trabajo</option>{/if}
        {#each users as option (option.id)}<option value={option.id}>{option.name ?? option.id}</option>{/each}
      </select>
    </label>
  {/if}
  {#if canChoose}
    <button class="cv-button small" type="button" onclick={() => (creating = true)}>
      <Icon name="plus" size={14} weight={1.8} />Usuario
    </button>
  {:else}
    <span class="cv-chip" title="El servidor se arrancó con --user: no se puede cambiar de usuario desde aquí"><Icon name="user" size={13} weight={1.8} />{pinnedUser}</span>
  {/if}
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

<Dialog open={creating} title="Nuevo usuario" onclose={() => (creating = false)}>
  <p>Un usuario es un espacio de trabajo completo dentro de este: sus fuentes, sus salidas y su historial en <code>usuarios/&lt;id&gt;/</code>. Nace con el dataset de ejemplo.</p>
  <p class="cv-muted">No es una cuenta ni protege nada: quien tenga esta URL y su token puede abrir cualquiera de los usuarios.</p>
  <label class="cv-field">
    <span>Identificador</span>
    <input name="user-id" bind:value={newUser} placeholder="invitado1" autocomplete="off" />
  </label>
  {#if createError !== undefined}<p class="cv-error-text">{createError}</p>{/if}
  <div class="cv-dialog-actions">
    <button class="cv-button" type="button" onclick={() => (creating = false)}>Cancelar</button>
    <button class="cv-button primary" type="button" disabled={busy} onclick={create}>{busy ? 'Creando…' : 'Crear'}</button>
  </div>
</Dialog>

<Dialog open={confirm} title="¿Apagar cv serve?" onclose={() => (confirm = false)}>
  <p>La interfaz dejará de funcionar hasta que vuelvas a arrancar <code>cv serve</code>; el token de esta sesión deja de valer.</p>
  <div class="cv-dialog-actions">
    <button class="cv-button" type="button" onclick={() => (confirm = false)}>Cancelar</button>
    <button class="cv-button danger" type="button" onclick={shutdown}>Apagar</button>
  </div>
</Dialog>
