---
title: Inicio rápido
verify:
  - data/dist/profile.json
  - output/cv-*-backend.md
  - output/cv-*-backend.pdf
---
# Inicio rápido

En menos de cinco minutos: instalar `cv`, crear un espacio de trabajo con un perfil de ejemplo y generar el primer CV en Markdown y en PDF. Todo se procesa en tu máquina; ningún comando de esta página abre una conexión de red.

## 1. Instala el ejecutable

Descarga de [la página de *Releases*](https://github.com/nunzi00/chameleon-cv/releases) el archivo de tu arquitectura —`chameleon-cv-<versión>-linux-x64.tar.gz` o `-linux-arm64.tar.gz`— y su `.sha256` (Linux con glibc ≥ 2.28, `libstdc++` y `libatomic`, presentes en cualquier distribución de escritorio; no necesita Node), verifica y extrae:

```bash
sha256sum -c chameleon-cv-1.0.0-linux-x64.tar.gz.sha256      # «OK»: el archivo es exactamente el publicado
tar -xzf chameleon-cv-1.0.0-linux-x64.tar.gz
sudo install -m 755 chameleon-cv-1.0.0-linux-x64/cv /usr/local/bin/cv   # o cualquier directorio de tu PATH
cv --version
```

¿Prefieres el repositorio? `npm ci && npm run build` y usa `node dist/index.js` (o `npm link` para tener `cv` en el `PATH`); detalles en [Contribuir](/developers/contributing).

::: tip ¿macOS o Windows?
El ejecutable autónomo se publica **solo para Linux**: firmarlo y notarizarlo para las otras dos plataformas
exige certificados de pago y cuentas de desarrollador, y se decidió no hacerlo (1-sep-2026). Ahí el camino es la
**imagen de Docker**, que sí es multi-arquitectura y viaja con su procedencia firmada —ver
[Chameleon CV en Docker](/guide/docker)—, o compilar desde el repositorio, que no necesita nada especial.
:::

## 2. Crea el espacio de trabajo

En un directorio vacío:

```bash tutorial
cv init
```

`cv init` deja en `data/sources/` un dataset de ejemplo —la persona sintética «Ada Ejemplo», con dos especialidades, dos experiencias, un proyecto, skills y certificaciones— y un `.gitignore` que excluye lo que nunca debe versionarse (`data/dist/`, `output/`). Nunca sobrescribe nada: si ya existe algo, lista los conflictos y no escribe.

## 3. Compila el perfil

```bash tutorial
cv build
```

`cv build` valida las fuentes y escribe el artefacto canónico `data/dist/profile.json` (permisos 0600). Es la puerta de calidad del perfil: silencioso si todo va bien y, si hay problemas, los verás **todos** a la vez con fichero y línea. `cv validate` hace lo mismo sin escribir.

## 4. Genera el CV

```bash tutorial
cv generate-cv -s backend                 # output/cv-ada-ejemplo-backend.md
cv generate-cv -s backend --format pdf    # output/cv-ada-ejemplo-backend.pdf
cv generate-cv -s backend --explain       # qué se incluyó y por qué, en stderr
```

`-s backend` elige la especialidad: su titular, su resumen y su vocabulario de etiquetas deciden qué experiencias, logros y skills entran. Sin `-s` obtienes el CV completo.

## Siguientes pasos

- Sustituye el ejemplo por tus datos: [Formato de las fuentes](/guide/sources) o el tutorial [Tu perfil desde cero](/tutorials/profile-from-scratch).
- Afina el CV a una oferta concreta: [Adaptar el CV a una oferta](/guide/offers).
- PDF de calidad editorial con temas: [Typst y temas](/guide/typst-themes) (`cv typst install`, la única operación de red del producto).
- Deja que un modelo local te proponga mejoras verificadas: [Co-piloto de IA](/guide/copilot).

::: tip Esta página se ejecuta en la integración continua
Los bloques marcados como tutorial se ejecutan contra el binario real en cada cambio del proyecto, y se comprueba que producen `data/dist/profile.json` y los CV en Markdown y PDF. Si algo de esta página deja de funcionar, la CI lo detecta antes que tú.
:::
