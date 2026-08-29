// Configuración del portal (T-7.1, docs/docs-portal.md). Las barras laterales de la referencia y de las
// notas de diseño las generan scripts/docs/reference.ts y scripts/docs/sync.ts en cada build.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type DefaultTheme } from 'vitepress';

const here = dirname(fileURLToPath(import.meta.url));
/** Única fuente de verdad del repositorio: package.json de la raíz (repository.url). */
const manifest = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')) as { repository: { url: string } };
const REPO = manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

function generated(name: string): DefaultTheme.SidebarItem[] {
  const file = join(here, name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as DefaultTheme.SidebarItem[]) : [];
}

export default defineConfig({
  lang: 'es-ES',
  title: 'Chameleon CV',
  description: 'Generador de CV dinámicos a partir de tus fuentes Markdown y CSV: una versión por especialidad u oferta, en Markdown o PDF, con un co-piloto de IA que sugiere y nunca decide. Todo en local.',
  base: process.env['DOCS_BASE'] ?? '/',
  srcDir: 'src',
  cleanUrls: true,
  lastUpdated: true,
  head: [['link', { rel: 'icon', type: 'image/svg+xml', href: `${process.env['DOCS_BASE'] ?? '/'}logo.svg` }]],
  markdown: {
    config(md) {
      // Sin HTML crudo: las notas de diseño y la ayuda de la CLI contienen «<nombre>» en prosa.
      md.set({ html: false });
    },
  },
  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: 'Guía', link: '/guide/quickstart', activeMatch: '/guide/' },
      { text: 'Referencia', link: '/reference/', activeMatch: '/reference/' },
      { text: 'Tutoriales', link: '/tutorials/', activeMatch: '/tutorials/' },
      { text: 'Desarrolladores', link: '/developers/architecture', activeMatch: '/developers/|/design/' },
      { text: 'Cambios', link: '/changelog' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: 'Guía de usuario',
          items: [
            { text: 'Inicio rápido', link: '/guide/quickstart' },
            { text: 'Chameleon CV en Docker', link: '/guide/docker' },
            { text: 'Conceptos', link: '/guide/concepts' },
            { text: 'Formato de las fuentes', link: '/guide/sources' },
            { text: 'Generar el CV', link: '/guide/generate' },
            { text: 'Adaptar el CV a una oferta', link: '/guide/offers' },
            { text: 'Typst y temas', link: '/guide/typst-themes' },
            { text: 'Co-piloto de IA', link: '/guide/copilot' },
            { text: 'Seguridad y privacidad', link: '/guide/security' },
            { text: 'Solución de problemas', link: '/guide/troubleshooting' },
          ],
        },
      ],
      '/reference/': generated('reference-sidebar.json'),
      '/tutorials/': [
        {
          text: 'Tutoriales',
          items: [
            { text: 'Los cuatro tutoriales', link: '/tutorials/' },
            { text: '1 · Tu perfil desde cero', link: '/tutorials/profile-from-scratch' },
            { text: '2 · Un CV para tres ofertas', link: '/tutorials/three-offers' },
            { text: '3 · Tu propio tema', link: '/tutorials/own-theme' },
            { text: '4 · El co-piloto con Ollama', link: '/tutorials/copilot-ollama' },
            { text: '5 · Todo en un contenedor', link: '/tutorials/docker' },
          ],
        },
      ],
      '/developers/': [
        {
          text: 'Desarrolladores',
          items: [
            { text: 'Visión arquitectónica', link: '/developers/architecture' },
            { text: 'Contribuir', link: '/developers/contributing' },
            { text: 'Pruebas', link: '/developers/testing' },
            { text: 'Extender Chameleon CV', link: '/developers/extending' },
            { text: 'Empaquetado y release', link: '/developers/packaging' },
            { text: 'Documentación (Docs-as-Code)', link: '/developers/docs' },
            { text: 'Plan de trabajo (ROADMAP)', link: '/developers/roadmap' },
            { text: 'Registro de decisiones', link: '/developers/decisions' },
            { text: 'Notas de diseño', link: '/design/' },
          ],
        },
      ],
      '/design/': generated('design-sidebar.json'),
    },
    search: {
      provider: 'local',
      options: {
        translations: {
          button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
          modal: {
            displayDetails: 'Mostrar detalles',
            resetButtonTitle: 'Limpiar la búsqueda',
            backButtonTitle: 'Cerrar',
            noResultsText: 'Sin resultados para',
            footer: { selectText: 'para abrir', selectKeyAriaLabel: 'intro', navigateText: 'para navegar', navigateUpKeyAriaLabel: 'flecha arriba', navigateDownKeyAriaLabel: 'flecha abajo', closeText: 'para cerrar', closeKeyAriaLabel: 'escape' },
          },
        },
      },
    },
    socialLinks: [{ icon: 'github', link: REPO }],
    editLink: { pattern: `${REPO}/edit/main/website/src/:path`, text: 'Editar esta página en GitHub' },
    footer: { message: 'Publicado bajo la licencia MIT.', copyright: '© 2026 Lucas Nunzi' },
    outline: { label: 'En esta página', level: [2, 3] },
    docFooter: { prev: 'Anterior', next: 'Siguiente' },
    lastUpdated: { text: 'Actualizado' },
    darkModeSwitchLabel: 'Apariencia',
    lightModeSwitchTitle: 'Cambiar a modo claro',
    darkModeSwitchTitle: 'Cambiar a modo oscuro',
    sidebarMenuLabel: 'Menú',
    returnToTopLabel: 'Volver arriba',
    notFound: { title: 'Página no encontrada', quote: 'Puede que la página se haya movido o que el enlace esté mal escrito.', linkText: 'Ir al inicio', linkLabel: 'ir al inicio', code: '404' },
  },
});
