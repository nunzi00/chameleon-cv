<script lang="ts">
  import { isPlausibleToken } from '../lib/session';

  interface Props {
    onsubmit: (token: string) => void;
  }
  let { onsubmit }: Props = $props();
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

<section class="cv-card cv-gate" aria-labelledby="cv-gate-title">
  <h1 id="cv-gate-title">Chameleon CV</h1>
  <p>Esta interfaz habla con el servidor local <code>cv serve</code> y necesita su <strong>token de sesión</strong>. Abre la URL que imprimió <code>cv serve</code> (lleva el token en <code>#token=…</code>) o pégalo aquí.</p>
  <form onsubmit={submit}>
    <label class="cv-field">
      <span>Token de sesión</span>
      <input name="token" type="password" autocomplete="off" bind:value required />
    </label>
    {#if error !== undefined}<p class="cv-notice error" role="alert">{error}</p>{/if}
    <button class="cv-button primary" type="submit">Entrar</button>
  </form>
</section>
