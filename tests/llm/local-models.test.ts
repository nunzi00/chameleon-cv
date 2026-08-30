/**
 * Catálogo de modelos locales (T-8.13, docs/local-models.md §2.1): entradas coherentes y con evidencia, el defecto
 * de T-8.11, la resolución por etiqueta (con o sin `:latest`) y el modo de razonamiento por catálogo o por familia.
 */
import { describe, expect, it } from 'vitest';

import { OLLAMA_DEFAULT_MODEL, isThinkingModel, thinkParameter } from '../../src/llm/ollama';
import { HUGGINGFACE_HOST, LOCAL_DEFAULT_MODEL_ID, LOCAL_MODELS, OLLAMA_REGISTRY_HOST, describeThinking, localModel, thinkingOf } from '../../src/llm/registry';
import { isValidModelName } from '../../src/llm/runtime';

describe('catálogo de modelos locales (T-8.13)', () => {
  it('cinco entradas con etiquetas válidas y únicas, tamaños y RAM coherentes, licencia SPDX, tareas y evidencia https con fecha', () => {
    expect(LOCAL_MODELS.map((entry) => entry.id)).toEqual(['qwen3:8b', 'qwen2.5:7b-instruct', 'deepseek-r1:8b', 'gpt-oss:20b', 'qwen3:4b']);
    expect(new Set(LOCAL_MODELS.map((entry) => entry.id)).size).toBe(LOCAL_MODELS.length);
    for (const entry of LOCAL_MODELS) {
      expect(isValidModelName(entry.id), entry.id).toBe(true);
      expect(entry.downloadGiB, entry.id).toBeGreaterThan(0);
      expect(entry.minRamGiB, entry.id).toBeGreaterThanOrEqual(entry.downloadGiB);
      expect(entry.license, entry.id).toMatch(/^(Apache-2\.0|MIT)$/);
      // Sin tareas recomendadas solo con la evidencia en la nota (deepseek-r1:8b, docs/qwen3-evaluation.md §4).
      expect(entry.recommendedFor.length > 0 || entry.note.includes('sin tareas recomendadas'), entry.id).toBe(true);
      expect(entry.note, entry.id).toMatch(/\S/);
      expect(entry.sourceUrl, entry.id).toMatch(/^https:\/\/ollama\.com\/library\//);
      expect(entry.verifiedAt, entry.id).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (entry.mirror !== undefined) {
        expect(entry.mirror, entry.id).toMatch(/^hf\.co\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+-GGUF:Q4_K_M$/);
        expect(isValidModelName(entry.mirror), entry.mirror).toBe(true);
      }
    }
    expect(LOCAL_MODELS.find((entry) => entry.id === 'gpt-oss:20b')?.mirror).toBeUndefined();
    expect(OLLAMA_REGISTRY_HOST).toBe('registry.ollama.ai');
    expect(HUGGINGFACE_HOST).toBe('huggingface.co');
  });

  it('el defecto es qwen3:8b (T-8.11 D3) y coincide con el proveedor Ollama', () => {
    expect(LOCAL_DEFAULT_MODEL_ID).toBe('qwen3:8b');
    expect(OLLAMA_DEFAULT_MODEL).toBe(LOCAL_DEFAULT_MODEL_ID);
    expect(LOCAL_MODELS[0]?.id).toBe(LOCAL_DEFAULT_MODEL_ID);
  });

  it('localModel resuelve la etiqueta con o sin :latest y con espacios; fuera del catálogo, undefined', () => {
    expect(localModel('qwen3:8b')?.family).toBe('Qwen3');
    expect(localModel(' qwen3:8b:latest ')?.id).toBe('qwen3:8b');
    expect(localModel('llama3:8b')).toBeUndefined();
    expect(localModel('hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M')).toBeUndefined();
  });

  it('thinkingOf: por catálogo y, fuera de él, por la familia del nombre (también en nombres hf.co)', () => {
    expect(thinkingOf('qwen3:8b')).toBe('switchable');
    expect(thinkingOf('deepseek-r1:8b')).toBe('always');
    expect(thinkingOf('qwen2.5:7b-instruct')).toBe('none');
    expect(thinkingOf('qwen3:14b')).toBe('switchable');
    expect(thinkingOf('qwen3-coder:30b')).toBe('none');
    expect(thinkingOf('Qwen3-14B')).toBe('switchable');
    expect(thinkingOf('hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M')).toBe('switchable');
    expect(thinkingOf('hf.co/unsloth/DeepSeek-R1-0528-Qwen3-8B-GGUF:Q4_K_M')).toBe('always');
    expect(thinkingOf('deepseek-r1:1.5b')).toBe('always');
    expect(thinkingOf('qwq:32b')).toBe('always');
    expect(thinkingOf('gpt-oss:120b')).toBe('switchable');
    expect(thinkingOf('magistral:24b')).toBe('switchable');
    expect(thinkingOf('phi4-mini-reasoning')).toBe('switchable');
    expect(thinkingOf('llama3.1:8b')).toBe('none');
    expect(thinkingOf('deepseek-coder:6.7b')).toBe('none');
    expect(describeThinking('none')).toBe('sin razonamiento');
    expect(describeThinking('switchable')).toBe('razonamiento conmutable');
    expect(describeThinking('always')).toBe('razona siempre');
  });

  it('el proveedor solo envía `think` a los modelos que lo conmutan: apagado salvo que se pida', () => {
    expect(isThinkingModel('qwen3:8b')).toBe(true);
    expect(isThinkingModel('deepseek-r1:8b')).toBe(true);
    expect(isThinkingModel('qwen2.5:7b-instruct')).toBe(false);
    expect(thinkParameter('qwen3:8b', undefined)).toEqual({ think: false });
    expect(thinkParameter('qwen3:8b', true)).toEqual({ think: true });
    expect(thinkParameter('deepseek-r1:8b', true)).toEqual({});
    expect(thinkParameter('qwen2.5:7b-instruct', true)).toEqual({});
  });

  it('isValidModelName admite los GGUF de Hugging Face (usuario/repositorio con mayúsculas y cuantización) y sigue rechazando el resto', () => {
    expect(isValidModelName('hf.co/unsloth/Qwen3-8B-GGUF:Q4_K_M')).toBe(true);
    expect(isValidModelName('hf.co/unsloth/Qwen3-8B-GGUF')).toBe(true);
    expect(isValidModelName('hf.co/Qwen3-8B-GGUF:Q4_K_M')).toBe(false);
    expect(isValidModelName('huggingface.co/unsloth/Qwen3-8B-GGUF')).toBe(false);
    expect(isValidModelName('Qwen3:8b')).toBe(false);
  });
});
