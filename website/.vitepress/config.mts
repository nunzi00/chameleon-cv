// Configuración del portal (T-7.1, docs/docs-portal.md). Las barras laterales de la referencia y de las
// notas de diseño las generan scripts/docs/reference.ts y scripts/docs/sync.ts en cada build.
// Dos idiomas desde T-9.7: castellano en la raíz (es la lengua en la que se escribe el proyecto) e inglés
// bajo /en/. Lo que todavía no está traducido NO se enlaza desde el inglés como si lo estuviera: se enlaza
// marcado «(es)», que es honesto y evita que alguien crea que ha llegado a una página en su idioma.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig, type DefaultTheme } from 'vitepress';

const here = dirname(fileURLToPath(import.meta.url));
/** Única fuente de verdad del repositorio: package.json de la raíz (repository.url). */
const manifest = JSON.parse(readFileSync(join(here, '..', '..', 'package.json'), 'utf8')) as { repository: { url: string }; version: string };
const REPO = manifest.repository.url.replace(/^git\+/, '').replace(/\.git$/, '');

function generated(name: string): DefaultTheme.SidebarItem[] {
  const file = join(here, name);
  return existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as DefaultTheme.SidebarItem[]) : [];
}

const searchTranslations = {
  es: {
    button: { buttonText: 'Buscar', buttonAriaLabel: 'Buscar' },
    modal: {
      displayDetails: 'Mostrar detalles',
      resetButtonTitle: 'Limpiar la búsqueda',
      backButtonTitle: 'Cerrar',
      noResultsText: 'Sin resultados para',
      footer: { selectText: 'para abrir', selectKeyAriaLabel: 'intro', navigateText: 'para navegar', navigateUpKeyAriaLabel: 'flecha arriba', navigateDownKeyAriaLabel: 'flecha abajo', closeText: 'para cerrar', closeKeyAriaLabel: 'escape' },
    },
  },
};

export default defineConfig({
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
    socialLinks: [{ icon: 'github', link: REPO }],
    search: { provider: 'local', options: { locales: searchTranslations } },
  },
  locales: {
    root: {
      label: 'Español',
      lang: 'es-ES',
      themeConfig: {
        nav: [
          { text: 'Guía', link: '/guide/quickstart', activeMatch: '/guide/' },
          { text: 'Referencia', link: '/reference/', activeMatch: '/reference/' },
          { text: 'Tutoriales', link: '/tutorials/', activeMatch: '/tutorials/' },
          { text: 'Desarrolladores', link: '/developers/architecture', activeMatch: '/developers/|/design/' },
          { text: 'Cambios', link: '/changelog' },
          { text: `v${manifest.version} · MIT`, link: `${REPO}/releases/tag/v${manifest.version}` },
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
                { text: 'Importar un CV que ya tienes', link: '/guide/import' },
                { text: 'Generar el CV', link: '/guide/generate' },
                { text: 'Adaptar el CV a una oferta', link: '/guide/offers' },
                { text: 'Typst y temas', link: '/guide/typst-themes' },
                { text: 'Galería de temas', link: '/guide/theme-gallery' },
                { text: 'Co-piloto de IA', link: '/guide/copilot' },
                { text: 'Configurar el co-piloto', link: '/guide/copilot-settings' },
                { text: 'La interfaz web', link: '/guide/web' },
                { text: 'Varias personas, un espacio', link: '/guide/users' },
                { text: 'Exportar e importar el perfil', link: '/guide/portability' },
                { text: 'La API local (cv serve)', link: '/guide/api' },
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
                { text: 'Los seis tutoriales', link: '/tutorials/' },
                { text: '1 · Tu perfil desde cero', link: '/tutorials/profile-from-scratch' },
                { text: '2 · Un CV para tres ofertas', link: '/tutorials/three-offers' },
                { text: '3 · Tu propio tema', link: '/tutorials/own-theme' },
                { text: '4 · El co-piloto con Ollama', link: '/tutorials/copilot-ollama' },
                { text: '5 · Todo en un contenedor', link: '/tutorials/docker' },
                { text: '6 · La API desde la terminal', link: '/tutorials/api' },
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
        editLink: { pattern: `${REPO}/edit/main/website/src/:path`, text: 'Editar esta página en GitHub' },
        footer: { message: 'MIT · sin telemetría · es-ES', copyright: '© 2026 Lucas Nunzi' },
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
    },
    en: {
      label: 'English',
      lang: 'en-US',
      link: '/en/',
      description: 'Build tailored CVs from Markdown and CSV sources: one version per specialty or per job offer, in Markdown or PDF, with an AI co-pilot that suggests and never decides. Everything runs locally.',
      themeConfig: {
        nav: [
          { text: 'Guide', link: '/en/guide/quickstart', activeMatch: '/en/guide/' },
          { text: 'Command reference', link: '/reference/' },
          { text: 'Tutorials', link: '/en/tutorials/', activeMatch: '/en/tutorials/' },
          { text: 'Changelog', link: '/changelog' },
          { text: `v${manifest.version} · MIT`, link: `${REPO}/releases/tag/v${manifest.version}` },
        ],
        sidebar: {
          '/en/': [
            {
              text: 'User guide',
              items: [
                { text: 'Quickstart', link: '/en/guide/quickstart' },
                { text: 'Concepts', link: '/en/guide/concepts' },
                { text: 'Source format', link: '/en/guide/sources' },
                { text: 'Importing an existing CV', link: '/en/guide/import' },
                { text: 'Generating the CV', link: '/en/guide/generate' },
                { text: 'Tailoring to a job offer', link: '/en/guide/offers' },
                { text: 'Typst and themes', link: '/en/guide/typst-themes' },
                { text: 'AI co-pilot', link: '/en/guide/copilot' },
                { text: 'Configuring the co-pilot', link: '/en/guide/copilot-settings' },
                { text: 'The web interface', link: '/en/guide/web' },
                { text: 'Several people, one workspace', link: '/en/guide/users' },
                { text: 'The local API', link: '/en/guide/api' },
                { text: 'Docker', link: '/en/guide/docker' },
                { text: 'Export and import', link: '/en/guide/portability' },
                { text: 'Security and privacy', link: '/en/guide/security' },
                { text: 'Troubleshooting', link: '/en/guide/troubleshooting' },
              ],
            },
            {
              text: 'Tutorials',
              items: [
                { text: 'All six tutorials', link: '/en/tutorials/' },
                { text: '1 · Your profile from scratch', link: '/en/tutorials/profile-from-scratch' },
                { text: '2 · One CV for three offers', link: '/en/tutorials/three-offers' },
                { text: '3 · Your own theme', link: '/en/tutorials/own-theme' },
                { text: '4 · The co-pilot with Ollama', link: '/en/tutorials/copilot-ollama' },
                { text: '5 · Everything in a container', link: '/en/tutorials/docker' },
                { text: '6 · The API from the terminal', link: '/en/tutorials/api' },
              ],
            },
            {
              // Se enlaza marcado «(es)» a propósito: prometer una página en inglés que no existe es peor que
              // decir en qué idioma está. Cada página traducida sale de aquí y entra arriba (T-9.7).
              // Lo que queda aquí no es deuda de traducción sino contenido GENERADO: la referencia sale de la
              // ayuda de la CLI, que habla castellano por decisión del PO (31-ago-2026), y la galería de temas
              // se genera de los theme.toml. Las notas de diseño son documentación interna del proyecto.
              text: 'Generated or internal (Spanish)',
              items: [
                { text: 'Command reference (es)', link: '/reference/' },
                { text: 'Theme gallery (es)', link: '/guide/theme-gallery' },
                { text: 'Architecture (es)', link: '/developers/architecture' },
              ],
            },
          ],
        },
        editLink: { pattern: `${REPO}/edit/main/website/src/:path`, text: 'Edit this page on GitHub' },
        footer: { message: 'MIT · no telemetry · en-US', copyright: '© 2026 Lucas Nunzi' },
        outline: { label: 'On this page', level: [2, 3] },
        docFooter: { prev: 'Previous', next: 'Next' },
        lastUpdated: { text: 'Updated' },
        notFound: { title: 'Page not found', quote: 'The page may have moved, or the link may be misspelled.', linkText: 'Go home', linkLabel: 'go home', code: '404' },
      },
    },
  },
});
