import { afterEach, describe, expect, it } from 'vitest';

import { reportQuota } from '../../src/cli/output';
import { defaultQuotaLedger } from '../../src/llm';

describe('reportQuota', () => {
  afterEach(() => {
    defaultQuotaLedger.clear();
  });

  it('solo habla tras un remoto del registro con cuota leída en este proceso, y solo por stderr', () => {
    const lines: string[] = [];
    const context = { stderr: (text: string) => lines.push(text) };
    reportQuota(context, { id: 'ollama', kind: 'local' });
    reportQuota(context, { id: 'groq', kind: 'remote' });
    reportQuota(context, { id: 'openai-compatible', kind: 'remote' });
    expect(lines).toEqual([]);
    defaultQuotaLedger.record('groq', { 'x-ratelimit-remaining-requests': '28', 'x-ratelimit-limit-requests': '30', 'x-ratelimit-reset-requests': '12s' }, new Date('2026-08-30T12:00:00Z'));
    reportQuota(context, { id: 'groq', kind: 'remote' });
    expect(lines).toEqual(['Cuota según groq: quedan 28/30 peticiones (se renueva en 12 s)\n']);
  });
});
