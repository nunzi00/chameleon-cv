---
title: Empaquetado y release
---
# Empaquetado y release

## El ejecutable

`npm run package` (Node ≥ 26) produce un **ejecutable autónomo** con la vía oficial de Node.js (*Single Executable Applications*): el código se une con esbuild en un solo fichero, los assets (temas, fuentes, plantillas, prompts, dataset de ejemplo) viajan dentro del binario y los que deben ser ficheros reales se materializan en la caché de usuario con su SHA-256 comprobado en cada uso. El script compila limpio, genera los bundles, construye el ejecutable, lo somete a una **prueba de humo** (init, build, Markdown, PDF, oferta en PDF, temas, prompt, Typst si está disponible), escribe los avisos de licencias de terceros a partir de lo que de verdad contiene el bundle y deja en `build/release/` un `tar.gz` **reproducible** con su `.sha256`. Plataforma de referencia: linux-x64.

```bash
npm run package                                                      # build/release/chameleon-cv-<versión>-linux-x64.tar.gz (+ .sha256)
npm run test:acceptance:deterministic -- --binary build/sea/cv       # acepta el ejecutable con el arnés (77 pasos)
```

El archivo contiene `cv`, `README.md`, `LICENSE`, `CHANGELOG.md`, `THIRD-PARTY-NOTICES.md` y `LICENSE-SourceSans3.md`.

## El flujo de release

Un tag `vX.Y.Z` en GitHub dispara `release.yml`: **verify** (typecheck, cobertura al 100 % con Typst real, arnés determinista; el tag debe ser la versión de `package.json` y `CHANGELOG.md` debe tener su sección con fecha) → **package-linux-x64** (`npm run package`, arnés contra el ejecutable, artefacto) → **release** (`SHA256SUMS.txt`, atestación de procedencia SLSA firmada por Sigstore y `gh release create` con las notas del `CHANGELOG.md`; `--prerelease` si el tag lleva sufijo). Permisos mínimos, sin secretos, acciones fijadas por SHA. `workflow_dispatch` ensaya todo sin publicar.

```bash
npm run release:notes -- 1.0.0     # las notas que publicaría el release, desde CHANGELOG.md
```

Verificación de lo publicado, desde cualquier máquina:

```bash
sha256sum -c chameleon-cv-1.0.0-linux-x64.tar.gz.sha256
gh attestation verify chameleon-cv-1.0.0-linux-x64.tar.gz --owner nunzi00
```

Decisiones, alternativas descartadas y estado: [Empaquetado y release](/design/packaging-and-release) y [Capa unificada de assets](/design/asset-layer).
