<script setup lang="ts">
// Bloques de la portada (pantallas.md §8): «Qué hace / Qué no hace» responde en diez segundos; «Tres caminos»
// (binario, Docker, galería) y «Temas» con cuatro miniaturas reales de la galería (generadas por npm run docs:themes).
import { withBase } from 'vitepress';

const DOES = [
  ['Un perfil, muchos CV', 'Fuentes Markdown y CSV validadas; una versión por especialidad o por oferta.'],
  ['PDF de calidad editorial', 'Typst con veintisiete temas (organizaciones y estilos) o pdfkit sin dependencias.'],
  ['Adecuación a la oferta', 'Puntuación transparente: qué demuestras, qué te falta y qué se conserva en el CV.'],
  ['Co-piloto que sugiere', 'Reescrituras, resúmenes y etiquetas verificados por código; nunca escribe tus fuentes solo.'],
] as const;

const DOES_NOT = [
  ['No inventa', 'Cada cifra y cada logro salen de tus fuentes; lo que el modelo no puede probar se rechaza.'],
  ['No sale de tu máquina', 'Sin cuenta ni telemetría; un proveedor remoto solo con clave y consentimiento por envío.'],
  ['No toca tus fuentes sin pedirlo', 'Las propuestas se aplican desde una revisión y cada versión anterior queda en el histórico.'],
  ['No exige internet', 'La única red del producto es descargar Typst o un modelo local cuando tú lo pides.'],
] as const;

const PATHS = [
  { n: '1', title: 'Ejecutable', text: 'Un único fichero para linux-x64 con sha256 y atestación de procedencia.', code: 'tar -xzf chameleon-cv-*-linux-x64.tar.gz && ./cv init', link: '/guide/quickstart', label: 'Inicio rápido' },
  { n: '2', title: 'Docker', text: 'Imagen firmada, multi-arch, sin red por defecto; Ollama opcional con Compose.', code: 'docker compose run --rm chameleon-cv init', link: '/guide/docker', label: 'Guía de Docker' },
  { n: '3', title: 'Galería', text: 'Veintisiete temas: nueve organizaciones del contenido y dieciocho estilos.', code: 'cv generate-cv --format pdf --engine typst --theme functional', link: '/guide/theme-gallery', label: 'Ver la galería' },
] as const;

const THEMES = [
  { name: 'default', text: 'Referencia sobria, versalitas y fechas a la derecha.' },
  { name: 'functional', text: 'Competencias y logros primero; trayectoria al final.' },
  { name: 'modern', text: 'Franja de acento y columna lateral con contacto y skills.' },
] as const;
</script>

<template>
  <section class="cv-home-section" aria-labelledby="cv-home-what">
    <h2 id="cv-home-what" class="cv-home-title">Qué hace y qué no hace</h2>
    <div class="cv-home-grid-2">
      <article class="cv-home-card">
        <h3 class="cv-home-card-title">Qué hace</h3>
        <ul class="cv-home-list">
          <li v-for="[lead, text] in DOES" :key="lead"><span class="cv-home-mark ok" aria-hidden="true">✓</span><span><strong>{{ lead }}</strong> <span class="cv-home-muted">{{ text }}</span></span></li>
        </ul>
      </article>
      <article class="cv-home-card">
        <h3 class="cv-home-card-title">Qué no hace</h3>
        <ul class="cv-home-list">
          <li v-for="[lead, text] in DOES_NOT" :key="lead"><span class="cv-home-mark no" aria-hidden="true">✕</span><span><strong>{{ lead }}</strong> <span class="cv-home-muted">{{ text }}</span></span></li>
        </ul>
      </article>
    </div>
  </section>

  <section class="cv-home-section" aria-labelledby="cv-home-paths">
    <h2 id="cv-home-paths" class="cv-home-title">Tres caminos</h2>
    <div class="cv-home-grid-3">
      <article v-for="path in PATHS" :key="path.n" class="cv-home-card">
        <span class="cv-home-number" aria-hidden="true">{{ path.n }}</span>
        <h3 class="cv-home-card-title">{{ path.title }}</h3>
        <p class="cv-home-muted">{{ path.text }}</p>
        <code class="cv-home-code">{{ path.code }}</code>
        <a class="cv-home-link" :href="withBase(path.link)">{{ path.label }} →</a>
      </article>
    </div>
  </section>

  <section class="cv-home-section" aria-labelledby="cv-home-themes">
    <h2 id="cv-home-themes" class="cv-home-title">Temas</h2>
    <div class="cv-home-grid-4">
      <a v-for="theme in THEMES" :key="theme.name" class="cv-home-card cv-home-theme" :href="withBase(`/guide/theme-gallery#${theme.name}`)">
        <img class="cv-home-thumb" :src="withBase(`/themes/${theme.name}.png`)" :alt="`Primera página del CV de ejemplo con el tema ${theme.name}`" loading="lazy" width="794" height="1123" />
        <code class="cv-home-theme-name">{{ theme.name }}</code>
        <p class="cv-home-muted">{{ theme.text }}</p>
      </a>
      <a class="cv-home-card cv-home-theme cv-home-theme-yours" :href="withBase('/guide/typst-themes')">
        <span class="cv-home-thumb cv-home-thumb-empty" aria-hidden="true">+</span>
        <code class="cv-home-theme-name">el tuyo</code>
        <p class="cv-home-muted">Copia cualquiera con <code>cv theme create mio --from functional</code> y ajusta colores, fuentes o maquetación.</p>
      </a>
    </div>
  </section>
</template>
