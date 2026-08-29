# Ecosistema Docker: imagen, Compose con un modelo local y despliegue con un solo comando

| | |
|---|---|
| **Tarea** | T-7.2 · [OPS] Ecosistema Docker (Hito 7, pilar 2); alcance de T-7.3 (publicación en GHCR) esbozado en §8 |
| **Estado** | PROPUESTA v1 (2026-08-29) **APROBADA** por el Director de Ingeniería y Producto el 2026-08-29 con sus siete decisiones; **implementada** el 2026-08-29 (§12) y **entrega aprobada** por el Director ese mismo día. |
| **Autor** | Claude (Director Técnico) |
| **Base** | Plan estratégico del Hito 7 y observaciones registradas en el ROADMAP (loopback en Compose, modelo validado, imagen sin Node, UID del volumen, imágenes por digest); `docs/packaging-and-release.md` (ejecutable SEA, `npm run package`); `docs/llm-integration.md` (C3 local por defecto, C11); *spike* con Docker 29.7 y Compose 5.5 ejecutado en esta máquina el 2026-08-29 (§2). |

## 0. Resumen ejecutivo

- **Una imagen, sin Node dentro**: etapa de construcción con el Node 26 oficial (`npm ci`, `npm run package` con su prueba de humo, `cv typst install`) y etapa final mínima con solo el ejecutable, sus avisos de licencias y Typst. Variante por defecto sobre `debian:bookworm-slim` (usuario `cv` con UID/GID configurables, `docker compose exec` posible); variante endurecida opcional sobre `distroless/cc`.
- **Compose por capas**: `compose.yml` (solo `cv`, **sin red**), `compose.ai.yml` (añade `ollama` y comparte su espacio de red con `network_mode: service:ollama`, de modo que `http://127.0.0.1:11434` sigue siendo loopback y la guarda del canon C3 no se toca) y `compose.gpu.yml` (reserva de GPU NVIDIA). El modelo preconfigurado es **`qwen2.5:7b-instruct`**, el único validado por el arnés de IA.
- **Uso**: `docker compose run --rm chameleon-cv <orden>` (un contenedor efímero por orden, sin proceso ocioso); alias `cv` documentado. Los datos del usuario viven en `./my-profile` (montado en `/work`; ficheros 0600 del usuario anfitrión) y la caché en un volumen con nombre.
- **Endurecido por defecto**: no root, raíz de solo lectura, `/tmp` en tmpfs, sin capacidades, `no-new-privileges`, sin red salvo el loopback compartido con Ollama en el perfil de IA, imágenes base fijadas por digest.
- **Hallazgos del spike que cambian el diseño**: el ejecutable necesita `libatomic.so.1` y `libstdc++` (ausentes en las imágenes mínimas); `cv typst install` exige `xz` en la etapa de construcción y deja el binario con permisos 0700; el ejecutable construido con el Node oficial pesa **160 MB** (el de esta máquina, con el Node de Arch, 72 MB).
- Docs-as-Code (C15): guía «Chameleon CV en Docker» y un quinto tutorial cuyos bloques se ejecutan en un trabajo `docker` de la CI.

## 1. Objetivo y alcance

Que cualquier persona con Docker tenga el entorno completo —incluido un modelo de IA local— con un solo comando, sin instalar Node, Typst ni Ollama en su máquina, y que la imagen sea reproducible, pequeña en superficie y verificable.

En T-7.2: `Dockerfile`, `.dockerignore`, ficheros de Compose, trabajo `docker` en la CI, guía y tutorial. En T-7.3: publicación de la imagen en GHCR desde el flujo de release (§8). Fuera de alcance: `cv serve` (T-7.4; la imagen ya está preparada para ejecutarlo cuando exista), otras arquitecturas (arm64 exige un ejecutable SEA arm64: pendiente del Hito 6 posterior a la 1.0), Kubernetes.

## 2. Spike: qué se midió y qué se aprendió (2026-08-29)

Un `Dockerfile` multi-etapa de prueba (`build` → `runtime` Debian y `runtime-distroless`), construido en esta máquina con Docker 29.7.2 y BuildKit; pruebas con el dataset de ejemplo de `cv init`.

| Hecho medido | Consecuencia para el diseño |
|---|---|
| `node:26-bookworm-slim` trae `/usr/local/LICENSE` (Node v26.8.1). | `npm run package` encuentra la licencia de Node sin `CHAMELEON_NODE_LICENSE`. |
| `cv typst install` falla en `debian-slim` sin `xz-utils` (el release de Typst es `.tar.xz` y se extrae con el `tar` del sistema). | `xz-utils` solo en la etapa de construcción; el runtime no necesita `tar` ni `xz` porque Typst viaja ya instalado. |
| El ejecutable SEA construido con el Node oficial depende de `libatomic.so.1` y `libstdc++.so.6` (`ldd`); `debian-slim` y `distroless/cc` no traen `libatomic`. | `libatomic1 libstdc++6` en la variante Debian; en distroless se copia `libatomic.so.1` desde la etapa de construcción. **Afecta también al ejecutable fuera de Docker**: el README lo documenta como requisito (presentes en cualquier distribución de escritorio). |
| `cv typst install` deja el binario con 0700 y propietario root: el usuario `cv` no puede ejecutarlo. | `COPY --from=build --chmod=755`. |
| Un volumen con nombre montado en `/home/cv/.cache` nace propiedad de root si el directorio no existe en la imagen. | La imagen crea `/home/cv/.cache` propiedad de `cv`: Docker copia esa propiedad al volumen vacío. |
| Tamaños por capa: base Debian 85 MB · `cv` **160 MB** · Typst 56 MB · avisos 0,3 MB → imagen ≈ 300 MB en disco y ≈ 104 MB comprimida al descargar (distroless: ≈ 240 MB en disco, 85 MB comprimida). El `cv` de esta máquina pesa 72 MB porque el Node de Arch está *stripped*. | Aceptable para 1.x; queda registrado investigar `strip` del ejecutable SEA (§9). |
| Construcción en frío 65 s (incluye `npm ci` y la prueba de humo del empaquetado dentro de la imagen); reconstrucción con caché 16 s; distroless a partir de la misma etapa 12 s. | La CI puede construir la imagen en cada PR sin coste apreciable. |
| Arranque `docker run … cv --version`: ≈ 600 ms (el contenedor domina; el ejecutable solo, 212 ms). | Un contenedor efímero por orden es viable. |
| Como UID 1000 con `./profile:/work`: `init`, `build`, PDF con Typst y tema `classic`, oferta por stdin; los ficheros quedan **propiedad del usuario anfitrión con 0600**. | El mapeo de UID/GID por argumentos de construcción resuelve la propiedad en Linux. |
| Ejecución endurecida (`--read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges --network none` y caché en volumen con nombre): PDF con Typst generado; la caché materializa 1,2 MB (temas y plantillas). | Esos ajustes van por defecto en Compose. |
| distroless con `--user 1000:1000 -e HOME=/tmp --tmpfs /tmp`: PDF con Typst generado (los assets se materializan en tmpfs en cada arranque). | Variante endurecida viable como opción; no tiene shell ni `useradd`. |
| **Espacio de red compartido**: con un doble de Ollama escuchando solo en `127.0.0.1:11434` dentro de otro contenedor, `docker run --network container:<ollama> … cv llm status` → «alcanzable · versión 0.33.2 · 1 modelo · el modelo configurado está disponible» (código 0); con `--network none`, «fetch failed» (control). | `network_mode: service:ollama` funciona y **la guarda de loopback del producto no se toca**. |
| `ollama/ollama` v0.33.2: **3,2 GB comprimidos** (amd64); `qwen2.5:7b-instruct`: 4,7 GB. | La IA es opcional (`compose.ai.yml`): el perfil base no descarga nada de eso. |
| Docker Compose 5.5.0 disponible. | Sintaxis de Compose moderna (`compose.yml`, `include`/varios `-f`). |

## 3. La imagen (`Dockerfile`)

```dockerfile
# syntax=docker/dockerfile:1.7
ARG UID=1000
ARG GID=1000

FROM node:26-bookworm-slim@sha256:<digest> AS build          # Node oficial: --build-sea copia este mismo binario
RUN apt-get update && apt-get install -y --no-install-recommends xz-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run package                                            # compilación limpia, bundles, SEA, prueba de humo, avisos, tar.gz
RUN mkdir -p /opt/chameleon-cv && tar -xzf build/release/chameleon-cv-*-linux-x64.tar.gz -C /opt/chameleon-cv --strip-components=1
RUN XDG_CACHE_HOME=/opt/cache /opt/chameleon-cv/cv typst install   # única operación de red del producto, en construcción

FROM debian:bookworm-slim@sha256:<digest> AS runtime           # variante por defecto
ARG UID
ARG GID
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 libstdc++6 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g "$GID" cv && useradd -m -u "$UID" -g "$GID" -s /usr/sbin/nologin cv \
 && mkdir -p /work /home/cv/.cache && chown cv:cv /work /home/cv/.cache
COPY --from=build --chmod=755 /opt/chameleon-cv/cv /opt/chameleon-cv/cv
COPY --from=build --chmod=644 /opt/chameleon-cv/*.md /opt/chameleon-cv/LICENSE /opt/chameleon-cv/
COPY --from=build --chmod=755 /opt/cache/chameleon-cv/typst/0.15.1/typst /opt/typst/typst
ENV PATH=/opt/chameleon-cv:/usr/local/bin:/usr/bin:/bin CHAMELEON_TYPST=/opt/typst/typst HOME=/home/cv
LABEL org.opencontainers.image.source=https://github.com/nunzi00/chameleon-cv org.opencontainers.image.licenses=MIT …
USER cv
WORKDIR /work
ENTRYPOINT ["cv"]
CMD ["--help"]

FROM gcr.io/distroless/cc-debian12:nonroot@sha256:<digest> AS runtime-distroless   # variante endurecida (opcional)
COPY --from=build /usr/lib/x86_64-linux-gnu/libatomic.so.1 /usr/lib/x86_64-linux-gnu/libatomic.so.1
COPY --from=build --chmod=755 /opt/chameleon-cv/cv /opt/chameleon-cv/cv
COPY --from=build --chmod=644 /opt/chameleon-cv/*.md /opt/chameleon-cv/LICENSE /opt/chameleon-cv/
COPY --from=build --chmod=755 /opt/cache/chameleon-cv/typst/0.15.1/typst /opt/typst/typst
ENV CHAMELEON_TYPST=/opt/typst/typst HOME=/tmp
WORKDIR /work
ENTRYPOINT ["/opt/chameleon-cv/cv"]
```

Decisiones de diseño:

- **La imagen se construye desde el código con el mismo `npm run package` del release**: la prueba de humo se ejecuta dentro de la imagen y los avisos de licencias (`THIRD-PARTY-NOTICES.md`) se generan para el Node embebido (la licencia se lee de `/usr/local/LICENSE` de la imagen oficial). La etapa final no contiene Node, npm, el código fuente ni `node_modules`.
- **Imágenes base fijadas por digest** (con la etiqueta anotada al lado); Dependabot las mantiene (`package-ecosystem: docker`).
- **Etiquetas OCI** (`source`, `version`, `revision`, `licenses`, `description`) rellenadas en la construcción (`--label`/`ARG`), para que GHCR enlace la imagen con el repositorio.
- **Variante Debian por defecto**: `useradd` con UID/GID de construcción (`docker compose build` los toma de `.env`: `UID`, `GID`), shell disponible para `docker compose exec`, coreutils para tutoriales. **Variante distroless** como objetivo `runtime-distroless`: sin shell ni gestor de paquetes; se ejecuta con `--user <uid>:<gid>` y `HOME` en tmpfs; para quien priorice la superficie mínima.
- `.dockerignore`: `.git`, `node_modules`, `website/`, `build`, `dist`, `output`, `data/dist`, `coverage`.

## 4. Compose por capas

`compose.yml` (base; sin IA, sin red):

```yaml
services:
  chameleon-cv:
    build:
      context: .
      target: runtime
      args: { UID: "${UID:-1000}", GID: "${GID:-1000}" }
    image: ghcr.io/nunzi00/chameleon-cv:1.0.0        # T-7.3; hasta entonces se construye en local
    network_mode: none
    volumes:
      - ./my-profile:/work
      - cv-cache:/home/cv/.cache
    read_only: true
    tmpfs: [/tmp]
    cap_drop: [ALL]
    security_opt: [no-new-privileges:true]
volumes:
  cv-cache:
```

`compose.ai.yml` (superposición; `docker compose -f compose.yml -f compose.ai.yml …`):

```yaml
services:
  ollama:
    image: ollama/ollama:0.33.2@sha256:<digest>
    environment: { OLLAMA_HOST: "127.0.0.1:11434" }    # solo loopback: cv comparte este espacio de red; nada se publica al anfitrión
    volumes: [ollama-models:/root/.ollama]
    healthcheck: { test: ["CMD", "ollama", "list"], interval: 10s, timeout: 5s, retries: 12 }
  ollama-pull:                                          # descarga el modelo validado una vez (4,7 GB) y termina
    image: ollama/ollama:0.33.2@sha256:<digest>
    network_mode: "service:ollama"
    environment: { OLLAMA_HOST: "127.0.0.1:11434" }
    entrypoint: ["ollama", "pull", "qwen2.5:7b-instruct"]
    depends_on: { ollama: { condition: service_healthy } }
    restart: "no"
  chameleon-cv:
    network_mode: "service:ollama"                       # 127.0.0.1:11434 sigue siendo loopback (canon C3 intacto)
    depends_on:
      ollama: { condition: service_healthy }
      ollama-pull: { condition: service_completed_successfully }
volumes:
  ollama-models:
```

`compose.gpu.yml` (superposición opcional): `deploy.resources.reservations.devices: [{ driver: nvidia, count: all, capabilities: [gpu] }]` para `ollama`.

Por qué así:

- **Superposiciones en lugar de perfiles**: `network_mode: service:ollama` no puede depender de un perfil; con dos ficheros, el perfil base no arranca Ollama ni abre red, y el de IA cambia solo lo necesario. `COMPOSE_FILE=compose.yml:compose.ai.yml` en `.env` evita repetir `-f`.
- **`docker compose run --rm chameleon-cv <orden>`** es el patrón de uso: un contenedor efímero por orden, sin proceso ocioso, con stdin (`run -T … -f -`) y códigos de salida reales. `exec` exigiría un contenedor permanente (`sleep infinity`) sin ningún beneficio hasta que exista `cv serve` (T-7.4), que sí será un servicio de larga duración y usará esta misma imagen.
- **Ollama no publica puertos**: el modelo solo es alcanzable desde `cv` (y desde `ollama-pull`) por el loopback compartido. Quien quiera usarlo desde el anfitrión añade `ports` en una superposición propia.
- **Modelo**: `qwen2.5:7b-instruct` es el único validado (arnés de IA 16/16 y tutorial 4). Otro modelo se recomienda solo tras pasar `npm run test:acceptance:ai` con él (C12/C13).
- **Datos**: `./my-profile` (creado por `cv init`) contiene datos personales: en el anfitrión, con la propiedad y los permisos (0600) del usuario. `cv-cache` guarda assets materializados, Typst no (viaja en la imagen) y la caché de respuestas del co-piloto.

## 5. Experiencia de uso

```bash
git clone https://github.com/nunzi00/chameleon-cv.git && cd chameleon-cv
echo "UID=$(id -u)" >> .env && echo "GID=$(id -g)" >> .env       # Linux: los ficheros de my-profile serán tuyos
docker compose build                                             # o docker compose pull, cuando la imagen esté en GHCR (T-7.3)
docker compose run --rm chameleon-cv init                        # ./my-profile/data/sources con el dataset de ejemplo
docker compose run --rm chameleon-cv build
docker compose run --rm chameleon-cv generate-cv -s backend --format pdf --engine typst
docker compose run --rm -T chameleon-cv generate-cv -f - --compact < oferta.txt
alias cv='docker compose run --rm -T chameleon-cv'               # y a partir de aquí, cv <orden> como en la guía
# Con IA local (≈ 8 GB de descarga la primera vez):
docker compose -f compose.yml -f compose.ai.yml run --rm chameleon-cv llm status
docker compose -f compose.yml -f compose.ai.yml run --rm chameleon-cv improve -s backend --top-n 2
```

En macOS y Windows (Docker Desktop) la propiedad de los ficheros la gestiona el propio Docker: `UID`/`GID` no son necesarios.

## 6. Seguridad

- **Cadena de suministro**: la imagen se construye desde el código con el Node oficial y las dependencias de `package-lock.json`; bases por digest; sin secretos; avisos de licencias dentro (`/opt/chameleon-cv/THIRD-PARTY-NOTICES.md`); en T-7.3, atestación de procedencia y SBOM de la imagen.
- **Superficie**: sin Node, npm, código fuente ni `node_modules` en el runtime; no root; raíz de solo lectura; `/tmp` en tmpfs; sin capacidades; `no-new-privileges`; **sin red** salvo el loopback compartido con Ollama en la superposición de IA (y Ollama sin puertos publicados).
- **Datos**: solo en el volumen del usuario y en la caché con nombre; nada de datos en la imagen; el `cv init` dentro del contenedor crea los mismos 0600 que fuera. Los proveedores remotos siguen exigiendo `--provider` y las claves llegan solo por variables de entorno (`environment` en una superposición propia) o un `keys.json` montado con 0600.
- **Ollama**: software de terceros (MIT) que el usuario decide descargar; su versión va fijada por digest y Dependabot la actualiza.

## 7. Documentación como código (C15)

- Guía «Chameleon CV en Docker» (`website/src/guide/docker.md`) y tutorial 5 «Todo en un contenedor» con bloques `bash tutorial needs-docker`: el ejecutor de tutoriales los corre solo si hay `docker` (omisión visible si no).
- Trabajo `docker` en `ci.yml`: construye la imagen (caché de capas de BuildKit), ejecuta la prueba de humo sobre la imagen (`init`, `build`, Markdown, PDF con Typst, oferta por stdin, ejecución endurecida) y valida `docker compose -f compose.yml -f compose.ai.yml config`. El tutorial 5 se ejecuta en ese trabajo. Sin Ollama en la CI (8 GB): el bloque de IA del tutorial queda `needs-llm`, como en el tutorial 4.

## 8. T-7.3, esbozo: publicación en GHCR

Desde `release.yml`, tras `package-linux-x64`: `docker/login-action`, `docker/metadata-action` y `docker/build-push-action` (fijadas por SHA) construyen y publican `ghcr.io/nunzi00/chameleon-cv` con etiquetas `1.0.0`, `1.0` y `latest` (`latest` solo para versiones sin sufijo), `provenance: true` y `sbom: true`, atestación de procedencia sobre el digest (`actions/attest-build-provenance` con `subject-name`/`subject-digest`), permisos `packages: write`, y `workflow_dispatch` como ensayo sin publicar (`push: false`). Solo `linux/amd64` mientras no exista el ejecutable arm64. Detalle en su propia especificación.

## 9. Riesgos

| Riesgo | Mitigación |
|---|---|
| Imagen de ≈ 300 MB (ejecutable de 160 MB con el Node oficial). | Aceptable en 1.x; investigar `strip` sobre el ejecutable SEA (podría dejarlo en ≈ 70 MB) como tarea posterior del Hito 6; distroless ≈ 240 MB para quien lo prefiera. |
| Descarga inicial de la IA (≈ 8 GB). | Superposición opcional, aviso claro en la guía, modelo persistido en volumen. |
| Límites de descarga de Docker Hub para las bases. | Digest fijado; en CI, caché de BuildKit; si molestara, espejo de las bases en GHCR. |
| Propiedad de ficheros con Docker Desktop o rootless. | Documentado: `UID`/`GID` solo en Linux con el demonio clásico. |
| `network_mode: service:` con Compose en Swarm o Podman. | Fuera de alcance; documentado. |
| Deriva entre la guía y la realidad. | Tutorial 5 ejecutado en la CI (C15). |

## 10. Plan de ejecución

| Paso | Contenido | Verificación |
|---|---|---|
| S1 | `Dockerfile` (dos objetivos), `.dockerignore`, etiquetas OCI, digests fijados, Dependabot `docker`. | Construcción local; humo sobre la imagen; `docker run --read-only …`. |
| S2 | `compose.yml`, `compose.ai.yml`, `compose.gpu.yml`, `.env.example`. | `docker compose config`; `run --rm` de todos los flujos base; superposición de IA con un doble de Ollama en loopback (como en el spike) y, una vez, con Ollama real y `qwen2.5:7b-instruct`. |
| S3 | Trabajo `docker` en `ci.yml`; scripts `npm run docker:build` y `docker:smoke` (el humo, reutilizable en CI y en local). | Ensayo local de la secuencia. |
| S4 | Guía y tutorial 5 (`needs-docker`), README (una línea), `docs-portal` (sidebar). | `npm run docs:check` con Docker presente y ausente. |
| S5 | Cierre: ROADMAP, esta nota (§11), informe. | Suite y arneses en verde (el núcleo no cambia). |

## 11. Decisiones que se piden al Director

1. **Variante por defecto Debian** (UID/GID, shell) con **distroless opcional** (recomendado), frente a distroless única.
2. **Superposiciones de Compose** (`compose.ai.yml`, `compose.gpu.yml`) frente a perfiles (recomendado: superposiciones; `network_mode: service:` no admite perfiles).
3. **`docker compose run --rm` como patrón** (recomendado) frente a un contenedor permanente con `exec` hasta que exista `cv serve`.
4. **Modelo `qwen2.5:7b-instruct`** (validado) como preconfigurado (recomendado); cualquier otro solo tras el arnés de IA.
5. **Trabajo `docker` en cada push y PR** (≈ 3 min con caché; recomendado) frente a solo en el release.
6. **Nombre de la imagen** `ghcr.io/nunzi00/chameleon-cv` y etiquetas `1.0.0`/`1.0`/`latest` (T-7.3).
7. **Registrar** la investigación de `strip` del ejecutable SEA como tarea del Hito 6 posterior a la 1.0 (afecta al archivo de release, no solo a la imagen).

## 11 bis. Superposiciones para `cv serve` (T-7.4b)

`compose.serve.yml` (sin IA: `network_mode: bridge`, `command: serve --host 0.0.0.0 --port 4310`, `ports: 127.0.0.1:4310:4310`) y `compose.serve-ai.yml` (con `compose.ai.yml`: el puerto se publica en el servicio `ollama`, cuya red comparte Chameleon CV). El puerto solo se publica en el loopback del anfitrión; el token de sesión sale en los logs. Detalle de uso en la guía del portal («Chameleon CV en Docker» y «La API local»).

## 12. Estado de la implementación

- **T-7.2 (2026-08-29)**: entregada. `Dockerfile` (etapas `build`, `runtime` —Debian por defecto con `UID`/`GID`/`VERSION`/`REVISION`— y `runtime-distroless`; bases fijadas por digest; etiquetas OCI; `libatomic1` y `libstdc++6`; Typst instalado en la construcción con `xz-utils`; `COPY --chmod`), `.dockerignore`, `compose.yml` (sin red, `read_only`, `/tmp` en tmpfs, `cap_drop: ALL`, `no-new-privileges`, `init`, `./my-profile:/work`, volumen `cv-cache`), `compose.ai.yml` (Ollama 0.33.2 por digest solo en loopback, `ollama-pull` de un solo uso, `network_mode: service:ollama`, `CHAMELEON_LLM_MODEL` con `qwen2.5:7b-instruct` por defecto), `compose.gpu.yml`, `.env.example`, `scripts/docker-smoke.sh` (`npm run docker:smoke`: 13 comprobaciones —versión, init, build, Markdown, pdfkit, Typst, stdin, propiedad 0600 del usuario esperado, ejecución endurecida, sin red, doble de Ollama en loopback—), `npm run docker:build`, Dependabot `docker`, trabajo `docker` en `ci.yml` (buildx con caché de capas en Actions, humo, `compose config` de las tres combinaciones y tutorial 5), guía «Chameleon CV en Docker», tutorial 5 «Todo en un contenedor» (con `needs-docker`, `files:` y `cleanup:` nuevos en el ejecutor de tutoriales), README y CHANGELOG. **Verificación en esta máquina**: construcción en 61 s (con caché de la etapa `build`); imagen ≈ 300 MB en disco y **104 MB comprimida** (distroless: 85 MB comprimida); humo 13/13; los tres ficheros de Compose validan; tutorial 5 4/4 bloques contra la imagen (4,3 s) y omisión visible sin `CHAMELEON_DOCS_DOCKER`; `docs:check` con los seis tutoriales en verde; typecheck. **No ejecutado**: Ollama real dentro de Compose (≈ 8 GB de descarga): el mecanismo de red queda validado con el doble en loopback y el producto con el modelo real fuera de Docker (arnés de IA y tutorial 4); el trabajo `docker` de la CI no ha corrido aún en GitHub porque el repositorio remoto todavía no existe. Pendiente T-7.3 (GHCR): `image:` pasará de `chameleon-cv:local` a `ghcr.io/nunzi00/chameleon-cv:<versión>` y la guía añadirá `docker compose pull`.
