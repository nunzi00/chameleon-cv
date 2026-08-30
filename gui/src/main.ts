import { mount } from 'svelte';

import App from './App.svelte';
import './app.css';
import { browserStorage } from './lib/storage';
import { applyTheme, readTheme } from './lib/theme';

// El tema guardado se aplica antes del primer render para no destellar (CSP estricta: nada en línea en el HTML).
applyTheme(document.documentElement, readTheme(browserStorage()));

const target = document.getElementById('app');
if (target === null) {
  throw new Error('Falta el contenedor #app');
}
mount(App, { target });
