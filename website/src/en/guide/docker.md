---
title: Chameleon CV in Docker
---
# Chameleon CV in Docker

With Docker and Docker Compose you get the whole product —executable, Typst and, if you want, a local AI model—
without installing anything else. Your data stays on your machine, in `./my-profile`; the image contains no Node,
no npm, no source code and no data, and the container runs with no network, no privileges and a read-only file
system. Step-by-step tutorial: [Everything in a container](/en/tutorials/docker). Design and measurements:
[Ecosistema Docker (es)](/design/docker).

## Requirements

Docker Engine 24 or newer with Compose v2 (`docker compose`), or Docker Desktop. On Linux, your UID and GID in
`.env` (below). For local AI, about 8 GB of disk the first time; for GPU, the NVIDIA Container Toolkit.

## Getting started

```bash
git clone https://github.com/nunzi00/chameleon-cv.git && cd chameleon-cv
mkdir -p my-profile                                      # create it yourself: if Docker creates it when mounting the volume, it will be root's
docker compose pull                                      # the published image (ghcr.io/nunzi00/chameleon-cv, ≈ 104 MB); see «The published image»
docker compose run --rm chameleon-cv init                # my-profile/data/sources with the sample dataset
docker compose run --rm chameleon-cv build
docker compose run --rm chameleon-cv generate-cv -s backend --format pdf --engine typst
alias cv='docker compose run --rm -T chameleon-cv'      # and from here on, cv <command> as in the rest of the guide
```

`docker compose run --rm chameleon-cv <command>` is the pattern: one ephemeral container per command, no idle
processes, with the real exit codes. `-T` disables the pseudo-terminal for commands that read from standard input
(`generate-cv -f -`, `analyze-offer -`). Paths inside the container are relative to `/work`, which is your
`my-profile`.

You can also **build the image locally** under the same name (`docker compose build`, about two minutes, or
`npm run docker:build`). That's the sensible choice on Linux if your user isn't UID 1000: the published image
runs as `1000:1000` and the files it leaves in `my-profile` would belong to that user; with
`printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" > .env` the local build uses yours. On Docker Desktop (macOS and
Windows) ownership is translated for you and the published image works as is.

## How it is assembled

`compose.yml` (base profile):

- **`network_mode: none`**: the container has no network. No command in the base profile needs one: Typst travels
  inside the image and the executable talks to nobody.
- **Volumes**: `./my-profile:/work` (sources, artifact, CVs and reviews: personal data, on your machine and with
  your permissions) and `cv-cache:/home/cv/.cache` (materialised assets and the co-pilot's response cache; a
  named, persistent volume).
- **Hardening**: unprivileged `cv` user (your UID/GID), read-only root, `/tmp` on tmpfs, no capabilities
  (`cap_drop: ALL`), `no-new-privileges`, `init` for signals.
- **Image**: `ghcr.io/nunzi00/chameleon-cv:<version>` by default (the published one; `CHAMELEON_CV_IMAGE` changes
  it, and a test in the suite requires the default version to be `package.json`'s), buildable locally with
  `build.args` (`UID`, `GID`, `VERSION`, `REVISION`).

## Local AI: `compose.ai.yml`

```bash
docker compose -f compose.yml -f compose.ai.yml run --rm chameleon-cv llm status
docker compose -f compose.yml -f compose.ai.yml run --rm chameleon-cv improve -s backend --top-n 2
echo 'COMPOSE_FILE=compose.yml:compose.ai.yml' >> .env      # so you don't repeat -f
```

- It adds the `ollama` service (official image pinned by digest, models in the `ollama-models` volume,
  `OLLAMA_HOST=127.0.0.1:11434`) and `ollama-pull`, which downloads the model once and exits.
- `cv` then shares **Ollama's network namespace** (`network_mode: service:ollama`): `http://127.0.0.1:11434` is
  still loopback, the product's «local only» rule (canon C3) isn't touched and Ollama **publishes no port** to
  the host. If you want to use it from outside, add `ports` in an overlay of your own.
- The model is **`qwen3:8b`** (the default since 1.8.1; `qwen2.5:7b-instruct` is also validated and faster:
  `cv llm models`). `CHAMELEON_LLM_MODEL` in `.env` changes which one is pulled and used, but only recommend
  another after passing `npm run test:acceptance:ai` with it.
- First time: about 3.2 GB of image and 4.7 GB of model. With a 7B model on CPU count on 20–40 s per
  achievement; `compose.gpu.yml` reserves the NVIDIA GPU for Ollama:

```bash
docker compose -f compose.yml -f compose.ai.yml -f compose.gpu.yml run --rm chameleon-cv summarize -s backend
```

Remote provider keys, if you use them, arrive via `environment` in an overlay of your own
(`CHAMELEON_OPENAI_API_KEY`…) or by mounting your `keys.json` (0600) at
`/home/cv/.config/chameleon-cv/keys.json`; every other rule
([consent, allowlist, cost](/en/guide/copilot#remote-providers-optional)) applies just the same.

> Inside the container, `cv llm up` and `cv llm down` (and the «Ollama local» panel in Ajustes) are disabled:
> here Ollama is a Compose service of its own and is managed with `docker compose`.

## The API from the container

`compose.serve.yml` starts `cv serve` inside the container and publishes the port **only on the host's loopback**
(`127.0.0.1:4310`): nobody else on your network can reach it. The session token appears in the logs:

```bash
docker compose -f compose.yml -f compose.serve.yml up -d
docker compose logs chameleon-cv | grep Token      # http://127.0.0.1:4310/#token=…
docker compose down
```

Inside the container the server listens on `0.0.0.0` (the only way for Docker to publish the port), but the
`Host` check still accepts only `127.0.0.1` and `localhost`, which is what your browser sees. With the local
model from `compose.ai.yml`, Chameleon CV shares Ollama's network, so the port is published on that service: use
`compose.serve-ai.yml` instead of `compose.serve.yml`:

```bash
docker compose -f compose.yml -f compose.ai.yml -f compose.serve-ai.yml up -d
```

The co-pilot's jobs talk to Ollama over the shared loopback; nothing leaves your machine. The
[local API guide](/en/guide/api) explains how to use the server.

## The published image

Every release publishes the image to **GitHub Container Registry** from the same workflow as the executable, and
only after the freshly built image passes the smoke test on each architecture:

| Tag | What it is |
|---|---|
| `ghcr.io/nunzi00/chameleon-cv:1.21.0` | The exact version (the same as `cv --version` and as the tar.gz); it is what `compose.yml` pins. |
| `:1.5` · `:1` · `:latest` | Moving aliases to the latest 1.5.x / 1.x / stable. Prereleases (`1.2.0-rc.1`) move no alias. |
| `:1.1.1-distroless` (and `:1-distroless`, `:latest-distroless`) | The variant on `distroless/cc`: no shell and no package manager, `nonroot` user (65532), for whoever prioritises minimal surface. |

- **Architectures**: `linux/amd64` and `linux/arm64` (Apple Silicon with no emulation) in a single index; Docker
  picks its own.
- **Verifying what you download**: the image carries BuildKit's SBOM and provenance inside the registry, and a
  signed provenance attestation (Sigstore) from the release workflow, just like the executable:

```bash
gh attestation verify oci://ghcr.io/nunzi00/chameleon-cv:1.21.0 --owner nunzi00
docker buildx imagetools inspect ghcr.io/nunzi00/chameleon-cv:1.21.0 --format '{{ json .SBOM }}'
docker buildx imagetools inspect ghcr.io/nunzi00/chameleon-cv:1.21.0 --format '{{ json .Provenance }}'
```

- **User**: the published image runs as `cv` with UID/GID `1000`. If on Linux your user is a different one, build
  locally (above) or run the distroless variant with `--user "$(id -u):$(id -g)"`, which doesn't depend on a home
  directory.
- **Another image or version**:
  `CHAMELEON_CV_IMAGE=ghcr.io/nunzi00/chameleon-cv:1 docker compose run --rm chameleon-cv --version` (or your
  own, `chameleon-cv:local`).
- **`docker run` without Compose**:
  `docker run --rm -v "$PWD/my-profile:/work" ghcr.io/nunzi00/chameleon-cv:1.21.0 --help`.

## What is in the image

| Inside | Outside |
|---|---|
| `/opt/chameleon-cv/cv`: the standalone executable (the release's own, built with `npm run package` inside the image, with its smoke test) | Node, npm, `node_modules`, source code |
| `/opt/chameleon-cv/THIRD-PARTY-NOTICES.md`, `LICENSE`, `CHANGELOG.md`, `README.md`, `LICENSE-SourceSans3.md` | Your data: only in `my-profile` and in `cv-cache` |
| `/opt/typst/typst` (0.15.1, downloaded and verified by `cv typst install` during the build) | Ollama and the models (a separate, optional service) |
| `libatomic1` and `libstdc++6`, which the embedded Node needs | A usable shell for `cv` (the user has no login shell) |

Two variants: **`runtime`** (the default, `debian:bookworm-slim`, about 300 MB on disk and 104 MB to download,
user `cv` with your UID/GID) and **`runtime-distroless`** (`distroless/cc`, about 240 MB on disk and 85 MB to
download, no shell and no package manager):

```bash
docker build --target runtime-distroless -t chameleon-cv:distroless .
docker run --rm --user "$(id -u):$(id -g)" -e HOME=/tmp --tmpfs /tmp -v "$PWD/my-profile:/work" chameleon-cv:distroless build
```

All base images are pinned by digest and Dependabot updates them; the OCI labels
(`org.opencontainers.image.*`) link the image to the repository, the version and the commit.

## Verifying

```bash
npm run docker:build && npm run docker:smoke     # builds and tests: init, build, Markdown, pdfkit, Typst, stdin, 0600 ownership, hardened run, shared network
```

Continuous integration builds the image on every change, runs that smoke test, validates the three Compose files
and runs [tutorial 5](/en/tutorials/docker) against the image (canon C15).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `EACCES: permission denied` writing to `/work` | `my-profile` belongs to root (Docker created it) or your UID isn't the image's. `sudo chown -R "$(id -u):$(id -g)" my-profile`; put `UID`/`GID` in `.env` and rebuild (`docker compose build`). |
| `service "ollama" is not running` or `network_mode: service:ollama` | You're using `compose.ai.yml` without starting Ollama; `docker compose run` starts it through `depends_on`. If you stopped it, `docker compose -f compose.yml -f compose.ai.yml up -d ollama`. |
| `cv llm status`: «no responde» inside Docker | Without `compose.ai.yml` the container has no network (that's by design). With it, wait for `ollama-pull` to finish downloading the model. |
| Slow or interrupted model download | `ollama-pull` resumes; the `ollama-models` volume keeps what was downloaded. |
| Podman, Swarm or Kubernetes | `network_mode: service:` is a Compose feature; on other orchestrators share the network namespace by their own means (a *pod*) or publish Ollama on the host's loopback and use the executable without Docker. |
| Docker Desktop and permissions | Docker Desktop manages ownership of shared files: `UID`/`GID` aren't needed. |
