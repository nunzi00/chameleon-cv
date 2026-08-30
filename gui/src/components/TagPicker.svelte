<script lang="ts">
  /**
   * Selector múltiple en forma de etiquetas: cada opción es un botón que se añade o se quita al pulsarlo (aria-pressed),
   * agrupadas por categoría cuando la hay. Sin dependencias; el valor seleccionado se enlaza con bind:selected.
   */
  export interface TagOption {
    readonly value: string;
    readonly label: string;
  }
  export interface TagGroup {
    readonly label: string;
    readonly options: readonly TagOption[];
  }
  let { name, groups, selected = $bindable([]) }: { name: string; groups: readonly TagGroup[]; selected: string[] } = $props();

  function toggle(value: string): void {
    selected = selected.includes(value) ? selected.filter((item) => item !== value) : [...selected, value];
  }
</script>

<div class="cv-tags" role="group" aria-label={name}>
  {#each groups as group (group.label)}
    <div class="cv-tags-group">
      {#if group.label !== ''}<span class="cv-tags-label">{group.label}</span>{/if}
      {#each group.options as option (option.value)}
        <button type="button" class="cv-tag" class:selected={selected.includes(option.value)} aria-pressed={selected.includes(option.value)} onclick={() => toggle(option.value)}>
          {option.label}{#if selected.includes(option.value)}<span class="cv-tag-remove" aria-hidden="true">×</span>{/if}
        </button>
      {/each}
    </div>
  {/each}
</div>
