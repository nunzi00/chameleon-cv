---
title: Chameleon CV en Docker
---
# Chameleon CV en Docker

Con Docker y Docker Compose tienes el producto completo —ejecutable, Typst y, si quieres, un modelo de IA local— sin instalar nada más. Tus datos se quedan en tu máquina, en `./my-profile`; la imagen no contiene Node, npm, código fuente ni datos, y el contenedor corre sin red, sin privilegios y con el sistema de ficheros de solo lectura. Tutorial paso a paso: [Todo en un contenedor](/tutorials/docker). Diseño y medidas: [Ecosistema Docker](/design/docker).

## Requisitos

Docker Engine 24 o superior con Compose v2 (`docker compose`), o Docker Desktop. En Linux, tu UID y GID en `.env` (abajo). Para la IA local, unos 8 GB de disco la primera vez; para GPU, el NVIDIA Container Toolkit.

## Puesta en marcha

```bash
git clone https://github.com/nunzi00/chameleon-cv.git && cd chameleon-cv
mkdir -p my-profile                                      # créalo tú: si lo crea Docker al montar el volumen, será de root
docker compose pull                                      # la imagen publicada (ghcr.io/nunzi00/chameleon-cv, ≈ 104 MB); ver «La imagen publicada»
docker compose run --rm chameleon-cv init                # my-profile/data/sources con el dataset de ejemplo
docker compose run --rm chameleon-cv build
docker compose run --rm chameleon-cv generate-cv -s backend --format pdf --engine typst
alias cv='docker compose run --rm -T chameleon-cv'      # y a partir de aquí, cv <orden> como en el resto de la guía
```

`docker compose run --rm chameleon-cv <orden>` es el patrón: un contenedor efímero por orden, sin procesos ociosos, con los códigos de salida reales. `-T` desactiva la pseudoterminal para las órdenes que leen de la entrada estándar (`generate-cv -f -`, `analyze-offer -`). Las rutas dentro del contenedor son relativas a `/work`, que es tu `my-profile`.

También puedes **construir la imagen en local** con el mismo nombre (`docker compose build`, unos dos minutos, o `npm run docker:build`). Es lo recomendable en Linux si tu usuario no tiene el UID 1000: la imagen publicada corre como `1000:1000` y los ficheros que deje en `my-profile` serían de ese usuario; con `printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" > .env` la construcción local usa el tuyo. En Docker Desktop (macOS y Windows) la propiedad se traduce sola y la imagen publicada sirve tal cual.

## Cómo está montado

`compose.yml` (perfil base):

- **`network_mode: none`**: el contenedor no tiene red. Ninguna orden del perfil base la necesita: Typst viaja dentro de la imagen y el ejecutable no habla con nadie.
- **Volúmenes**: `./my-profile:/work` (fuentes, artefacto, CV y revisiones: datos personales, en tu máquina y con tus permisos) y `cv-cache:/home/cv/.cache` (assets materializados y caché de respuestas del co-piloto; volumen con nombre, persistente).
- **Endurecimiento**: usuario `cv` sin privilegios (tu UID/GID), raíz de solo lectura, `/tmp` en tmpfs, sin capacidades (`cap_drop: ALL`), `no-new-privileges`, `init` para las señales.
- **Imagen**: `ghcr.io/nunzi00/chameleon-cv:<versión>` por defecto (la publicada; `CHAMELEON_CV_IMAGE` la cambia, y una prueba de la suite exige que la versión por defecto sea la de `package.json`), construible en local con `build.args` (`UID`, `GID`, `VERSION`, `REVISION`).

## La IA local: `compose.ai.yml`

```bash
docker compose -f compose.yml -f compose.ai.yml run --rm chameleon-cv llm status
docker compose -f compose.yml -f compose.ai.yml run --rm chameleon-cv improve -s backend --top-n 2
echo 'COMPOSE_FILE=compose.yml:compose.ai.yml' >> .env      # para no repetir -f
```

- Añade el servicio `ollama` (imagen oficial fijada por digest, modelos en el volumen `ollama-models`, `OLLAMA_HOST=127.0.0.1:11434`) y `ollama-pull`, que descarga el modelo una vez y termina.
- `cv` pasa a compartir el **espacio de red de Ollama** (`network_mode: service:ollama`): `http://127.0.0.1:11434` sigue siendo loopback, la regla «solo local» del producto (canon C3) no se toca y Ollama **no publica ningún puerto** al anfitrión. Si quieres usarlo desde fuera, añade `ports` en una superposición tuya.
- El modelo es **`qwen3:8b`** (por defecto desde 1.8.1; `qwen2.5:7b-instruct` también está validado y es más rápido: `cv llm models`). `CHAMELEON_LLM_MODEL` en `.env` cambia el que se descarga y se usa, pero recomienda otro solo tras pasar `npm run test:acceptance:ai` con él.
- Primera vez: unos 3,2 GB de imagen y 4,7 GB de modelo. Con un modelo de 7B en CPU cuenta con 20–40 s por logro; `compose.gpu.yml` reserva la GPU NVIDIA para Ollama:

```bash
docker compose -f compose.yml -f compose.ai.yml -f compose.gpu.yml run --rm chameleon-cv summarize -s backend
```

Las claves de proveedores remotos, si las usas, llegan por `environment` en una superposición tuya (`CHAMELEON_OPENAI_API_KEY`…) o montando tu `keys.json` (0600) en `/home/cv/.config/chameleon-cv/keys.json`; el resto de reglas ([consentimiento, lista blanca, coste](/guide/copilot#proveedores-remotos-opcional)) se aplican igual.

> Dentro del contenedor, `cv llm up` y `cv llm down` (y el panel «Ollama local» de Ajustes) quedan deshabilitados:
> aquí Ollama es un servicio del propio Compose y se gestiona con `docker compose`.

## La API desde el contenedor

`compose.serve.yml` arranca `cv serve` dentro del contenedor y publica el puerto **solo en el loopback del anfitrión** (`127.0.0.1:4310`): nadie más en tu red puede llegar a él. El token de sesión sale en los logs:

```bash
docker compose -f compose.yml -f compose.serve.yml up -d
docker compose logs chameleon-cv | grep Token      # http://127.0.0.1:4310/#token=…
docker compose down
```

Dentro del contenedor el servidor escucha en `0.0.0.0` (es la única forma de que Docker publique el puerto), pero la comprobación de `Host` sigue admitiendo solo `127.0.0.1` y `localhost`, que es lo que ve tu navegador. Con el modelo local de `compose.ai.yml`, Chameleon CV comparte la red de Ollama, así que el puerto se publica en ese servicio: usa `compose.serve-ai.yml` en lugar de `compose.serve.yml`:

```bash
docker compose -f compose.yml -f compose.ai.yml -f compose.serve-ai.yml up -d
```

Los trabajos del co-piloto hablan con Ollama por el loopback compartido; nada sale de tu máquina. La guía [La API local](/guide/api) explica cómo usar el servidor.

## La imagen publicada

Cada release publica la imagen en **GitHub Container Registry** desde el mismo flujo que el ejecutable, y solo después de que la imagen recién construida pase la prueba de humo en cada arquitectura:

| Etiqueta | Qué es |
|---|---|
| `ghcr.io/nunzi00/chameleon-cv:1.23.0` | La versión exacta (la misma que `cv --version` y que el tar.gz); es la que fija `compose.yml`. |
| `:1.5` · `:1` · `:latest` | Alias móviles a la última 1.5.x / 1.x / estable. Las prereleases (`1.2.0-rc.1`) no mueven ningún alias. |
| `:1.1.1-distroless` (y `:1-distroless`, `:latest-distroless`) | La variante sobre `distroless/cc`: sin shell ni gestor de paquetes, usuario `nonroot` (65532), para quien priorice la superficie mínima. |

- **Arquitecturas**: `linux/amd64` y `linux/arm64` (Apple Silicon sin emulación) en un solo índice; Docker elige la suya.
- **Verificar lo que descargas**: la imagen lleva SBOM y procedencia de BuildKit dentro del registro, y una atestación de procedencia firmada (Sigstore) por el flujo de release, igual que el ejecutable:

```bash
gh attestation verify oci://ghcr.io/nunzi00/chameleon-cv:1.23.0 --owner nunzi00
docker buildx imagetools inspect ghcr.io/nunzi00/chameleon-cv:1.23.0 --format '{{ json .SBOM }}'
docker buildx imagetools inspect ghcr.io/nunzi00/chameleon-cv:1.23.0 --format '{{ json .Provenance }}'
```

- **Usuario**: la imagen publicada corre como `cv` con UID/GID `1000`. Si en Linux tu usuario es otro, construye en local (arriba) o ejecuta la variante distroless con `--user "$(id -u):$(id -g)"`, que no depende de un directorio personal.
- **Otra imagen o versión**: `CHAMELEON_CV_IMAGE=ghcr.io/nunzi00/chameleon-cv:1 docker compose run --rm chameleon-cv --version` (o la tuya, `chameleon-cv:local`).
- **`docker run` sin Compose**: `docker run --rm -v "$PWD/my-profile:/work" ghcr.io/nunzi00/chameleon-cv:1.23.0 --help`.

## Qué hay en la imagen

| Dentro | Fuera |
|---|---|
| `/opt/chameleon-cv/cv`: el ejecutable autónomo (el mismo del release, construido con `npm run package` dentro de la imagen, con su prueba de humo) | Node, npm, `node_modules`, código fuente |
| `/opt/chameleon-cv/THIRD-PARTY-NOTICES.md`, `LICENSE`, `CHANGELOG.md`, `README.md`, `LICENSE-SourceSans3.md` | Tus datos: solo en `my-profile` y en `cv-cache` |
| `/opt/typst/typst` (0.15.1, descargado y verificado por `cv typst install` durante la construcción) | Ollama y los modelos (servicio aparte, opcional) |
| `libatomic1` y `libstdc++6`, que el Node embebido necesita | Un shell utilizable por `cv` (el usuario no tiene shell de inicio de sesión) |

Dos variantes: **`runtime`** (por defecto, `debian:bookworm-slim`, unos 300 MB en disco y 104 MB al descargar, usuario `cv` con tu UID/GID) y **`runtime-distroless`** (`distroless/cc`, unos 240 MB en disco y 85 MB al descargar, sin shell ni gestor de paquetes):

```bash
docker build --target runtime-distroless -t chameleon-cv:distroless .
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp --tmpfs /tmp -v "$PWD/my-profile:/work" chameleon-cv:distroless build
```

Todas las imágenes base van fijadas por digest y Dependabot las actualiza; las etiquetas OCI (`org.opencontainers.image.*`) enlazan la imagen con el repositorio, la versión y el commit.

## Verificar

```bash
npm run docker:build && npm run docker:smoke     # construye y prueba: init, build, Markdown, pdfkit, Typst, stdin, propiedad 0600, ejecución endurecida, red compartida
```

La integración continua construye la imagen en cada cambio, ejecuta esa prueba de humo, valida los tres ficheros de Compose y ejecuta el [tutorial 5](/tutorials/docker) contra la imagen (canon C15).

## Solución de problemas

| Síntoma | Causa y solución |
|---|---|
| `EACCES: permission denied` al escribir en `/work` | `my-profile` es de root (lo creó Docker) o tu UID no es el de la imagen. `sudo chown -R "$(id -u):$(id -g)" my-profile`; pon `UID`/`GID` en `.env` y reconstruye (`docker compose build`). |
| `service "ollama" is not running` o `network_mode: service:ollama` | Estás usando `compose.ai.yml` sin arrancar Ollama; `docker compose run` lo arranca por `depends_on`. Si lo has parado, `docker compose -f compose.yml -f compose.ai.yml up -d ollama`. |
| `cv llm status`: «no responde» dentro de Docker | Sin `compose.ai.yml` el contenedor no tiene red (es lo previsto). Con ella, espera a que `ollama-pull` termine la descarga del modelo. |
| Descarga lenta o interrumpida del modelo | `ollama-pull` reanuda; el volumen `ollama-models` conserva lo descargado. |
| Podman, Swarm o Kubernetes | `network_mode: service:` es de Compose; en otros orquestadores comparte el espacio de red por sus propios medios (un *pod*) o publica Ollama en loopback del anfitrión y usa el ejecutable sin Docker. |
| Docker Desktop y permisos | Docker Desktop gestiona la propiedad de los ficheros compartidos: `UID`/`GID` no son necesarios. |
