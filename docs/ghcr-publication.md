# Publicación de la imagen Docker en GitHub Container Registry

| | |
|---|---|
| **Tarea** | T-7.3 · [RELEASE] Publicación de la imagen Docker (Hito 7, pilar 2) |
| **Estado** | PROPUESTA v1 (2026-08-29) **APROBADA en su totalidad** por el Director de Ingeniería y Producto el 2026-08-29 con las nueve decisiones de §9; **implementada** el 2026-08-29 (§10), entrega pendiente de aprobación |
| **Autor** | Claude (Director Técnico) |
| **Base** | `docs/docker.md` §8 (esbozo aprobado con la decisión 7 de T-7.2) y §3 (imagen, etiquetas OCI, bases por digest); `docs/packaging-and-release.md` §6 (acciones fijadas por SHA, permisos mínimos, atestación de procedencia); `release.yml` y `ci.yml` vigentes (v1.0.0 publicada el 2026-08-29 con tar.gz, sha256 y atestación); versiones de las acciones consultadas en GitHub el 2026-08-29 (§5). |

## 0. Resumen ejecutivo

- La imagen que hoy se construye y se prueba en la integración continua pasa a **publicarse en `ghcr.io/nunzi00/chameleon-cv`** desde el flujo de release, con la misma etiqueta que el binario (`1.1.0`) y sus alias (`1.1`, `1`, `latest`), en dos variantes (Debian por defecto y `-distroless`) y —si el Director lo aprueba— para **`linux/amd64` y `linux/arm64`** construidas en runners nativos, sin emulación.
- **Misma cadena de custodia que el tar.gz**: SBOM y procedencia de BuildKit adjuntas a la imagen en el registro, y **atestación de GitHub sobre el digest del índice**, verificable con `gh attestation verify oci://ghcr.io/nunzi00/chameleon-cv:1.1.0 --owner nunzi00`. Sin secretos: basta el `GITHUB_TOKEN` con `packages: write` en el único trabajo que publica.
- **Nada se publica sin pasar la prueba de humo** (13 comprobaciones) sobre la imagen recién construida, en cada arquitectura y variante; el mismo camino se ensaya sin publicar (`workflow_dispatch` con `push=false`) y permite **publicar retroactivamente** la imagen de una versión ya liberada (`tag=v1.1.0, push=true`), que es como nacerá la primera.
- Para el usuario: `docker compose pull` sustituye a `docker compose build`; `compose.yml` apunta por defecto a la versión exacta publicada (con una prueba que exige que coincida con `package.json`), y el README ofrece el `docker run` de una línea. Nueve decisiones para el Director (§9).

## 1. Objetivo y alcance

**Dentro**: publicación automática de la imagen en cada release (tags `v*`), etiquetado semántico, variantes, arquitecturas, SBOM/procedencia/atestación, ensayo sin publicar, publicación retroactiva, cambios en `Dockerfile`, `compose.yml`, `ci.yml` y `release.yml`, guía, README, CHANGELOG y prueba de coherencia de versiones. Opcionalmente, análisis de vulnerabilidades informativo (decisión 5).

**Fuera**: espejo de las imágenes base en GHCR (solo si los límites de Docker Hub molestan; §7), firma adicional con cosign (§9, decisión 4), reducción del ejecutable (`strip`, backlog B-7), publicación en Docker Hub u otros registros, imágenes para Windows o macOS (no existen ejecutables), limpieza automática de versiones antiguas del paquete.

## 2. Situación de partida (lo que ya existe)

- `Dockerfile` multi-etapa (T-7.2): `build` con el Node 26 oficial ejecuta `npm run package` e instala Typst; `runtime` (Debian, usuario `cv` con `UID`/`GID`) y `runtime-distroless`; bases por digest con Dependabot; etiquetas OCI (`source`, `url`, `documentation`, `licenses`, `version`, `revision`) que GHCR usa para enlazar el paquete con el repositorio.
- `scripts/docker-smoke.sh <imagen> [uid-esperado]`: 13 comprobaciones (versión, `init`/`build`, Markdown, pdfkit, Typst, stdin, propiedad 0600, ejecución endurecida, sin red, doble de Ollama en loopback). `ci.yml` construye `runtime` para amd64 con caché de capas, la somete al humo, valida los tres Compose y ejecuta el tutorial 5.
- `release.yml`: `verify` (tag = versión, notas del CHANGELOG) → `package-linux-x64` → `release` (SHA256SUMS, atestación con `actions/attest-build-provenance`, `gh release create`). Acciones fijadas por SHA, permisos mínimos por trabajo, `workflow_dispatch` como ensayo.
- Limitaciones heredadas: el `Dockerfile` da por hecho `linux-x64` (`tar -xzf …-linux-x64.tar.gz`; `libatomic` de `x86_64-linux-gnu` en distroless); `compose.yml` construye siempre en local (`image: chameleon-cv:local`); no hay imagen publicada de la 1.0.0 ni de la 1.1.0.

## 3. Diseño

### 3.1 Nombre, etiquetas y variantes

Un solo paquete, `ghcr.io/nunzi00/chameleon-cv`, y `docker/metadata-action` como única fuente de etiquetas y de las etiquetas OCI dinámicas (`created`, `version`, `revision`; las estáticas siguen en el `Dockerfile`):

| Tag del repositorio | Etiquetas de la imagen (Debian) | Variante distroless |
|---|---|---|
| `v1.1.0` | `1.1.0`, `1.1`, `1`, `latest` | `1.1.0-distroless`, `1.1-distroless`, `1-distroless`, `latest-distroless` |
| `v1.2.0-rc.1` (prerelease) | `1.2.0-rc.1` (sin alias ni `latest`) | `1.2.0-rc.1-distroless` |

`type=semver` con `pattern={{version}}`, `{{major}}.{{minor}}` y `{{major}}` (la acción omite los alias en las prereleases) y `latest=auto`; la variante con `flavor: suffix=-distroless,onlatest=true`. La etiqueta `X.Y.Z` es la misma cadena que `package.json` y que el nombre del tar.gz: el trabajo `verify` ya aborta si el tag no coincide con la versión, y la etiqueta OCI `org.opencontainers.image.version` sale del mismo valor. Los alias son mutables por diseño (`1` siempre apunta a la última 1.x); quien quiera inmutabilidad usa `X.Y.Z` o el digest.

### 3.2 Arquitecturas

- **Opción A — solo `linux/amd64`** (lo esbozado en T-7.2): un trabajo, camino ya probado en CI. En Apple Silicon y en máquinas ARM la imagen corre bajo emulación (Rosetta/QEMU): funciona, pero lento, y Docker avisa en cada arranque.
- **Opción B — `linux/amd64` y `linux/arm64` con runners nativos** (`ubuntu-24.04` y `ubuntu-24.04-arm`, gratuitos para repositorios públicos), cada arquitectura construida, probada y empujada **por digest** en su propio trabajo, y un trabajo final que crea el **índice multi-arquitectura** (`docker buildx imagetools create`) con las etiquetas de §3.1. Sin emulación en ningún punto: `npm run package` (esbuild, `node --build-sea`, humo del ejecutable) corre sobre el Node arm64 oficial y `cv typst install` descarga el Typst `linux-arm64` que el manifiesto ya conoce. Requiere los cambios del §3.6.

**Recomendación: B.** El público natural de una imagen publicada usa Docker Desktop en Apple Silicon; el coste es un segundo trabajo (≈ 6 minutos, en paralelo). **Advertencia honesta**: en esta máquina no hay forma de ejecutar arm64; la primera evidencia real llegará del trabajo `docker` de la CI en runner nativo, que se ejecuta en cada push a `main` (§3.5) y por tanto **antes** de cualquier release. Si arm64 fallara y no tuviera arreglo inmediato, la primera publicación sale con la opción A y arm64 queda registrado como continuación.

### 3.3 Cadena de suministro: SBOM, procedencia y atestación

Tres capas, todas gratuitas y sin claves propias:

1. **BuildKit** (`docker/build-push-action` con `sbom: true` y `provenance: mode=max`): el SBOM (SPDX) y la procedencia SLSA de la construcción viajan **dentro del registro** como manifiestos de atestación del índice; se leen con `docker buildx imagetools inspect` y el formato `json .SBOM` (o `json .Provenance`), como muestra la guía «Chameleon CV en Docker».
2. **Atestación de GitHub** (`actions/attest-build-provenance` con `subject-name: ghcr.io/nunzi00/chameleon-cv`, `subject-digest: <digest del índice>` y `push-to-registry: true`): la misma que ya protege el tar.gz, firmada por Sigstore con la identidad OIDC del flujo, verificable con `gh attestation verify oci://ghcr.io/nunzi00/chameleon-cv:1.1.0 --owner nunzi00` (y almacenada también en el registro).
3. **Bases por digest** y Dependabot (`docker`) para renovarlas; el ejecutable se construye desde `package-lock.json` con el Node oficial; los avisos de terceros viajan en `/opt/chameleon-cv/THIRD-PARTY-NOTICES.md`.

No se propone firmar con cosign: la atestación de GitHub ya es un sobre Sigstore verificable y añadir una segunda herramienta duplicaría el mecanismo (decisión 4).

### 3.4 El flujo de release: trabajos, permisos, ensayo y publicación retroactiva

`release.yml` gana dos trabajos; `verify`, `package-linux-x64` y `release` no cambian.

| Trabajo | Cuándo | Qué hace | Permisos |
|---|---|---|---|
| `docker-build` (matriz: `amd64` en `ubuntu-24.04`, `arm64` en `ubuntu-24.04-arm`) | tras `verify`; en tags y en `workflow_dispatch` | Para cada variante (`runtime`, `runtime-distroless`): construye con caché de capas (`type=gha`, clave por arquitectura), **carga la imagen y ejecuta `docker-smoke.sh`** (Debian con UID 1000; distroless con 65532, el `nonroot` de la base), y solo entonces la empuja **por digest** (`push-by-digest=true,name-canonical=true`) con SBOM y procedencia; guarda el digest como artefacto. Con `push=false` se salta el login y el empujón: el resto es idéntico (ensayo, C12). | `contents: read`, `packages: write` |
| `docker-publish` | tras `docker-build` y, en tags, tras `release` (la imagen nunca precede a la release de GitHub) | Descarga los digests, `docker/login-action` con el `GITHUB_TOKEN`, `docker/metadata-action` calcula las etiquetas, `imagetools create` publica un índice por variante, `imagetools inspect` obtiene su digest, `attest-build-provenance` lo atesta y publica la atestación en el registro; el resumen del trabajo imprime las órdenes de `pull` y de verificación. | `contents: read`, `packages: write`, `id-token: write`, `attestations: write` |

`workflow_dispatch` recibe dos entradas: `tag` (release ya publicada cuya imagen se construye: se hace `checkout` de ese tag, y `verify` sigue exigiendo que coincida con `package.json`) y `push` (booleano, por defecto `false`). Así la 1.1.0 —que el Director etiqueta antes de que esta tarea exista— recibe su imagen **después**, con `tag=v1.1.0, push=true`, y cualquier ensayo se hace con `push=false` sin tocar el registro. Con `push=true` el trabajo comprueba con `gh release view` que la release existe: no hay imágenes de versiones que no se liberaron. La concurrencia sigue agrupada por ref (`release-<ref>`, sin cancelar).

### 3.5 La integración continua

El trabajo `docker` de `ci.yml` pasa a una matriz `amd64`/`arm64` en runners nativos y construye y somete al humo **las dos variantes** (hoy solo `runtime` en amd64); Compose se valida y el tutorial 5 se ejecuta con la imagen local (`CHAMELEON_CV_IMAGE=chameleon-cv:local`, §4). Ninguna imagen sale de la CI: el trabajo no tiene `packages: write`. Esto es lo que da la evidencia de arm64 en cada push (§3.2).

Opcional (decisión 5): análisis de vulnerabilidades con Trivy sobre la imagen `runtime` recién construida (`severity: CRITICAL,HIGH`, `exit-code: 0`: informativo, nunca bloquea) con subida del informe SARIF a *Code scanning* (gratuito en repositorios públicos; permiso `security-events: write` solo en ese paso), en la release y en un trabajo semanal programado (`schedule`), no en cada push.

### 3.6 Cambios en el `Dockerfile`

- La etapa `build` extrae `build/release/chameleon-cv-*-linux-*.tar.gz` (glob por arquitectura) y copia `libatomic.so.1` desde `/usr/lib/$(uname -m)-linux-gnu/` a una ruta fija (`/opt/lib/`); `runtime-distroless` la copia a `/usr/lib/`, directorio de búsqueda por defecto del cargador dinámico en ambas arquitecturas (se comprueba con el humo y con `ldd` en la implementación).
- Bases: `node:26-bookworm-slim`, `debian:bookworm-slim` y `distroless/cc-debian12:nonroot` son índices multi-arquitectura; sus digests actuales ya designan el índice, no una arquitectura, así que sirven tal cual.
- Nada más cambia: usuario `cv` con `UID`/`GID` (1000 por defecto en la imagen publicada), etiquetas OCI estáticas, `ENTRYPOINT ["cv"]`.

## 4. Compose, README y guía

- `compose.yml`: `image: ${CHAMELEON_CV_IMAGE:-ghcr.io/nunzi00/chameleon-cv:1.1.0}` conservando `build:` (con `UID`/`GID`). Una **prueba unitaria** exige que la versión de ese valor por defecto sea la de `package.json`: el commit que sube la versión debe tocar `compose.yml` o la suite falla (C13). Dos caminos documentados: **sin construir nada** (`docker compose pull` y después `run --rm`; Compose usa la imagen descargada porque ya existe en local) y **construir en local** (`docker compose build`, obligatorio para usuarios de Linux con UID distinto de 1000 que quieran los ficheros del volumen a su nombre; Docker Desktop en macOS y Windows no tiene ese problema).
- `scripts/docs/tutorials.ts` deja pasar `CHAMELEON_CV_IMAGE` al entorno de los tutoriales: en la CI el tutorial 5 usa la imagen recién construida; un usuario que lo siga sin construir descarga la publicada.
- README: `docker run --rm -v "$PWD/my-profile:/work" ghcr.io/nunzi00/chameleon-cv:1.1.0 --help` y `docker compose pull` como primer paso del bloque Docker; sección de verificación con `gh attestation verify oci://…`.
- Guía «Chameleon CV en Docker»: apartado «La imagen publicada» (etiquetas y alias, arquitecturas, variante distroless, cómo verificar la atestación y leer el SBOM, cuándo construir en local). `docs/docker.md` §8 remite a esta nota. CHANGELOG (`[Unreleased]`, «Añadido»).

## 5. Seguridad

- **Permisos**: `packages: write` solo en `docker-build` (empuje por digest) y `docker-publish`; `id-token`/`attestations` solo en `docker-publish`; la CI no puede publicar. Sin secretos ni PAT: `GITHUB_TOKEN` efímero, sesión cerrada por `login-action` al terminar.
- **Acciones fijadas por SHA** (versiones vigentes el 2026-08-29): `docker/login-action` v4.6.0 (`dbcb8138…`), `docker/metadata-action` v6.2.0 (`dc802804…`), `docker/build-push-action` v7.3.0 y `docker/setup-buildx-action` v4.3.0 (ya en uso), `actions/attest-build-provenance` v4.2.2 (ya en uso); si se aprueba la decisión 5, `aquasecurity/trivy-action` v0.36.0 (`ed142fd0…`) y `github/codeql-action/upload-sarif` del paquete v2.26.4 (`486fec2a…`). Dependabot (`github-actions`) las mantiene.
- **Nada se publica sin pasar el humo** y sin que la release de GitHub exista; la publicación retroactiva exige que el tag sea una release.
- **Procedencia `mode=max`** incluye el `Dockerfile` y los argumentos de construcción (`UID`, `GID`, `VERSION`, `REVISION`): nada de eso es secreto y el repositorio es público.
- **Visibilidad del paquete**: GitHub puede crear el paquete como privado en la primera publicación; el Director lo comprueba y, si hace falta, lo hace público (ajustes del paquete). La etiqueta `org.opencontainers.image.source` lo enlaza al repositorio, que gestiona sus permisos.
- Sin limpieza automática: los manifiestos por arquitectura quedan referenciados por el índice (en la interfaz de GHCR aparecen «sin etiqueta»; es lo normal).

## 6. Verificación (C12, C13, C15)

1. **En esta máquina (amd64)**: `docker buildx build` de las dos variantes con los mismos argumentos que el flujo; `docker-smoke.sh` 13/13 en cada una (distroless con UID 65532); `ldd` del ejecutable en distroless; `docker compose config` con y sin `CHAMELEON_CV_IMAGE`; la prueba de coherencia de versiones en rojo con un `compose.yml` desviado y en verde con el correcto; `docs:check` con la guía y el README actualizados; typecheck y cobertura al 100 %.
2. **En GitHub, sin publicar**: `workflow_dispatch` con `push=false` sobre `main` tras la fusión: los dos runners construyen y someten al humo las dos variantes; el trabajo `docker` de la CI hace lo mismo en cada push. Es la primera evidencia de arm64.
3. **Primera publicación real**: `workflow_dispatch` con `tag=v1.1.0, push=true`. Comprobación desde fuera: `docker pull ghcr.io/nunzi00/chameleon-cv:1.1.0`, humo 13/13 contra la imagen descargada, `docker buildx imagetools inspect` (índice con dos arquitecturas, SBOM y procedencia) y `gh attestation verify oci://ghcr.io/nunzi00/chameleon-cv:1.1.0 --owner nunzi00` (`gh` no está en esta máquina: se instala en el espacio de usuario o la ejecuta el Director; la nota registra el resultado real, no el previsto).
4. La release siguiente (`v1.2.0` o `v1.1.1`) publicará la imagen por el camino automático; hasta entonces, el camino manual es el mismo flujo con dos entradas.

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| arm64 no verificado antes de la CI (no hay hardware aquí). | La CI lo ejecuta en runner nativo en cada push antes de cualquier release; si falla, se publica con la opción A y arm64 queda como continuación explícita. |
| El paquete nace privado o desligado del repositorio. | Etiqueta `source` en la imagen; comprobación por el Director tras la primera publicación (§5). |
| Límite de descargas anónimas de Docker Hub para las bases en los runners. | Digests fijados y caché de capas; si aparecen fallos, espejo de las tres bases en GHCR (fuera de alcance hoy). |
| Tiempo de release: cuatro construcciones (2 arquitecturas × 2 variantes). | Las variantes comparten la etapa `build` (caché); las arquitecturas van en paralelo; ≈ +6 minutos sobre los 12 actuales. |
| Alias mutables (`1`, `latest`) sorprenden a quien quiera reproducibilidad. | Documentar `X.Y.Z` y el digest; `compose.yml` fija la versión exacta. |
| Tamaño (≈ 104 MB comprimida). | Aceptado en 1.x; B-7 (`strip`) sigue en el backlog. |

## 8. Plan de ejecución

- **S1 — Imagen y Compose**: `Dockerfile` multi-arquitectura (§3.6), humo de la variante distroless, `compose.yml` con `CHAMELEON_CV_IMAGE`, prueba de coherencia de versiones, paso de la variable en el ejecutor de tutoriales. Verificación local completa (§6.1).
- **S2 — Flujos**: matriz nativa en `ci.yml`; `docker-build` y `docker-publish` en `release.yml` con `workflow_dispatch` (`tag`, `push`); opcionalmente Trivy. Ensayo en GitHub sin publicar (§6.2).
- **S3 — Documentación y primera publicación**: guía, README, CHANGELOG, `docs/docker.md` §8 → esta nota; publicación retroactiva de la 1.1.0 y verificación externa (§6.3); cierre en ROADMAP y §10.

## 9. Decisiones que se piden al Director

1. **Arquitecturas**: A (solo amd64) o **B (amd64 + arm64 en runners nativos; recomendada)**, con la salvaguarda de §3.2.
2. **Un solo paquete** con sufijo `-distroless` para la variante (recomendado) o dos paquetes (`chameleon-cv` y `chameleon-cv-distroless`).
3. **Etiquetas**: `X.Y.Z`, `X.Y`, `X` y `latest` (automática, nunca en prereleases); confirmar.
4. **Cadena de suministro**: SBOM + procedencia de BuildKit + atestación de GitHub sobre el índice (recomendado); cosign no se añade.
5. **Análisis de vulnerabilidades** con Trivy, informativo, en la release y semanal, con SARIF a *Code scanning*: sí (recomendado) o no.
6. **`compose.yml`** apunta por defecto a la versión exacta publicada, con prueba de coherencia (recomendado), o al alias mayor `1`.
7. **Publicación retroactiva de la 1.1.0** con `workflow_dispatch` en cuanto la implementación esté aprobada (recomendado), o esperar a la siguiente release.
8. **UID/GID 1000 fijos** en la imagen publicada; los usuarios de Linux con otro UID construyen en local (documentado). Confirmar.
9. **Visibilidad**: el Director comprueba tras la primera publicación que el paquete es público y está enlazado al repositorio.

## 10. Estado de la implementación

- **T-7.3 (2026-08-29)**: implementada. **S1** — `Dockerfile` multi-arquitectura (glob del tar.gz por arquitectura; `libatomic` de `$(uname -m)-linux-gnu` copiada a `/usr/lib` en distroless), `compose.yml` con `image: ${CHAMELEON_CV_IMAGE:-ghcr.io/nunzi00/chameleon-cv:<versión>}`, `src/release/compose.ts` + prueba (la versión por defecto debe ser la de `package.json`; la prueba se prueba a sí misma con cinco desviaciones), `docker-smoke.sh` con tercer parámetro `--user` y espacio de trabajo `1777` (la imagen publicada corre como 1000 aunque el anfitrión no lo sea), `CHAMELEON_CV_IMAGE` en el ejecutor de tutoriales. **S2** — `ci.yml`: matriz `amd64`/`arm64` en runners nativos (`fail-fast: false`) con las dos variantes, humo de ambas, cinco combinaciones de Compose y tutorial 5 contra la imagen local; `release.yml`: entradas `tag`/`push`, `ref` en los checkouts, trabajos `docker-build` (humo de la imagen **tal como se publica**, con UID 1000, antes de empujar por digest con SBOM y `provenance: mode=max`; Trivy informativo en amd64 con SARIF) y `docker-publish` (guarda `gh release view`, índices por variante con `imagetools create`, digest del índice, dos atestaciones `push-to-registry`, resumen); `image-scan.yml` semanal. Acciones nuevas fijadas por SHA: `login-action` v4.6.0, `metadata-action` v6.2.0, `trivy-action` v0.36.0, `codeql-action/upload-sarif` v4.37.9. **S3** — guía («La imagen publicada», `docker compose pull`, construcción local para UID ≠ 1000), README, CHANGELOG `[1.1.1]`, esta nota, ROADMAP y registro de decisiones. **Verificación en esta máquina (amd64)**: las dos variantes construyen; humo 13/13 en Debian, 13/13 en distroless con `--user` y 13/13 como usuario 1000 sobre un espacio ajeno; distroless arranca (encuentra `libatomic` en `/usr/lib`); `docker compose config` válido en las cinco combinaciones, con y sin `CHAMELEON_CV_IMAGE`; tutorial 5 4/4 contra la imagen local a través de la variable; 701 pruebas con el 100 % de cobertura; `docs:check`; arnés determinista 78/78. **Desviación de la decisión 7**: la publicación retroactiva de la 1.1.0 no puede hacerse completa —el tag `v1.1.0` contiene el `Dockerfile` y la prueba de humo anteriores (solo `linux/amd64`, sin `--user`), y construir «1.1.0» desde `main` publicaría un producto distinto del liberado—, así que la entrega prepara la **versión 1.1.1**: la primera imagen sale por el camino automático al etiquetar `v1.1.1` (arm64 y las dos variantes incluidas). El mecanismo `workflow_dispatch` con `tag`/`push` queda para ensayar sin publicar y para (re)publicar la imagen de una release cuyo árbol ya lo admita (≥ 1.1.1). **Pendiente**: evidencia de arm64 en la CI de GitHub (runner nativo; se ejecuta con este mismo push), ensayo `push=false` y primera publicación con `v1.1.1` (el Director etiqueta y comprueba la visibilidad del paquete), verificación externa (`pull`, humo contra la imagen descargada, `imagetools inspect`, `gh attestation verify`).
