/**
 * `cv typst status` (T-3.3): qué binario usaría `--engine typst`, con qué versión y de dónde
 * sale, evaluando cada candidato en el orden de prioridad de `locateTypst`.
 */
import { homedir } from 'node:os';

import {
  TYPST_ENV_VARIABLE,
  TYPST_VERSION,
  cachedBinaryPath,
  containedEnvironment,
  isExecutableFile,
  runProcess,
  typstVersion,
  type LocateOptions,
  type ProcessRunner,
  type TypstSource,
} from '../renderers/typst/engine';
import { findInPath } from './extract';

export type CandidateState = 'unset' | 'missing' | 'ok' | 'mismatch' | 'broken';

export interface CandidateStatus {
  readonly source: TypstSource;
  readonly path: string | undefined;
  readonly state: CandidateState;
  readonly version?: string;
  readonly message?: string;
}

export interface TypstStatus {
  readonly required: string;
  readonly candidates: readonly CandidateStatus[];
  /** El que usaría `locateTypst`: el primer ejecutable, tenga o no la versión requerida. */
  readonly selected: CandidateStatus | undefined;
  readonly usable: boolean;
}

export interface StatusOptions extends LocateOptions {
  readonly runner?: ProcessRunner | undefined;
}

const SOURCE_LABELS: Readonly<Record<TypstSource, string>> = {
  option: '--typst-path',
  env: TYPST_ENV_VARIABLE,
  cache: 'caché de usuario',
  path: 'PATH',
};

async function evaluate(source: TypstSource, path: string | undefined, isExecutable: (path: string) => Promise<boolean>, runner: ProcessRunner, env: NodeJS.ProcessEnv): Promise<CandidateStatus> {
  if (path === undefined) {
    return { source, path, state: 'unset' };
  }
  if (!(await isExecutable(path))) {
    return { source, path, state: 'missing' };
  }
  const version = await typstVersion(path, runner, env);
  if (!version.ok) {
    return { source, path, state: 'broken', message: version.message };
  }
  return { source, path, state: version.version === TYPST_VERSION ? 'ok' : 'mismatch', version: version.version };
}

export async function typstStatus(options: StatusOptions = {}): Promise<TypstStatus> {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const home = options.home ?? homedir();
  const isExecutable = options.isExecutable ?? isExecutableFile;
  const runner = options.runner ?? runProcess;
  const childEnvironment = containedEnvironment(platform, env);

  const fromEnv = env[TYPST_ENV_VARIABLE];
  const inPath = await findInPath('typst', env, platform, isExecutable);

  const candidates = [
    await evaluate('option', options.explicitPath, isExecutable, runner, childEnvironment),
    await evaluate('env', fromEnv === undefined || fromEnv === '' ? undefined : fromEnv, isExecutable, runner, childEnvironment),
    await evaluate('cache', cachedBinaryPath(env, platform, home), isExecutable, runner, childEnvironment),
    inPath === undefined ? { source: 'path' as const, path: undefined, state: 'missing' as const } : await evaluate('path', inPath, isExecutable, runner, childEnvironment),
  ];
  const selected = candidates.find((candidate) => candidate.state === 'ok' || candidate.state === 'mismatch' || candidate.state === 'broken');
  return { required: TYPST_VERSION, candidates, selected, usable: selected?.state === 'ok' };
}

function describeCandidate(candidate: CandidateStatus): string {
  switch (candidate.state) {
    case 'unset':
      return candidate.source === 'env' ? 'no definida' : 'no indicado';
    case 'missing':
      return candidate.path === undefined ? 'no encontrado' : `${candidate.path} (no existe o no es ejecutable)`;
    case 'ok':
      return `${candidate.path} (typst ${candidate.version})`;
    case 'mismatch':
      return `${candidate.path} (typst ${candidate.version}; se requiere ${TYPST_VERSION})`;
    case 'broken':
      return `${candidate.path} (no responde a --version: ${candidate.message})`;
  }
}

export function formatTypstStatus(status: TypstStatus): string {
  const lines = [`Typst requerido: ${status.required}`];
  if (status.selected === undefined) {
    lines.push('Ningún binario ejecutable: ejecuta «cv typst install», o indica --typst-path o CHAMELEON_TYPST');
  } else if (status.selected.state === 'ok') {
    lines.push(`Se usaría: ${status.selected.path} (${SOURCE_LABELS[status.selected.source]}) · typst ${status.selected.version}`);
  } else if (status.selected.state === 'mismatch') {
    lines.push(`Se usaría: ${status.selected.path} (${SOURCE_LABELS[status.selected.source]}) · typst ${status.selected.version}, distinto del requerido: ejecuta «cv typst install» o usa --typst-any-version`);
  } else {
    lines.push(`Se usaría: ${status.selected.path} (${SOURCE_LABELS[status.selected.source]}), pero no responde a --version: ${status.selected.message}`);
  }
  lines.push('Candidatos, por prioridad:');
  for (const candidate of status.candidates) {
    lines.push(`  ${SOURCE_LABELS[candidate.source]}: ${describeCandidate(candidate)}`);
  }
  return `${lines.join('\n')}\n`;
}
