<script setup lang="ts">
// Portada (docs/gui-design/pantallas.md §8): el hero del tema (nombre, texto, acciones y captura real de la app)
// se completa por ranuras con el chip «Local y soberano», los tres comandos y, tras el hero, los bloques
// «Qué hace / Qué no hace», «Tres caminos» y «Temas». Las páginas interiores usan el layout tal cual.
import DefaultTheme from 'vitepress/theme-without-fonts';

import HomeBlocks from './HomeBlocks.vue';

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #home-hero-info-before>
      <p class="cv-home-chip"><span class="cv-home-dot" aria-hidden="true"></span>Local y soberano · sin cuenta, sin telemetría</p>
    </template>
    <template #home-hero-actions-after>
      <pre class="cv-home-commands" aria-label="Tres comandos para empezar"><code>cv init                     <span class="cv-home-comment"># crea data/sources/ con un dataset de ejemplo</span>
cv build                    <span class="cv-home-comment"># compila y valida: data/dist/profile.json</span>
cv generate-cv -s backend   <span class="cv-home-comment"># output/cv-&lt;nombre&gt;-backend.md (o --format pdf)</span></code></pre>
    </template>
    <template #home-features-after>
      <HomeBlocks />
    </template>
  </Layout>
</template>
