<script lang="ts">
  interface Props {
    label: string;
    when: string;
  }
  let { label, when }: Props = $props();
</script>

<section class="cv-card">
  <h2>{label}</h2>
  <p class="cv-muted">Esta pantalla llega con {when}. Mientras tanto, la CLI hace lo mismo: consulta la guía del portal.</p>
</section>
