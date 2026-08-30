<script lang="ts">
  import Dialog from './Dialog.svelte';

  interface Props {
    open: boolean;
    onclose?: () => void;
    empty?: boolean;
  }
  let { open, onclose, empty = false }: Props = $props();
</script>

<button type="button">Fuera</button>
<Dialog {open} {onclose} title="Prueba">
  {#if !empty}
    <button type="button">Cancelar</button>
    <button type="button">Confirmar</button>
  {/if}
</Dialog>
