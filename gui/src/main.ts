import { mount } from 'svelte';

import App from './App.svelte';
import './app.css';
import { browserStorage } from './lib/storage';
import { applyTheme, readTheme } from './lib/theme';
import { applyUiLayout, readUiLayout } from './lib/ui-layout';

// El tema y la ORGANIZACIÓN guardados se aplican antes del primer render para no destellar (CSP estricta: nada
// en línea en el HTML). Sin esto, cambiar de organización se vería como un salto de la carcasa al cargar.
const stored = browserStorage();
applyTheme(document.documentElement, readTheme(stored));
applyUiLayout(document.documentElement, readUiLayout(stored));

const target = document.getElementById('app');
if (target === null) {
  throw new Error('Falta el contenedor #app');
}
mount(App, { target });
