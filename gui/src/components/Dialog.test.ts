import { render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import DialogHost from './DialogHost.fixture.svelte';

function key(target: Element | Window, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

describe('Dialog', () => {
  it('pone el foco en el primer control al abrirse y lo atrapa con Tab en ambos sentidos', () => {
    render(DialogHost, { props: { open: true } });
    const cancel = screen.getByRole('button', { name: 'Cancelar' });
    const confirm = screen.getByRole('button', { name: 'Confirmar' });
    expect(document.activeElement).toBe(cancel);
    confirm.focus();
    expect(key(window, { key: 'Tab' }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(cancel);
    expect(key(window, { key: 'Tab', shiftKey: true }).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(confirm);
    cancel.focus();
    expect(key(window, { key: 'Tab' }).defaultPrevented).toBe(false);
    expect(key(window, { key: 'a' }).defaultPrevented).toBe(false);
  });

  it('si el foco se ha escapado del diálogo, Tab lo devuelve al primer control', () => {
    render(DialogHost, { props: { open: true } });
    screen.getByRole('button', { name: 'Fuera' }).focus();
    key(window, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancelar' }));
    screen.getByRole('button', { name: 'Fuera' }).focus();
    key(window, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Confirmar' }));
  });

  it('Esc avisa a quien lo abrió; cerrado, las teclas no hacen nada', async () => {
    const onclose = vi.fn();
    const { rerender } = render(DialogHost, { props: { open: true, onclose } });
    expect(key(window, { key: 'Escape' }).defaultPrevented).toBe(true);
    expect(onclose).toHaveBeenCalledTimes(1);
    await rerender({ open: false, onclose });
    key(window, { key: 'Escape' });
    expect(onclose).toHaveBeenCalledTimes(1);
  });

  it('sin controles dentro, el foco va al propio diálogo y Tab no se intercepta', () => {
    render(DialogHost, { props: { open: true, empty: true } });
    expect(document.activeElement?.tagName).toBe('DIALOG');
    expect(key(window, { key: 'Tab' }).defaultPrevented).toBe(false);
  });
});
