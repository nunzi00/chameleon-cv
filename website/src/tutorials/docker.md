---
title: 5 · Todo en un contenedor
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
# Tutorial 5 · Todo en un contenedor

Sin instalar Node, Typst ni Ollama: con Docker y Docker Compose tienes Chameleon CV completo. Tus datos viven en `./my-profile`, en tu máquina; el contenedor no tiene red, no corre como root y su sistema de ficheros es de solo lectura.

## 1. La imagen

Desde el repositorio (hasta que se publique en GitHub Container Registry, se construye en local; unos dos minutos):

```bash
git clone https://github.com/nunzi00/chameleon-cv.git && cd chameleon-cv
docker compose build            # o npm run docker:build
```

La construcción ejecuta dentro de la imagen el mismo `npm run package` del release —con su prueba de humo y sus avisos de licencias— e instala Typst; la imagen final no contiene Node, npm ni código fuente.

## 2. Tu espacio de trabajo y tu usuario

```bash tutorial needs-docker
mkdir -p my-profile
printf 'UID=%s\nGID=%s\n' "$(id -u)" "$(id -g)" > .env
docker compose config -q
```

Crea `my-profile` tú (si lo crea Docker al montar el volumen, será de root) y deja tu UID y tu GID en `.env`: la imagen se construye con ellos para que todo lo que escriba el contenedor sea tuyo, con los mismos permisos 0600 que fuera de Docker. En Docker Desktop (macOS, Windows) no hace falta.

## 3. Las mismas órdenes, con `docker compose run`

```bash tutorial needs-docker
docker compose run --rm chameleon-cv init
docker compose run --rm chameleon-cv build
docker compose run --rm chameleon-cv generate-cv -s backend --format pdf --engine typst
ls -l my-profile/output
```

`run --rm` arranca un contenedor efímero por orden y lo elimina al terminar: sin procesos ociosos y con los códigos de salida reales. Typst ya está dentro de la imagen: el PDF de calidad editorial sale a la primera. Un alias lo deja como en el resto de la guía:

```bash
alias cv='docker compose run --rm -T chameleon-cv'
cv generate-cv -s backend --explain
```

## 4. Ofertas: ficheros dentro de `my-profile` o por la entrada estándar

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

Las rutas son relativas a `/work`, que es tu `my-profile`. `-T` desactiva la pseudoterminal para que la entrada estándar llegue al contenedor.

## 5. La IA local, cuando la quieras

`compose.ai.yml` añade Ollama con el modelo validado (`qwen2.5:7b-instruct`) y hace que `cv` comparta su espacio de red: `http://127.0.0.1:11434` sigue siendo loopback, así que la regla «solo local» del producto no cambia y Ollama no publica ningún puerto. La primera vez descarga unos 3,2 GB de imagen y 4,7 GB de modelo, que persisten en un volumen.

```bash
docker compose -f compose.yml -f compose.ai.yml run --rm chameleon-cv llm status
docker compose -f compose.yml -f compose.ai.yml run --rm chameleon-cv improve -s backend --top-n 2
echo 'COMPOSE_FILE=compose.yml:compose.ai.yml' >> .env      # y a partir de aquí, sin -f
docker compose -f compose.yml -f compose.ai.yml -f compose.gpu.yml run --rm chameleon-cv summarize -s backend   # con GPU NVIDIA
```

La configuración se valida sin arrancar nada:

```bash tutorial needs-docker
docker compose -f compose.yml -f compose.ai.yml -f compose.gpu.yml config -q
```

## 6. Qué hay dentro y qué no

Dentro: el ejecutable, sus avisos de licencias y Typst. Fuera: Node, npm, tu código y tus datos. Detalle, variante distroless, endurecimiento y decisiones: [Chameleon CV en Docker](/guide/docker).
