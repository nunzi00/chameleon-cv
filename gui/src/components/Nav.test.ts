import { fireEvent, render, screen } from '@testing-library/svelte';
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

  it('la cinta pinta las MISMAS pantallas en una fila, sin grupos ni portal (T-9.29)', () => {
    render(Nav, { props: { route: { page: 'generar' }, reviews: 2, collapsed: false, ontoggle: () => undefined, shape: 'ribbon' as const } });
    expect(screen.getByRole('link', { name: 'Generar' }).getAttribute('aria-current')).toBe('page');
    // Las doce pantallas siguen ahí: la organización cambia la forma, no el modelo.
    expect(screen.getAllByRole('link')).toHaveLength(12);
    expect(screen.queryByRole('link', { name: 'Portada' })).toBeNull();
    // Y el contador de revisiones se conserva: es información, no adorno de la barra.
    expect(screen.getByLabelText('2 pendientes')).toBeTruthy();
  });

  it('el lanzador pinta el mosaico por grupos y avisa al elegir, para poder cerrarse (T-9.29)', async () => {
    const onnavigate = vi.fn();
    render(Nav, { props: { route: { page: 'estado' }, reviews: 0, collapsed: false, ontoggle: () => undefined, shape: 'launcher' as const, onnavigate } });
    expect(screen.getByRole('heading', { name: 'Perfil' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Producir' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Estado del artefacto' }).getAttribute('aria-current')).toBe('page');
    (screen.getByRole('link', { name: 'Generar' }) as HTMLElement).click();
    expect(onnavigate).toHaveBeenCalled();
    // El portal sigue abriéndose fuera, también desde el mosaico.
    expect(screen.getByRole('link', { name: 'Portada' }).getAttribute('target')).toBe('_blank');
  });

  it('sin «onnavigate» el mosaico no se rompe al elegir', () => {
    render(Nav, { props: { route: { page: 'estado' }, reviews: 0, collapsed: false, ontoggle: () => undefined, shape: 'launcher' as const } });
    expect(() => (screen.getByRole('link', { name: 'Generar' }) as HTMLElement).click()).not.toThrow();
  });

  it('el raíl son iconos con el nombre en el aria-label, y se despliega desde su propio botón (T-9.30, T-9.31)', async () => {
    const ontoggle = vi.fn();
    const onnavigate = vi.fn();
    const { rerender } = render(Nav, { props: { route: { page: 'generar' }, reviews: 3, collapsed: false, ontoggle, shape: 'rail' as const, onnavigate } });
    expect(screen.getAllByRole('link')).toHaveLength(12);
    // Sin texto visible, el nombre sigue estando para quien no ve el icono.
    expect(screen.getByRole('link', { name: 'Generar' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByLabelText('3 pendientes')).toBeTruthy();

    // Plegado, el botón invita a desplegar y lo dice en su estado.
    const boton = screen.getByRole('button', { name: 'Desplegar la barra' });
    expect(boton.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(boton);
    expect(ontoggle).toHaveBeenCalled();

    // Desplegado, el mismo botón pliega, y elegir una pantalla lo cierra: es una ojeada, no un modo.
    await rerender({ route: { page: 'generar' }, reviews: 3, collapsed: false, ontoggle, shape: 'rail' as const, onnavigate, expanded: true });
    expect(screen.getByRole('button', { name: 'Plegar la barra' }).getAttribute('aria-expanded')).toBe('true');
    (screen.getByRole('link', { name: 'Salidas' }) as HTMLElement).click();
    expect(onnavigate).toHaveBeenCalled();
  });

  it('las pestañas enseñan los grupos y SOLO las pantallas del grupo actual (T-9.30)', () => {
    render(Nav, { props: { route: { page: 'generar' }, reviews: 0, collapsed: false, ontoggle: () => undefined, shape: 'tabs' as const } });
    const tabs = screen.getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual(['Perfil', 'Producir', 'Co-piloto']);
    // «Generar» vive en «Producir»: esa pestaña queda seleccionada y su grupo es el que se despliega.
    expect(tabs.find((tab) => tab.textContent === 'Producir')?.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('link', { name: 'Salidas' })).toBeTruthy();
    // Y las de otro grupo no están: es lo que hace que quepan con su nombre.
    expect(screen.queryByRole('link', { name: 'Duplicados' })).toBeNull();
  });
});
