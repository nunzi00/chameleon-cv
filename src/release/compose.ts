/**
 * Coherencia entre `compose.yml` y `package.json` (T-7.3, docs/ghcr-publication.md §4, canon C13): la imagen que
 * Compose descarga por defecto debe ser exactamente la versión que se libera, en el registro del repositorio
 * (`ghcr.io/<propietario>/<repositorio>` de `repository.url`). El commit que sube la versión tiene que tocar
 * `compose.yml`, o la suite falla.
 */
export type ComposeImageCheck = { readonly ok: true; readonly image: string } | { readonly ok: false; readonly message: string };

const IMAGE_LINE = /^\s*image:\s*(\S+)\s*(?:#.*)?$/m;
const DEFAULT = /^\$\{CHAMELEON_CV_IMAGE:-([^}]+)\}$/;

/** `ghcr.io/<propietario>/<repositorio>` a partir de `repository.url` de package.json; `undefined` si falta o no es de GitHub. */
export function registryImageName(packageJson: { readonly repository?: { readonly url?: string } | undefined }): string | undefined {
  const url = packageJson.repository?.url;
  const match = url === undefined ? null : /github\.com[/:]([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(url);
  return match === null ? undefined : `ghcr.io/${String(match[1]).toLowerCase()}/${String(match[2]).toLowerCase()}`;
}

export function checkComposeImage(composeText: string, packageJsonText: string): ComposeImageCheck {
  const packageJson = JSON.parse(packageJsonText) as { readonly version: string; readonly repository?: { readonly url?: string } };
  const name = registryImageName(packageJson);
  if (name === undefined) {
    return { ok: false, message: 'package.json no declara un repository.url de GitHub del que derivar la imagen' };
  }
  const line = IMAGE_LINE.exec(composeText);
  if (line === null) {
    return { ok: false, message: 'compose.yml no declara ninguna imagen' };
  }
  const value = String(line[1]);
  const fallback = DEFAULT.exec(value);
  if (fallback === null) {
    return { ok: false, message: `la imagen de compose.yml debe ser \${CHAMELEON_CV_IMAGE:-<imagen>} y es «${value}»` };
  }
  const expected = `${name}:${packageJson.version}`;
  return String(fallback[1]) === expected ? { ok: true, image: expected } : { ok: false, message: `la imagen por defecto de compose.yml es «${String(fallback[1])}» y la versión que se libera es «${expected}»` };
}
