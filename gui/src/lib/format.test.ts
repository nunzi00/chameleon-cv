import { describe, expect, it } from 'vitest';

import { formatBytes, formatDateTime, plural } from './format';

describe('formato', () => {
  it('bytes, fechas en es-ES y plurales', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(20480)).toBe('20 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
    expect(formatDateTime(Date.UTC(2026, 7, 29, 12, 0, 0))).toMatch(/2026/);
    expect(plural(1, 'fichero', 'ficheros')).toBe('1 fichero');
    expect(plural(3, 'fichero', 'ficheros')).toBe('3 ficheros');
  });
});
