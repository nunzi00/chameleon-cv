import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import Nav from './Nav.svelte';

describe('Nav', () => {
  it('marca la pantalla actual, agrupa las siete pantallas y enlaza el portal en otra pestaña', () => {
    render(Nav, { props: { route: { page: 'generar' }, reviews: 0, collapsed: false, ontoggle: () => undefined } });
    expect(screen.getByRole('link', { name: 'Generar' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Estado del artefacto' }).getAttribute('aria-current')).toBeNull();
    const app = ['Fuentes', 'Estado del artefacto', 'Generar', 'Salidas', 'Trabajos', 'Revisiones', 'Ajustes'];
    expect(app.map((name) => screen.getByRole('link', { name }).getAttribute('href'))).toEqual([
      '#/fuentes', '#/estado', '#/generar', '#/salidas', '#/copiloto', '#/revisiones', '#/ajustes',
    ]);
    const portal = screen.getByRole('link', { name: 'Portada' });
    expect(portal.getAttribute('title')).toBe('Portada (portal, nueva pestaña)');
    expect(portal.getAttribute('target')).toBe('_blank');
    expect(portal.getAttribute('rel')).toBe('noopener');
    expect(screen.queryByText('2')).toBeNull();
  });

  it('muestra el contador de revisiones pendientes solo cuando hay alguna', () => {
    render(Nav, { props: { route: { page: 'estado' }, reviews: 2, collapsed: false, ontoggle: () => undefined } });
    expect(screen.getByLabelText('2 pendientes').textContent).toBe('2');
  });

  it('el botón de plegar refleja el estado y avisa al pulsarlo', async () => {
    const ontoggle = vi.fn();
    render(Nav, { props: { route: { page: 'estado' }, reviews: 0, collapsed: true, ontoggle } });
    const button = screen.getByRole('button', { name: 'Plegar a iconos' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(button.getAttribute('title')).toBe('Desplegar la barra');
    button.click();
    expect(ontoggle).toHaveBeenCalledTimes(1);
  });
});
