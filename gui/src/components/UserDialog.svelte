<script lang="ts">
  /**
   * Crear un usuario del espacio de trabajo (T-9.32). Vive en su propio componente y se carga **bajo
   * demanda**: es un diálogo que se abre de higos a brevas y no tiene por qué viajar en el paquete que
   * pinta la primera pantalla (presupuesto de 30 KB gzip).
   */
  import { isUserId } from '../lib/user-id';
  import Dialog from './Dialog.svelte';

  interface Props {
    onclose: () => void;
    oncreate: (id: string) => Promise<void>;
  }
  let { onclose, oncreate }: Props = $props();

  let id = $state('');
  let error = $state<string | undefined>(undefined);
  let busy = $state(false);

  async function create(): Promise<void> {
    const trimmed = id.trim();
    if (!isUserId(trimmed)) {
      error = 'Minúsculas, dígitos y guiones, sin empezar ni terminar en guión.';
      return;
    }
    busy = true;
    error = undefined;
    try {
      await oncreate(trimmed);
      onclose();
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    } finally {
      busy = false;
    }
  }
</script>

<Dialog open title="Nuevo usuario" {onclose}>
  <p>Un usuario es un espacio de trabajo completo dentro de este: sus fuentes, sus salidas y su historial en <code>usuarios/&lt;id&gt;/</code>. Nace con el dataset de ejemplo.</p>
  <p class="cv-muted">No es una cuenta ni protege nada: quien tenga esta URL y su token puede abrir cualquiera de los usuarios.</p>
  <label class="cv-field">
    <span>Identificador</span>
    <input name="user-id" bind:value={id} placeholder="invitado1" autocomplete="off" />
  </label>
  {#if error !== undefined}<p class="cv-error-text">{error}</p>{/if}
  <div class="cv-dialog-actions">
    <button class="cv-button" type="button" onclick={onclose}>Cancelar</button>
    <button class="cv-button primary" type="button" disabled={busy} onclick={create}>{busy ? 'Creando…' : 'Crear'}</button>
  </div>
</Dialog>
