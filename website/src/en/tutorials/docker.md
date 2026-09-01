---
title: 5 · Everything in a container
files:
  - compose.yml
  - compose.ai.yml
  - compose.gpu.yml
  - .env.example
verify:
  - my-profile/data/dist/profile.json
  - my-profile/output/cv-ada-ejemplo-backend.pdf
  - my-profile/output/cv-ada-ejemplo-backend-nube.md
  - my-profile/output/stdin.md
cleanup:
  - docker compose down -v --remove-orphans
---
# Tutorial 5 · Everything in a container

Without installing Node, Typst or Ollama: with Docker and Docker Compose you get the whole of Chameleon CV. Your
data lives in `./my-profile`, on your machine; the container has no network, doesn't run as root and its file
system is read-only.

The commands are kept exactly as in the Spanish tutorial, so that continuous integration runs both pages against
the real image.

## 1. The image

From the repository (you can also `docker compose pull` the published image; building takes about two minutes):

```bash
git clone https://github.com/nunzi00/chameleon-cv.git && cd chameleon-cv
docker compose build            # or npm run docker:build
```

The build runs the release's own `npm run package` inside the image —with its smoke test and its licence
notices— and installs Typst; the final image contains no Node, no npm and no source code.

## 2. Your workspace and your user

```bash tutorial needs-docker
mkdir -p my-profile
printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" > .env
docker compose config -q
```

Create `my-profile` yourself (if Docker creates it when mounting the volume, it will be root's) and leave your
UID and GID in `.env`: the image is built with them so that everything the container writes is yours, with the
same 0600 permissions as outside Docker. On Docker Desktop (macOS, Windows) this isn't needed.

## 3. The same commands, with `docker compose run`

```bash tutorial needs-docker
docker compose run --rm chameleon-cv init
docker compose run --rm chameleon-cv build
docker compose run --rm chameleon-cv generate-cv -s backend --format pdf --engine typst
ls -l my-profile/output
```

`run --rm` starts an ephemeral container per command and removes it when it finishes: no idle processes and with
the real exit codes. Typst is already inside the image: the publication-quality PDF comes out first time. An
alias leaves it looking like the rest of the guide:

```bash
alias cv='docker compose run --rm -T chameleon-cv'
cv generate-cv -s backend --explain
```

## 4. Offers: files inside `my-profile` or on standard input

```bash tutorial needs-docker
cat > my-profile/nube.txt <<'EOF'
Platform Engineer

Requisitos:
- Kubernetes y automatización de infraestructura.
- Symfony o PHP en producción.
EOF
docker compose run --rm chameleon-cv analyze-offer nube.txt
docker compose run --rm chameleon-cv generate-cv -f nube.txt -s backend --compact
docker compose run --rm -T chameleon-cv generate-cv -f - -o output/stdin.md < my-profile/nube.txt
```

Paths are relative to `/work`, which is your `my-profile`. `-T` disables the pseudo-terminal so that standard
input reaches the container.

## 5. Local AI, whenever you want it

`compose.ai.yml` adds Ollama with the validated model (`qwen3:8b`) and makes `cv` share its network namespace:
`http://127.0.0.1:11434` is still loopback, so the product's «local only» rule doesn't change and Ollama
publishes no port. The first time it downloads about 3.2 GB of image and 4.7 GB of model, which persist in a
volume.

```bash
docker compose -f compose.yml -f compose.ai.yml run --rm chameleon-cv llm status
docker compose -f compose.yml -f compose.ai.yml run --rm chameleon-cv improve -s backend --top-n 2
echo 'COMPOSE_FILE=compose.yml:compose.ai.yml' >> .env      # and from here on, without -f
docker compose -f compose.yml -f compose.ai.yml -f compose.gpu.yml run --rm chameleon-cv summarize -s backend   # with an NVIDIA GPU
```

The configuration is validated without starting anything:

```bash tutorial needs-docker
docker compose -f compose.yml -f compose.ai.yml -f compose.gpu.yml config -q
```

## 6. What is inside and what isn't

Inside: the executable, its licence notices and Typst. Outside: Node, npm, your code and your data. Detail, the
distroless variant, hardening and decisions: [Chameleon CV in Docker](/en/guide/docker).
