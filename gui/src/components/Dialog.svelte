<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    open: boolean;
    title: string;
    /** Esc cierra el diálogo a través de quien lo abrió (si no se pasa, Esc no hace nada). */
    onclose?: (() => void) | undefined;
    children: Snippet;
  }
  let { open, title, onclose, children }: Props = $props();

  let element = $state<HTMLDialogElement | undefined>(undefined);
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusables(): readonly HTMLElement[] {
    return element === undefined ? [] : [...element.querySelectorAll<HTMLElement>(FOCUSABLE)];
  }

  // Foco inicial seguro: el primer control (Cancelar va primero en las acciones) o el propio diálogo.
  $effect(() => {
    if (open && element !== undefined) {
      (focusables()[0] ?? element).focus();
    }
  });

  // Foco atrapado: Tab y Mayús+Tab circulan dentro del diálogo; Esc cierra.
  function onkeydown(event: KeyboardEvent): void {
    if (!open || element === undefined) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      onclose?.();
      return;
    }
    if (event.key !== 'Tab') {
      return;
    }
    const items = focusables();
    const first = items[0];
    const last = items.at(-1);
    if (first === undefined || last === undefined) {
      return;
    }
    const active = document.activeElement;
    if (event.shiftKey && (active === first || !element.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (active === last || !element.contains(active))) {
      event.preventDefault();
      first.focus();
    }
  }
</script>

<svelte:window onkeydown={onkeydown} />

{#if open}
  <dialog bind:this={element} open aria-labelledby="cv-dialog-title" aria-modal="true" tabindex="-1">
    <h2 id="cv-dialog-title">{title}</h2>
    {@render children()}
  </dialog>
{/if}
