import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it, vi } from 'vitest';

import SessionGate from './SessionGate.svelte';

describe('SessionGate', () => {
  it('rechaza un token implausible y entrega el válido recortado', async () => {
    const onsubmit = vi.fn();
    render(SessionGate, { props: { onsubmit } });
    const input = screen.getByLabelText('Token de sesión');
    await fireEvent.input(input, { target: { value: 'corto' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(screen.getByRole('alert').textContent).toContain('Pega el token completo');
    expect(onsubmit).not.toHaveBeenCalled();
    await fireEvent.input(input, { target: { value: '  0123456789abcdef0123  ' } });
    await fireEvent.click(screen.getByRole('button', { name: 'Entrar' }));
    expect(onsubmit).toHaveBeenCalledWith('0123456789abcdef0123');
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
