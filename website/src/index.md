---
layout: home
title: Chameleon CV
titleTemplate: Un perfil, muchos CV
hero:
  name: Chameleon CV
  text: Un perfil, muchos CV.
  tagline: Escribe tus fuentes una vez (Markdown y CSV) y genera un CV distinto para cada especialidad o para cada oferta de empleo, en Markdown o PDF. Todo en local, sin telemetría.
  image:
    src: /logo.svg
    alt: Chameleon CV
  actions:
    - theme: brand
      text: Inicio rápido
      link: /guide/quickstart
    - theme: alt
      text: Guía de usuario
      link: /guide/concepts
    - theme: alt
      text: Referencia de comandos
      link: /reference/
features:
  - icon: 🗂️
    title: Una sola fuente de verdad
    details: Tus experiencias, proyectos, logros y habilidades viven en ficheros Markdown y CSV validados con rigor. Cada especialidad —backend, engineering-manager…— genera su propia versión con un comando.
  - icon: 🎯
    title: Adaptado a cada oferta
    details: Pega una oferta (texto o PDF) y el CV se afina con una puntuación transparente; analyze-offer te dice qué demuestras y qué te falta.
  - icon: 🖨️
    title: Markdown o PDF de calidad editorial
    details: pdfkit sin dependencias o Typst con temas (default, classic o los tuyos), a partir de la misma vista estructurada del perfil.
  - icon: 🤖
    title: Co-piloto que sugiere, nunca decide
    details: Reescrituras, resúmenes y etiquetas verificados por código; local por defecto y con consentimiento explícito para cualquier proveedor remoto.
  - icon: 🔒
    title: Local por diseño
    details: Ninguna conexión de red salvo las que tú pides; ficheros con datos personales con permisos 0600; la única operación de red del producto es descargar Typst, verificado por SHA-256.
  - icon: 📦
    title: Un ejecutable, verificable
    details: Ejecutable autónomo para linux-x64 con sha256 y atestación de procedencia, o directamente desde el repositorio. Licencia MIT.
---

## Tres comandos

```bash
cv init                      # crea data/sources/ con un dataset de ejemplo
cv build                     # compila y valida: data/dist/profile.json
cv generate-cv -s backend    # output/cv-<nombre>-backend.md
```

Sigue el [inicio rápido](/guide/quickstart) —menos de cinco minutos— o entra por los [tutoriales](/tutorials/).
