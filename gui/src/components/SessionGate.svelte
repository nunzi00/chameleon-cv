<script lang="ts">
  import Icon from './Icon.svelte';
  import { isPlausibleToken } from '../lib/session';

  interface Props {
    onsubmit: (token: string) => void;
    /** `expired`: la sesión dejó de valer (401) mientras se usaba la interfaz. */
    reason?: 'expired' | undefined;
  }
  let { onsubmit, reason = undefined }: Props = $props();
  let value = $state('');
  let error = $state<string | undefined>(undefined);

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    if (!isPlausibleToken(value)) {
      error = 'Pega el token completo que imprimió cv serve (sin espacios).';
      return;
    }
    error = undefined;
    onsubmit(value.trim());
  }
</script>

<section class="cv-gate" aria-labelledby="cv-gate-title">
  <div class="cv-card cv-card-tight cv-gate-card">
    <div class="cv-gate-brand"><Icon name="brand" size={26} /><span>Chameleon CV</span></div>
    {#if reason === 'expired'}
      <h1 id="cv-gate-title">La sesión ha caducado</h1>
      <p>
        El servidor <code>cv serve</code> ya no acepta el token de esta pestaña: se ha apagado, se ha vuelto a arrancar (cada arranque emite un token nuevo) o el token se retiró. Nada de lo que tenías abierto se ha perdido en el disco: las fuentes y <code>output/</code> siguen donde estaban.
      </p>
    {:else}
      <h1 id="cv-gate-title">Entrar</h1>
      <p>Esta interfaz habla con el servidor local <code>cv serve</code> y necesita su <strong>token de sesión</strong>. Abre la URL que imprimió <code>cv serve</code> (lleva el token en <code>#token=…</code>) o pégalo aquí.</p>
    {/if}
    <div class="cv-command"><code>$ cv serve</code><span class="cv-muted">imprime la URL con el token</span></div>
    <form onsubmit={submit}>
      <label class="cv-field">
        <span>Token de sesión</span>
        <input name="token" type="password" autocomplete="off" class="mono" bind:value required />
      </label>
      {#if error !== undefined}<p class="cv-notice error" role="alert">{error}</p>{/if}
      <div class="cv-actions"><button class="cv-button primary" type="submit">Entrar</button></div>
    </form>
    <p class="cv-muted cv-gate-note">El token nunca se envía a otro sitio: vive en esta pestaña y se retira de la URL al cargar.</p>
  </div>
</section>
