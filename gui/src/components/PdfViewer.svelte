<script lang="ts">
  /** El PDF en el visor del navegador (docs/gui-mvp.md §4.4): bytes descargados con el token → blob: → iframe. */
  interface Props {
    blob: Blob;
    name: string;
  }
  let { blob, name }: Props = $props();
  let url = $state<string | undefined>(undefined);

  $effect(() => {
    const created = URL.createObjectURL(blob);
    url = created;
    return () => {
      URL.revokeObjectURL(created);
    };
  });
</script>

<div class="cv-pdf">
  {#if url !== undefined}
    <p class="cv-actions"><a class="cv-button" href={url} download={name}>Descargar {name}</a></p>
    <iframe title={`Vista previa de ${name}`} src={url}></iframe>
  {/if}
</div>
