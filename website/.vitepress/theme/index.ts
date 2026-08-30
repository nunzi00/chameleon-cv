// Tema del portal (T-7.1; rediseño T-8.6 S4, docs/gui-design/pantallas.md §8–§9): el tema por defecto de VitePress
// sin su fuente descargada (Inter) —solo fuentes del sistema, «sin recursos externos»— con la paleta y los
// componentes del sistema visual de la aplicación, y una portada compuesta con las ranuras del tema.
import DefaultTheme from 'vitepress/theme-without-fonts';
import type { Theme } from 'vitepress';

import Layout from './Layout.vue';
import './custom.css';

const theme: Theme = {
  extends: DefaultTheme,
  Layout,
};

export default theme;
