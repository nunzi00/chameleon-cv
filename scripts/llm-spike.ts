/**
 * Spike T-4.2 (no es un comando de usuario): demuestra el flujo completo con un modelo local real.
 *   seleccionar un logro → seudonimizar (redact) → enviar al proveedor local → validar el JSON → propuestas.
 *
 * Uso: npm run llm:spike -- <directorio-dataset> <id-logro> [término-de-oferta ...]
 * Proveedor por CHAMELEON_LLM_PROVIDER / CHAMELEON_LLM_BASE_URL / CHAMELEON_LLM_MODEL (solo loopback).
 */
import { resolve } from 'node:path';

import { createProvider, formatLlmStatus, llmStatus, resolveLlmConfig } from '../src/llm';
import { buildImproveFragment, loadPrompt, runImprove } from '../src/llm/tasks/improve';
import { NodeFileSystem, defaultSourceParsers, loadDataset } from '../src/parsers';

async function main(argv: readonly string[]): Promise<number> {
  const [datasetDirectory, achievementId, ...offerTerms] = argv;
  if (datasetDirectory === undefined || achievementId === undefined) {
    process.stderr.write('Uso: npm run llm:spike -- <directorio-dataset> <id-logro> [término-de-oferta ...]\n');
    return 2;
  }
  const dataset = await loadDataset(resolve(datasetDirectory), { fileSystem: new NodeFileSystem(), parsers: defaultSourceParsers() });
  if (!dataset.ok) {
    process.stderr.write(`Dataset inválido: ${dataset.errors.map((error) => error.message).join('; ')}\n`);
    return 1;
  }

  process.stdout.write(formatLlmStatus(await llmStatus()));
  const config = resolveLlmConfig();
  if (!config.ok) {
    process.stderr.write(`${config.message}\n`);
    return 2;
  }
  const provider = createProvider(config.config);

  const fragment = buildImproveFragment(dataset.profile, achievementId, { offerTerms, redactCompanies: true });
  if (fragment === undefined) {
    process.stderr.write(`No existe el logro «${achievementId}»\n`);
    return 1;
  }
  process.stdout.write('\n== Lo que sale hacia el modelo (fragmento seudonimizado, canon C4):\n');
  process.stdout.write(`${JSON.stringify(fragment.input, null, 2)}\n`);
  process.stdout.write(`Seudónimos: ${[...fragment.redaction.table.keys()].join(', ') || 'ninguno'}\n`);

  const prompt = await loadPrompt();
  process.stdout.write(`\n== Enviando a ${provider.id} (${provider.baseUrl}, modelo ${provider.model}), prompt ${'improve.v1'}…\n`);
  const result = await runImprove(provider, fragment, prompt);
  if (!result.ok) {
    process.stderr.write(`Fallo (${result.code}): ${result.message}\n`);
    return 2;
  }
  process.stdout.write(`\n== Respuesta validada con zod en ${result.elapsedMs} ms · modelo ${result.model} · tokens ${result.usage.promptTokens ?? '?'} + ${result.usage.completionTokens ?? '?'}\n`);
  process.stdout.write(`JSON bruto: ${result.raw}\n\n`);
  const original = fragment.redaction.restore(fragment.input.text);
  process.stdout.write(`Original : ${original}\n`);
  result.proposals.forEach((proposal, index) => {
    process.stdout.write(`Propuesta ${index + 1}: ${proposal.text}\n   motivo: ${proposal.rationale}\n`);
    // Comprobación informativa del canon C2 (el verificador completo llega en T-4.3): cifras nuevas.
    const numbers = (text: string): string[] => text.match(/\d+(?:[.,]\d+)?/g) ?? [];
    const invented = numbers(proposal.text).filter((number) => !numbers(original).includes(number));
    process.stdout.write(`   cifras nuevas (C2): ${invented.length === 0 ? 'ninguna ✓' : invented.join(', ') + ' ✗'}\n`);
  });
  return 0;
}

void main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
