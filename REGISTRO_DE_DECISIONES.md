# Registro de decisiones

Índice de las decisiones que dan forma a Chameleon CV, en dos secciones: las **técnicas autónomas** (las toma el Director Técnico dentro de un plan aprobado) y las **estratégicas consultadas** (las toma el Director de Ingeniería y Producto: afectan al *qué* hace el producto o al *cómo* interactúa el usuario). Cada entrada enlaza la nota de diseño donde está el razonamiento completo; `ROADMAP.md` sigue siendo la fuente de verdad del plan y los cánones viven en `docs/llm-integration.md` §3. Abierto el 2026-08-29 (Hito 7); las decisiones anteriores están en las notas de `docs/` y en el ROADMAP.

## Decisiones técnicas autónomas

| Fecha | Decisión | Por qué | Dónde |
|---|---|---|---|
| 2026-08-29 | El repositorio de GitHub se lee de `package.json` (`repository.url`) y `docs:check` falla si algún enlace no coincide. | Tres grafías distintas del nombre en pocos minutos: una sola fuente de verdad y una guarda que lo vigila. | `scripts/docs/sync.ts`, `website/.vitepress/config.mts` |
| 2026-08-29 | Referencia de comandos generada desde la ayuda de commander; tutoriales ejecutados contra el binario; notas de diseño publicadas desde `docs/` con enlaces reescritos. | La documentación no puede desviarse del programa (después canonizado como C15). | `docs/docs-portal.md` §4 |
| 2026-08-29 | Diagramas como SVG escritos a mano en lugar de Mermaid. | Sin `mermaid-cli` (Chromium) ni plugin de terceros; deterministas y versionados. | `docs/docs-portal.md` §2.3 y §11 |
| 2026-08-29 | Imagen Docker con `libatomic1` y `libstdc++6`, `xz-utils` solo en la construcción, `COPY --chmod`, `/home/cv/.cache` creado en la imagen. | Hallazgos del spike: el ejecutable SEA del Node oficial los necesita; `cv typst install` extrae `.tar.xz` y deja 0700; los volúmenes con nombre heredan la propiedad del directorio de la imagen. | `docs/docker.md` §2 |
| 2026-08-29 | Compose por superposiciones (`compose.ai.yml`, `compose.gpu.yml`) y no por perfiles. | `network_mode: service:ollama` no admite perfiles; el perfil base no abre red ni descarga 8 GB. | `docs/docker.md` §4 |
| 2026-08-29 | El ejecutor de tutoriales trata `verify` como omisión visible cuando se omitieron bloques. | Un fichero prometido puede depender de un bloque omitido (Docker, modelo): no es un fallo del tutorial. | `scripts/docs/tutorials.ts` |
| 2026-08-29 | La prueba de humo de la imagen admite `--user` y abre el espacio temporal (`1777`); la release somete al humo la imagen exacta que publica (UID 1000). | El usuario fijo de la imagen publicada y el `nonroot` de distroless no son el del anfitrión; lo que se prueba debe ser lo que se publica. | `docs/ghcr-publication.md` §3.4 y §10 |
| 2026-08-29 | La primera imagen publicada será la de la versión 1.1.1, no una 1.1.0 retroactiva. | El tag `v1.1.0` lleva el `Dockerfile` y el humo anteriores (solo amd64); construir «1.1.0» desde `main` publicaría un producto distinto del liberado. | `docs/ghcr-publication.md` §10 |

## Decisiones estratégicas consultadas

| Fecha | Consulta | Decisión del Director | Dónde |
|---|---|---|---|
| 2026-08-29 | Licencia del proyecto (T-6.6). | MIT, titular Lucas Nunzi; avisos de terceros en el archivo. | `docs/packaging-and-release.md` §11 |
| 2026-08-29 | Plataforma del portal y siete decisiones de T-7.1 (aislamiento, README, idioma, Docs-as-Code, repositorio, canon C14). | VitePress; `website/` aislado; README puerta corta; castellano raíz + T-7.1b; Docs-as-Code como estándar; `nunzi00/chameleon-cv`; C14 «El núcleo es el producto». | `docs/docs-portal.md` §10 |
| 2026-08-29 | Canon C15. | «La documentación es código verificable», canonizado al aprobar T-7.1. | `docs/llm-integration.md` §3 |
| 2026-08-29 | Siete decisiones de T-7.2 (imagen base, capas de Compose, `strip`, modelo, patrón de ejecución, CI, GHCR). | Debian por defecto y distroless opcional; superposiciones; `strip` como B-7 tras el Hito 7; `qwen2.5:7b-instruct` único validado; `docker compose run --rm`; trabajo `docker` en CI como no negociable; GHCR en T-7.3 con procedencia y SBOM. | `docs/docker.md` §11 |
| 2026-08-29 | Visibilidad del repositorio e historial de commits. | Público; no se reescribe el historial (correo profesional aceptado). | Informe de T-7.2 |
| 2026-08-29 | Directiva «Chameleon CV v2.0» (monorepo, SQLite, `rm -rf`). | No ejecutada; incidente cerrado y archivado por el Director. Hito 7 continúa; multiusuario queda como visión posterior sin planificar. | `ROADMAP.md`, Hito 7 |
| 2026-08-29 | Ocho decisiones de T-7.4 (arquitectura, transporte, autenticación, edición por API, remotos, trabajos, división a/b y versión, referencia generada). | Capa `src/app/` compartida (no cliente delgado); `node:http`; token de sesión; `PUT` con `If-Match` como clarificación de C9; remotos desactivados salvo `--allow-remote` con consentimiento en dos pasos; trabajos con SSE; T-7.4a/T-7.4b y versión 1.1.0; referencia generada (C15). | `docs/api-headless.md` §11 |
| 2026-08-29 | Nueve decisiones de T-7.3 (arquitecturas, paquete, etiquetas, cadena de suministro, Trivy, Compose, publicación de la 1.1.0, UID/GID, visibilidad). | `amd64` + `arm64` en runners nativos con salvaguarda; un paquete con sufijo `-distroless`; `X.Y.Z`/`X.Y`/`X`/`latest`; SBOM + procedencia de BuildKit + atestación de GitHub, sin cosign; Trivy informativo en release y semanal; Compose con la versión exacta y prueba de coherencia; publicación retroactiva de la 1.1.0 (en la implementación resultó inviable completa: primera imagen con la 1.1.1); UID/GID 1000; visibilidad pública comprobada por el Director. | `docs/ghcr-publication.md` §9 |
