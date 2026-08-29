import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { checkComposeImage, registryImageName } from '../../src/release/compose';

const ROOT = join(__dirname, '..', '..');
const COMPOSE = readFileSync(join(ROOT, 'compose.yml'), 'utf8');
const PACKAGE = readFileSync(join(ROOT, 'package.json'), 'utf8');
const version = (JSON.parse(PACKAGE) as { version: string }).version;

describe('compose.yml y package.json (T-7.3, C13)', () => {
  it('la imagen por defecto de compose.yml es la versión que se libera, en el registro del repositorio', () => {
    expect(checkComposeImage(COMPOSE, PACKAGE)).toEqual({ ok: true, image: `ghcr.io/nunzi00/chameleon-cv:${version}` });
  });

  it('la prueba se prueba a sí misma: detecta versión desviada, otra imagen, sin variable, sin imagen y sin repositorio', () => {
    const desviado = COMPOSE.replace(`:${version}}`, ':0.0.1}');
    expect(checkComposeImage(desviado, PACKAGE)).toMatchObject({ ok: false, message: expect.stringContaining('0.0.1') });
    const otra = COMPOSE.replace('ghcr.io/nunzi00/chameleon-cv', 'docker.io/alguien/otra');
    expect(checkComposeImage(otra, PACKAGE)).toMatchObject({ ok: false });
    const fija = COMPOSE.replace(/image: \S+/, 'image: chameleon-cv:local');
    expect(checkComposeImage(fija, PACKAGE)).toMatchObject({ ok: false, message: expect.stringContaining('CHAMELEON_CV_IMAGE') });
    expect(checkComposeImage(COMPOSE.replace(/^\s*image:.*$/m, ''), PACKAGE)).toMatchObject({ ok: false, message: 'compose.yml no declara ninguna imagen' });
    expect(checkComposeImage(COMPOSE, JSON.stringify({ version }))).toMatchObject({ ok: false, message: expect.stringContaining('repository.url') });
  });

  it('registryImageName deriva ghcr.io/<propietario>/<repositorio> en minúsculas de las grafías habituales de repository.url', () => {
    expect(registryImageName({ repository: { url: 'git+https://github.com/Nunzi00/Chameleon-CV.git' } })).toBe('ghcr.io/nunzi00/chameleon-cv');
    expect(registryImageName({ repository: { url: 'https://github.com/nunzi00/chameleon-cv' } })).toBe('ghcr.io/nunzi00/chameleon-cv');
    expect(registryImageName({ repository: { url: 'git@github.com:nunzi00/chameleon-cv.git' } })).toBe('ghcr.io/nunzi00/chameleon-cv');
    expect(registryImageName({ repository: { url: 'https://gitlab.com/a/b' } })).toBeUndefined();
    expect(registryImageName({})).toBeUndefined();
  });
});
