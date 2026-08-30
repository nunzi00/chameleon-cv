import { fireEvent, render, screen } from '@testing-library/svelte';
import { describe, expect, it } from 'vitest';

import TagPicker from './TagPicker.svelte';

describe('TagPicker', () => {
  it('añade y quita etiquetas al pulsarlas y las agrupa por categoría', async () => {
    const groups = [
      { label: 'language', options: [{ value: 'PHP', label: 'PHP' }, { value: 'Python', label: 'Python' }] },
      { label: '', options: [{ value: 'proj-a', label: 'Proyecto A' }] },
    ];
    render(TagPicker, { props: { name: 'Skills', groups, selected: ['Python'] } });
    expect(screen.getByRole('group', { name: 'Skills' })).toBeTruthy();
    expect(screen.getByText('language')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Python/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'PHP' }).getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(screen.getByRole('button', { name: 'PHP' }));
    expect(screen.getByRole('button', { name: /PHP/ }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: /Python/ }));
    expect(screen.getByRole('button', { name: 'Python' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Proyecto A' })).toBeTruthy();
  });
});
