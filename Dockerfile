# syntax=docker/dockerfile:1.7
# Imagen de Chameleon CV (T-7.2, docs/docker.md §3; multi-arquitectura en T-7.3, docs/ghcr-publication.md §3.6).
# Etapa «build»: el Node 26 oficial de la arquitectura de destino (linux/amd64 o linux/arm64) ejecuta npm ci y
# npm run package (compilación limpia, bundles, ejecutable SEA, prueba de humo, avisos de licencias de
# terceros) e instala Typst con «cv typst install». Etapa «runtime»: solo el ejecutable, sus avisos y Typst;
# sin Node, npm, código fuente ni node_modules. Bases fijadas por digest (etiqueta anotada al lado; Dependabot
# las actualiza). Variante «runtime-distroless» para quien priorice la superficie mínima (docs/docker.md §3).
ARG UID=1000
ARG GID=1000
ARG VERSION=dev
ARG REVISION=unknown

FROM node:26-bookworm-slim@sha256:367679cf9792759492a486e4aa4b421764d71a9546a6dae8aab81a99eb797b3e AS build
# xz-utils: «cv typst install» extrae el release oficial de Typst (.tar.xz) con el tar del sistema
RUN apt-get update && apt-get install -y --no-install-recommends xz-utils && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY package.json package-lock.json ./
COPY gui/package.json gui/package-lock.json ./gui/
RUN npm ci --ignore-scripts --no-audit --no-fund && npm ci --prefix gui --ignore-scripts --no-audit --no-fund
COPY . .
RUN npm run package \
 && mkdir -p /opt/chameleon-cv /opt/lib \
 && tar -xzf build/release/chameleon-cv-*-linux-*.tar.gz -C /opt/chameleon-cv --strip-components=1 \
 && cp "/usr/lib/$(uname -m)-linux-gnu/libatomic.so.1" /opt/lib/libatomic.so.1
# Única operación de red del producto, ejecutada aquí para que el runtime no la necesite nunca
RUN XDG_CACHE_HOME=/opt/cache /opt/chameleon-cv/cv typst install

FROM debian:bookworm-slim@sha256:88200866dfff7ea7f5cbcb6ec7c8a701889efe6fe859fe64d6990e4b07ea4171 AS runtime
# El runtime de Ollama (T-8.8) queda deshabilitado dentro de la imagen: Ollama es un servicio de Compose.
ENV CHAMELEON_CONTAINER=1
ARG UID
ARG GID
ARG VERSION
ARG REVISION
# libatomic1 y libstdc++6: bibliotecas dinámicas del Node oficial embebido en el ejecutable (ldd en docs/docker.md §2).
# Usuario «cv» con el UID/GID del usuario anfitrión (argumentos de construcción) para que los ficheros del volumen sean suyos.
RUN apt-get update && apt-get install -y --no-install-recommends libatomic1 libstdc++6 && rm -rf /var/lib/apt/lists/* \
 && groupadd -g "$GID" cv && useradd -m -u "$UID" -g "$GID" -s /usr/sbin/nologin cv \
 && mkdir -p /work /home/cv/.cache && chown cv:cv /work /home/cv/.cache
COPY --from=build --chmod=755 /opt/chameleon-cv/cv /opt/chameleon-cv/cv
COPY --from=build --chmod=644 /opt/chameleon-cv/README.md /opt/chameleon-cv/CHANGELOG.md /opt/chameleon-cv/LICENSE /opt/chameleon-cv/LICENSE-SourceSans3.md /opt/chameleon-cv/THIRD-PARTY-NOTICES.md /opt/chameleon-cv/
COPY --from=build --chmod=755 /opt/cache/chameleon-cv/typst/0.15.1/typst /opt/typst/typst
ENV PATH=/opt/chameleon-cv:/usr/local/bin:/usr/bin:/bin \
    CHAMELEON_TYPST=/opt/typst/typst \
    HOME=/home/cv
LABEL org.opencontainers.image.title="Chameleon CV" \
      org.opencontainers.image.description="Generador de CV dinámicos a partir de tus fuentes Markdown y CSV; todo en local." \
      org.opencontainers.image.source="https://github.com/nunzi00/chameleon-cv" \
      org.opencontainers.image.url="https://nunzi00.github.io/chameleon-cv/" \
      org.opencontainers.image.documentation="https://nunzi00.github.io/chameleon-cv/guide/docker" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION"
USER cv
WORKDIR /work
ENTRYPOINT ["cv"]
CMD ["--help"]

FROM gcr.io/distroless/cc-debian12:nonroot@sha256:9dac0a79194e45a7da0158a9c6da57b217585af0786db3845d1f0ec1a0dd182f AS runtime-distroless
# El runtime de Ollama (T-8.8) queda deshabilitado dentro de la imagen: Ollama es un servicio de Compose.
ENV CHAMELEON_CONTAINER=1
ARG VERSION
ARG REVISION
# libatomic de la arquitectura de destino, en /usr/lib (directorio de búsqueda por defecto del cargador dinámico)
COPY --from=build /opt/lib/libatomic.so.1 /usr/lib/libatomic.so.1
COPY --from=build --chmod=755 /opt/chameleon-cv/cv /opt/chameleon-cv/cv
COPY --from=build --chmod=644 /opt/chameleon-cv/README.md /opt/chameleon-cv/CHANGELOG.md /opt/chameleon-cv/LICENSE /opt/chameleon-cv/LICENSE-SourceSans3.md /opt/chameleon-cv/THIRD-PARTY-NOTICES.md /opt/chameleon-cv/
COPY --from=build --chmod=755 /opt/cache/chameleon-cv/typst/0.15.1/typst /opt/typst/typst
ENV CHAMELEON_TYPST=/opt/typst/typst HOME=/tmp
LABEL org.opencontainers.image.title="Chameleon CV (distroless)" \
      org.opencontainers.image.source="https://github.com/nunzi00/chameleon-cv" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.version="$VERSION" \
      org.opencontainers.image.revision="$REVISION"
WORKDIR /work
ENTRYPOINT ["/opt/chameleon-cv/cv"]
CMD ["--help"]
